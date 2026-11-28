"""Paper-Trading: handelt live mit Spielgeld, exakt nach der Backtest-Logik."""
import csv
import json
import time
from datetime import datetime, timezone

import pandas as pd

from .config import BASIS
from .data import lade_live_kerzen
from .engine import Engine, Konto
from .notify import sende
from .strategy import indikatoren

ZUSTAND = BASIS / "zustand"
STANDARD_FUNDING = 0.0001   # 0,01 % je 8 h – typischer Basiswert, Spot-API liefert kein Funding


class PaperBot:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        ZUSTAND.mkdir(exist_ok=True)
        self.datei = ZUSTAND / "paper.json"
        if self.datei.exists():
            d = json.loads(self.datei.read_text())
            self.engine = Engine(cfg, Konto.from_dict(d["konto"]))
            self.zuletzt = d["zuletzt"]
        else:
            self.engine = Engine(cfg)
            self.zuletzt = {}

    def speichern(self):
        k = self.engine.k.to_dict()
        k["ereignisse"] = k["ereignisse"][-200:]
        tmp = self.datei.with_suffix(".tmp")
        tmp.write_text(json.dumps({"konto": k, "zuletzt": self.zuletzt}, indent=1))
        tmp.replace(self.datei)

    def durchlauf(self) -> list[str]:
        """Neue abgeschlossene Kerzen verarbeiten. Gibt neue Ereignisse zurück."""
        m = self.cfg["markt"]
        tabellen = {}
        for s in m["symbole"]:
            df = indikatoren(lade_live_kerzen(s, m["zeitrahmen"], 1000), self.cfg)
            tabellen[s] = df.assign(atr_vorher=df["atr"].shift(1))
        if not self.zuletzt:   # Erststart: nicht rückwirkend handeln, nur ab jetzt
            self.zuletzt = {s: t.index[-1].isoformat() for s, t in tabellen.items()}
            self.engine.k.letzter_kurs = {s: float(t["close"].iloc[-1]) for s, t in tabellen.items()}
            self.speichern()
            return [f"Paper-Trading gestartet mit {self.engine.equity():.2f} USDT. Warte auf Signale."]

        neue_zeiten = sorted(set().union(*[
            t.index[t.index > pd.Timestamp(self.zuletzt.get(s, "1970-01-01T00:00:00+00:00"))]
            for s, t in tabellen.items()]))
        vorher = len(self.engine.k.ereignisse)
        trades_vorher = len(self.engine.k.trades)
        for zeit in neue_zeiten:
            zeilen = {s: t.loc[zeit].to_dict() for s, t in tabellen.items() if zeit in t.index}
            funding = {s: [STANDARD_FUNDING] for s in zeilen if zeit.hour % 8 == 0}
            self.engine.schritt(zeit.isoformat(), zeilen, funding)
            for s in zeilen:
                self.zuletzt[s] = zeit.isoformat()
        neu = self.engine.k.ereignisse[vorher:]
        self._trades_schreiben(self.engine.k.trades[trades_vorher:])
        if neue_zeiten:
            self._kurve_schreiben()
        self.speichern()
        return neu

    def _trades_schreiben(self, trades):
        if not trades:
            return
        datei = ZUSTAND / "paper_trades.csv"
        neu = not datei.exists()
        with open(datei, "a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(trades[0]))
            if neu:
                w.writeheader()
            w.writerows(trades)

    def _kurve_schreiben(self):
        with open(ZUSTAND / "paper_kurve.csv", "a") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()},{self.engine.equity():.4f},{self.engine.nominal():.4f}\n")

    def status(self) -> str:
        e, k = self.engine, self.engine.k
        start = self.cfg["risiko"]["startkapital"]
        z = [f"Kontowert: {e.equity():.2f} USDT ({e.equity() / start - 1:+.1%} seit Start)",
             f"Höchststand: {k.hoechststand:.2f} | Hebel aktuell: {e.nominal() / max(e.equity(), 1e-9):.2f}x",
             f"Abgeschlossene Trades: {len(k.trades)}"]
        for s, p in k.positionen.items():
            kurs = k.letzter_kurs.get(s, p.einstieg)
            z.append(f"  {s} {'LONG' if p.richtung > 0 else 'SHORT'} {p.menge:.5f} @ {p.einstieg:.2f} "
                     f"| Kurs {kurs:.2f} | Stop {p.stop:.2f} | {p.richtung * p.menge * (kurs - p.einstieg):+.2f}")
        if k.pause_bis:
            z.append(f"PAUSE (Notbremse) bis {k.pause_bis}")
        return "\n".join(z)


def dauerbetrieb(cfg: dict, intervall_s: int = 60):
    bot = PaperBot(cfg)
    print(bot.status())
    letzter_tag = None
    while True:
        try:
            for e in bot.durchlauf():
                print(e)
                sende(f"AKM Bot: {e}", cfg)
            heute = datetime.now(timezone.utc).date()
            if heute != letzter_tag:
                if letzter_tag is not None:
                    sende("AKM Bot Tagesbericht\n" + bot.status(), cfg)
                letzter_tag = heute
        except Exception as ex:   # Netzwerkfehler etc.: weiterlaufen, später erneut
            print(f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M} Fehler: {ex}")
        time.sleep(intervall_s)
