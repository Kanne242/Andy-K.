"""Handels-Engine – identisch für Backtest und Paper-Trading.

Ablauf pro Kerze (je Symbol):
  1. Ausstehende Orders zum Eröffnungskurs ausführen (Signal kam vom Schluss der Vorkerze)
  2. Stop-Loss innerhalb der Kerze prüfen (Kurslücken werden zum Open gefüllt)
  3. Funding-Zahlungen verbuchen
  4. Am Schluss: Trailing-Stop nachziehen, neue Signale -> Order für nächste Kerze
"""
from dataclasses import dataclass, field, asdict

from .risk import positionsgroesse
from .strategy import neuer_trailing_stop


@dataclass
class Position:
    symbol: str
    richtung: int          # +1 long, -1 short
    menge: float
    einstieg: float
    stop: float
    eroeffnet: str
    gebuehren: float = 0.0
    funding: float = 0.0


@dataclass
class Konto:
    cash: float
    hoechststand: float
    tagesstart: float
    tag: str = ""
    pause_bis: str = ""
    positionen: dict = field(default_factory=dict)   # symbol -> Position
    orders: dict = field(default_factory=dict)       # symbol -> +1/-1/0 (0 = schließen)
    letzter_kurs: dict = field(default_factory=dict)
    trades: list = field(default_factory=list)
    ereignisse: list = field(default_factory=list)

    def to_dict(self):
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d):
        k = cls(**{**d, "positionen": {}})
        k.positionen = {s: Position(**p) for s, p in d["positionen"].items()}
        return k


class Engine:
    def __init__(self, cfg: dict, konto: Konto | None = None):
        self.cfg = cfg
        start = cfg["risiko"]["startkapital"]
        self.k = konto or Konto(cash=start, hoechststand=start, tagesstart=start)
        self.fee = cfg["kosten"]["gebuehr_taker"]
        self.slip = cfg["kosten"]["slippage"]
        self.mult = cfg["strategie"]["stop_atr"]

    # ---------- Kontostand ----------
    def unrealisiert(self) -> float:
        return sum(p.richtung * p.menge * (self.k.letzter_kurs.get(s, p.einstieg) - p.einstieg)
                   for s, p in self.k.positionen.items())

    def equity(self) -> float:
        return self.k.cash + self.unrealisiert()

    def nominal(self) -> float:
        return sum(p.menge * self.k.letzter_kurs.get(s, p.einstieg) for s, p in self.k.positionen.items())

    # ---------- Orders ----------
    def _kaufe(self, symbol, richtung, preis, atr, zeit):
        ausf = preis * (1 + richtung * self.slip)
        stop = ausf - richtung * self.mult * atr
        menge = positionsgroesse(self.equity(), ausf, abs(ausf - stop), self.nominal(), self.cfg)
        if menge * ausf < 5:          # Mindestgröße (Börsen haben ~5 USDT Minimum)
            return
        gebuehr = menge * ausf * self.fee
        self.k.cash -= gebuehr
        self.k.positionen[symbol] = Position(symbol, richtung, menge, ausf, stop, zeit, gebuehr)
        self.k.letzter_kurs[symbol] = preis
        self.k.ereignisse.append(f"{zeit} EINSTIEG {symbol} {'LONG' if richtung > 0 else 'SHORT'} "
                                 f"{menge:.5f} @ {ausf:.2f}, Stop {stop:.2f}")

    def _schliesse(self, symbol, preis, zeit, grund):
        p = self.k.positionen.pop(symbol)
        ausf = preis * (1 - p.richtung * self.slip)
        gebuehr = p.menge * ausf * self.fee
        brutto = p.richtung * p.menge * (ausf - p.einstieg)
        self.k.cash += brutto - gebuehr
        netto = brutto - gebuehr - p.gebuehren - p.funding
        self.k.trades.append({
            "symbol": symbol, "richtung": "LONG" if p.richtung > 0 else "SHORT",
            "eroeffnet": p.eroeffnet, "geschlossen": zeit, "einstieg": round(p.einstieg, 4),
            "ausstieg": round(ausf, 4), "menge": p.menge, "grund": grund,
            "gebuehren": round(p.gebuehren + gebuehr, 6), "funding": round(p.funding, 6),
            "netto": round(netto, 6),
        })
        self.k.ereignisse.append(f"{zeit} AUSSTIEG {symbol} ({grund}) @ {ausf:.2f}, Ergebnis {netto:+.2f}")

    # ---------- Hauptschritt ----------
    def schritt(self, zeit: str, zeilen: dict, funding: dict | None = None):
        """zeilen: symbol -> dict(open, high, low, close, atr, long_signal, short_signal)"""
        tag = zeit[:10]
        if tag != self.k.tag:
            self.k.tag, self.k.tagesstart = tag, self.equity()

        for s, z in zeilen.items():
            # 1. Orders zum Open
            order = self.k.orders.pop(s, None)
            if order is not None:
                pos = self.k.positionen.get(s)
                if pos and pos.richtung != order:
                    self._schliesse(s, z["open"], zeit, "Gegensignal")
                if order != 0 and s not in self.k.positionen and self._darf_handeln(zeit):
                    self._kaufe(s, order, z["open"], z["atr_vorher"], zeit)
            # 2. Stop innerhalb der Kerze
            pos = self.k.positionen.get(s)
            if pos:
                if pos.richtung > 0 and z["low"] <= pos.stop:
                    self._schliesse(s, min(z["open"], pos.stop), zeit, "Stop")
                elif pos.richtung < 0 and z["high"] >= pos.stop:
                    self._schliesse(s, max(z["open"], pos.stop), zeit, "Stop")
            # 3. Funding (long zahlt bei positiver Rate, short erhält)
            pos = self.k.positionen.get(s)
            if pos and funding:
                for rate in funding.get(s, []):
                    betrag = pos.richtung * pos.menge * z["open"] * rate
                    self.k.cash -= betrag
                    pos.funding += betrag
            self.k.letzter_kurs[s] = z["close"]

        # 4. Risiko-Bremsen
        eq = self.equity()
        self.k.hoechststand = max(self.k.hoechststand, eq)
        r = self.cfg["risiko"]
        if eq <= self.k.hoechststand * (1 - r["drawdown_notbremse"]) and not self.k.pause_bis:
            for s in list(self.k.positionen):
                self._schliesse(s, self.k.letzter_kurs[s], zeit, "Notbremse")
            self.k.pause_bis = _plus_tage(zeit, 30)
            self.k.hoechststand = self.equity()
            self.k.ereignisse.append(f"{zeit} NOTBREMSE: -{r['drawdown_notbremse']:.0%} vom Hoch, Pause bis {self.k.pause_bis}")

        # 5. Am Schluss: Trailing-Stop + Signale
        for s, z in zeilen.items():
            pos = self.k.positionen.get(s)
            if pos:
                pos.stop = neuer_trailing_stop(pos.richtung, pos.stop, z["close"], z["atr"], self.mult)
                if (pos.richtung > 0 and z["short_signal"]) or (pos.richtung < 0 and z["long_signal"]):
                    self.k.orders[s] = -pos.richtung
            else:
                if z["long_signal"]:
                    self.k.orders[s] = 1
                elif z["short_signal"]:
                    self.k.orders[s] = -1

    def _darf_handeln(self, zeit: str) -> bool:
        if self.k.pause_bis:
            if zeit < self.k.pause_bis:
                return False
            self.k.pause_bis = ""
        if self.equity() <= self.k.tagesstart * (1 - self.cfg["risiko"]["tagesverlust_stopp"]):
            return False
        return True


def _plus_tage(zeit: str, tage: int) -> str:
    import pandas as pd
    return (pd.Timestamp(zeit) + pd.Timedelta(days=tage)).isoformat()
