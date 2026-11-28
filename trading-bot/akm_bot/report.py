"""Kennzahlen und Bericht."""
import numpy as np
import pandas as pd


def kennzahlen(kurve: pd.Series, trades: list | None = None) -> dict:
    taeglich = kurve.resample("1D").last().dropna()
    ret = taeglich.pct_change().dropna()
    jahre = max((taeglich.index[-1] - taeglich.index[0]).days / 365.25, 1e-9)
    start, ende = taeglich.iloc[0], taeglich.iloc[-1]
    dd = (taeglich / taeglich.cummax() - 1).min()
    sharpe = ret.mean() / ret.std() * np.sqrt(365) if ret.std() > 0 else 0.0
    neg = ret[ret < 0]
    sortino = ret.mean() / neg.std() * np.sqrt(365) if len(neg) > 1 else 0.0
    cagr = (ende / start) ** (1 / jahre) - 1 if ende > 0 else -1.0
    k = {
        "Startwert": round(start, 2), "Endwert": round(ende, 2),
        "Gesamtrendite": f"{ende / start - 1:+.1%}", "Rendite p.a. (CAGR)": f"{cagr:+.1%}",
        "Max. Drawdown": f"{dd:.1%}", "Sharpe": round(sharpe, 2), "Sortino": round(sortino, 2),
        "Rendite/Drawdown": round(cagr / abs(dd), 2) if dd < 0 else None,
    }
    if trades is not None:
        n = [t["netto"] for t in trades]
        gew = [x for x in n if x > 0]
        verl = [x for x in n if x <= 0]
        k.update({
            "Trades": len(n),
            "Trefferquote": f"{len(gew) / len(n):.0%}" if n else "-",
            "Profit-Faktor": round(sum(gew) / abs(sum(verl)), 2) if verl and sum(verl) else None,
            "Gebühren gesamt": round(sum(t["gebuehren"] for t in trades), 2),
            "Funding gesamt": round(sum(t["funding"] for t in trades), 2),
        })
    return k


def jahresrenditen(kurve: pd.Series) -> pd.Series:
    j = kurve.resample("YE").last()
    vorher = pd.concat([pd.Series([kurve.iloc[0]]), j.iloc[:-1]]).values
    return pd.Series(j.values / vorher - 1, index=j.index.year)


def chart(kurven: dict, pfad):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(11, 7), sharex=True,
                                 gridspec_kw={"height_ratios": [3, 1]})
    for name, k in kurven.items():
        a1.plot(k.index, k.values, label=name, lw=1.4)
        a2.plot(k.index, (k / k.cummax() - 1) * 100, lw=1)
    a1.set_yscale("log"); a1.set_ylabel("Kontowert (log)"); a1.legend(); a1.grid(alpha=.3)
    a2.set_ylabel("Drawdown %"); a2.grid(alpha=.3)
    a1.set_title("AKM Trading Bot – Backtest inkl. Gebühren, Slippage, Funding")
    fig.tight_layout(); fig.savefig(pfad, dpi=110); plt.close(fig)
