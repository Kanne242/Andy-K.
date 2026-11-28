"""Backtest über historische Daten mit Gebühren, Slippage und Funding."""
import pandas as pd

from .data import lade_kerzen, lade_funding
from .engine import Engine
from .strategy import indikatoren


def lade_markt(cfg: dict) -> tuple[dict, dict]:
    m = cfg["markt"]
    daten, funding = {}, {}
    for s in m["symbole"]:
        daten[s] = indikatoren(lade_kerzen(s, m["zeitrahmen"], m["start"]), cfg)
        funding[s] = lade_funding(s, m["start"]) if cfg["kosten"].get("funding") else pd.Series(dtype=float)
    return daten, funding


def backtest(cfg: dict, daten: dict, funding: dict, von=None, bis=None):
    symbole = list(daten)
    index = sorted(set().union(*[d.index for d in daten.values()]))
    index = [t for t in index if (von is None or t >= pd.Timestamp(von, tz="UTC"))
             and (bis is None or t < pd.Timestamp(bis, tz="UTC"))]
    if not index:
        raise ValueError("Keine Daten im Zeitraum")
    schritt = pd.Timedelta(cfg["markt"]["zeitrahmen"].replace("h", "h"))

    # Funding je Kerze gruppieren
    fz = {}
    for s in symbole:
        f = funding[s]
        fz[s] = f.groupby(f.index.floor(schritt)).apply(list).to_dict() if len(f) else {}

    tabellen = {s: d.assign(atr_vorher=d["atr"].shift(1)).to_dict("index") for s, d in daten.items()}
    eng = Engine(cfg)
    kurve = []
    for t in index:
        zeilen = {}
        for s in symbole:
            z = tabellen[s].get(t)
            if z is None or pd.isna(z["atr_vorher"]) or pd.isna(z["kanal_hoch"]):
                continue
            zeilen[s] = z
        if zeilen:
            eng.schritt(t.isoformat(), zeilen, {s: fz[s].get(t, []) for s in zeilen})
        kurve.append((t, eng.equity(), eng.nominal()))
    kurve = pd.DataFrame(kurve, columns=["zeit", "equity", "nominal"]).set_index("zeit")
    return eng, kurve


def buy_and_hold(cfg: dict, daten: dict, kurve: pd.DataFrame) -> pd.Series:
    """Vergleich: Startkapital gleichmäßig auf alle Symbole verteilt, ohne Hebel."""
    start = cfg["risiko"]["startkapital"]
    teile = []
    for d in daten.values():
        c = d["close"].reindex(kurve.index).ffill().bfill()
        teile.append(c / c.iloc[0] * start / len(daten) * (1 - cfg["kosten"]["gebuehr_taker"]))
    return sum(teile)
