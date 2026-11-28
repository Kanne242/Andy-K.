"""Kursdaten: historisches Archiv (data.binance.vision) und Live-Kerzen."""
import io
import json
import time
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

import pandas as pd

from .config import BASIS

ARCHIV = "https://data.binance.vision/data/futures/um/monthly"
LIVE = "https://data-api.binance.vision/api/v3/klines"
CACHE = BASIS / "daten"

SPALTEN = ["open_time", "open", "high", "low", "close", "volume", "close_time",
           "quote_volume", "trades", "taker_base", "taker_quote", "ignore"]


def _hole(url: str, versuche: int = 4) -> bytes | None:
    for i in range(versuche):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(2 ** i)
    return None


def _monate(start: str):
    j, m = map(int, start.split("-"))
    heute = date.today()
    while (j, m) < (heute.year, heute.month):
        yield f"{j:04d}-{m:02d}"
        m += 1
        if m > 12:
            j, m = j + 1, 1


def _csv_aus_zip(inhalt: bytes) -> pd.DataFrame:
    with zipfile.ZipFile(io.BytesIO(inhalt)) as z:
        with z.open(z.namelist()[0]) as f:
            roh = f.read().decode()
    erste = roh.split("\n", 1)[0]
    kopf = 0 if any(c.isalpha() for c in erste) else None
    return pd.read_csv(io.StringIO(roh), header=kopf)


def lade_kerzen(symbol: str, intervall: str, start: str) -> pd.DataFrame:
    """Monatliche Kerzen-Archive laden und lokal zwischenspeichern."""
    ordner = CACHE / "kerzen" / symbol / intervall
    ordner.mkdir(parents=True, exist_ok=True)
    teile = []
    for monat in _monate(start):
        datei = ordner / f"{monat}.csv"
        if not datei.exists():
            roh = _hole(f"{ARCHIV}/klines/{symbol}/{intervall}/{symbol}-{intervall}-{monat}.zip")
            if roh is None:
                continue
            df = _csv_aus_zip(roh)
            df = df.iloc[:, :6]
            df.columns = SPALTEN[:6]
            df.to_csv(datei, index=False)
        teile.append(pd.read_csv(datei))
    df = pd.concat(teile, ignore_index=True)
    return _aufbereiten(df)


def lade_funding(symbol: str, start: str) -> pd.Series:
    """Historische Funding-Raten (alle 8 h) als Serie, Index = Zeitpunkt."""
    ordner = CACHE / "funding" / symbol
    ordner.mkdir(parents=True, exist_ok=True)
    teile = []
    for monat in _monate(start):
        datei = ordner / f"{monat}.csv"
        if not datei.exists():
            roh = _hole(f"{ARCHIV}/fundingRate/{symbol}/{symbol}-fundingRate-{monat}.zip")
            if roh is None:
                continue
            df = _csv_aus_zip(roh)
            df = df.iloc[:, [0, 2]] if df.shape[1] >= 3 else df.iloc[:, :2]
            df.columns = ["zeit", "rate"]
            df.to_csv(datei, index=False)
        teile.append(pd.read_csv(datei))
    if not teile:
        return pd.Series(dtype=float)
    df = pd.concat(teile, ignore_index=True)
    df["zeit"] = pd.to_datetime(df["zeit"], unit="ms", utc=True)
    return df.set_index("zeit")["rate"].astype(float).sort_index()


def lade_live_kerzen(symbol: str, intervall: str, anzahl: int = 400) -> pd.DataFrame:
    """Aktuelle Kerzen (Spot-Kurse, für Paper-Trading ausreichend genau)."""
    roh = _hole(f"{LIVE}?symbol={symbol}&interval={intervall}&limit={anzahl}")
    if roh is None:
        raise ConnectionError(f"Keine Live-Daten für {symbol}")
    df = pd.DataFrame(json.loads(roh), columns=SPALTEN).iloc[:, :7]
    df = df[df["close_time"] < time.time() * 1000]   # nur abgeschlossene Kerzen
    return _aufbereiten(df.iloc[:, :6])


def _aufbereiten(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    zeit = pd.to_numeric(df["open_time"])
    # Ab 2025 liefert das Archiv teils Mikrosekunden statt Millisekunden
    zeit = zeit.where(zeit < 1e14, zeit // 1000)
    df.index = pd.to_datetime(zeit, unit="ms", utc=True)
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    return df[~df.index.duplicated()].sort_index()
