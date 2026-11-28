#!/usr/bin/env python3
"""Backtest ausführen und Bericht nach berichte/ schreiben.

  python run_backtest.py
"""
import copy
from pathlib import Path

import pandas as pd

from akm_bot.backtest import backtest, buy_and_hold, lade_markt
from akm_bot.config import lade_config
from akm_bot.report import chart, jahresrenditen, kennzahlen

AUS = Path(__file__).parent / "berichte"


def tabelle(zeilen: dict) -> str:
    spalten = list(next(iter(zeilen.values())))
    t = "| | " + " | ".join(spalten) + " |\n|---|" + "---|" * len(spalten) + "\n"
    for name, w in zeilen.items():
        t += f"| {name} | " + " | ".join(str(w.get(s, "")) for s in spalten) + " |\n"
    return t


def main():
    cfg = lade_config()
    AUS.mkdir(exist_ok=True)
    print("Lade Daten …")
    daten, funding = lade_markt(cfg)

    eng, kurve = backtest(cfg, daten, funding)
    bh = buy_and_hold(cfg, daten, kurve)
    k_bot, k_bh = kennzahlen(kurve.equity, eng.k.trades), kennzahlen(bh)

    # Hebel-Stufen
    stufen = {}
    for name, risk, lev in [("Vorsichtig (0,5 %, 1x)", .005, 1), ("Ohne Hebel (1 %, 1x)", .01, 1),
                            ("STANDARD (1,5 %, max 2x)", .015, 2), ("Aggressiv (2 %, max 2x)", .02, 2),
                            ("Zocker (3 %, max 3x)", .03, 3)]:
        c = copy.deepcopy(cfg)
        c["risiko"].update(risiko_pro_trade=risk, max_hebel_gesamt=lev, max_hebel_position=lev * .75)
        e, k = backtest(c, daten, funding)
        m = kennzahlen(k.equity, e.k.trades)
        stufen[name] = {s: m[s] for s in ["Endwert", "Rendite p.a. (CAGR)", "Max. Drawdown", "Sharpe", "Gebühren gesamt", "Funding gesamt"]}

    # Zeitraum-Test (vorher / nachher)
    teile = {}
    for name, von, bis in [("2020–2022", None, "2023-01-01"), ("2023–heute", "2023-01-01", None)]:
        e, k = backtest(cfg, daten, funding, von, bis)
        m = kennzahlen(k.equity, e.k.trades)
        teile[name] = {s: m[s] for s in ["Rendite p.a. (CAGR)", "Max. Drawdown", "Sharpe", "Trades"]}

    jr = pd.DataFrame({"Bot": jahresrenditen(kurve.equity), "Kaufen & Halten": jahresrenditen(bh)})
    chart({"AKM Bot": kurve.equity, "Kaufen & Halten (ohne Hebel)": bh}, AUS / "backtest.png")
    pd.DataFrame(eng.k.trades).to_csv(AUS / "backtest_trades.csv", index=False)

    s = cfg["strategie"]; r = cfg["risiko"]
    md = f"""# AKM Trading Bot – Backtest-Bericht

Zeitraum: {kurve.index[0]:%d.%m.%Y} – {kurve.index[-1]:%d.%m.%Y} · Märkte: {', '.join(cfg['markt']['symbole'])} · Zeitrahmen: {cfg['markt']['zeitrahmen']}
Strategie: Donchian-Ausbruch {s['einstieg_lookback']} Kerzen, EMA-{s['trendfilter_ema']}-Trendfilter, Stop {s['stop_atr']} ATR (nachgezogen), Long + Short
Risiko: {r['risiko_pro_trade']:.1%} pro Trade, max. {r['max_hebel_gesamt']}x Hebel gesamt
Kosten: {cfg['kosten']['gebuehr_taker']:.2%} Gebühr + {cfg['kosten']['slippage']:.2%} Slippage pro Order, echte historische Funding-Raten

![Backtest](backtest.png)

## Ergebnis Standard-Einstellung

{tabelle({"AKM Bot": k_bot, "Kaufen & Halten": k_bh})}

## Hebel-Stufen im Vergleich

{tabelle(stufen)}

## Funktioniert es auch in einem anderen Zeitraum?

{tabelle(teile)}

## Jahresrenditen

{tabelle({str(j): {c: f"{jr.loc[j, c]:+.1%}" for c in jr.columns} for j in jr.index})}

> Vergangene Ergebnisse sind keine Garantie. Der Backtest nutzt Futures-Kurse von Binance;
> echte Ausführung, Ausfälle und Börsenregeln können schlechter sein.
"""
    (AUS / "BERICHT.md").write_text(md)
    print(md)


if __name__ == "__main__":
    main()
