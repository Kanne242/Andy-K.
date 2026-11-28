"""Signale: Donchian-Ausbruch mit EMA-Trendfilter und ATR-Trailing-Stop.

Alle Werte werden nur aus abgeschlossenen Kerzen berechnet (kein Blick in die Zukunft).
"""
import pandas as pd


def indikatoren(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    s = cfg["strategie"]
    out = df.copy()
    hoch, tief, schluss = df["high"], df["low"], df["close"]
    vorher = schluss.shift(1)
    tr = pd.concat([hoch - tief, (hoch - vorher).abs(), (tief - vorher).abs()], axis=1).max(axis=1)
    out["atr"] = tr.ewm(alpha=1 / s["atr_periode"], adjust=False).mean()
    out["ema"] = schluss.ewm(span=s["trendfilter_ema"], adjust=False).mean()
    n = s["einstieg_lookback"]
    # Kanal der VORHERIGEN n Kerzen – Ausbruch = Schluss darüber
    out["kanal_hoch"] = hoch.rolling(n).max().shift(1)
    out["kanal_tief"] = tief.rolling(n).min().shift(1)
    out["long_signal"] = (schluss > out["kanal_hoch"]) & (schluss > out["ema"])
    out["short_signal"] = (schluss < out["kanal_tief"]) & (schluss < out["ema"])
    if not s.get("shorts_erlaubt", True):
        out["short_signal"] = False
    return out


def neuer_trailing_stop(richtung: int, alter_stop: float, schluss: float, atr: float, mult: float) -> float:
    """Stop wird nur in Gewinnrichtung nachgezogen, nie zurück."""
    if richtung > 0:
        return max(alter_stop, schluss - mult * atr)
    return min(alter_stop, schluss + mult * atr)
