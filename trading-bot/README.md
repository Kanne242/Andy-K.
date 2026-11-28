# AKM Trading Bot

Automatischer Krypto-Trading-Bot (BTC und ETH Perpetual Futures) mit Trendfolge-Strategie,
moderatem Hebel und strengem Risikomanagement. Läuft rund um die Uhr im Hintergrund.

**Aktueller Stand: Backtest und Paper-Trading (Spielgeld).** Echte Orders an eine Börse sind
bewusst noch nicht eingebaut. Das ist der nächste Schritt, sobald das Paper-Trading
einige Wochen nachvollziehbar läuft.

## Ergebnis im Backtest (01/2020 – 10/2026, inkl. aller Kosten)

| | Bot (Standard) | Kaufen & Halten |
|---|---|---|
| Rendite pro Jahr | **+31,7 %** | +47,2 % |
| Größter Verlust zwischendurch | **-23,6 %** | -77,9 % |
| Sharpe (Rendite je Risiko) | **1,13** | 0,91 |
| 2022 (Krypto-Crash) | **+7,8 %** | -66,9 % |

Vollständiger Bericht mit Chart: [`berichte/BERICHT.md`](berichte/BERICHT.md)

Ehrlich eingeordnet: In starken Bullenjahren (2020, 2021) verdient einfaches Halten mehr.
Die Stärke des Bots liegt darin, Crashs zu überstehen und auch in fallenden Märkten
(Short) zu verdienen. Realistisch für die Zukunft: eher **10–25 % pro Jahr** mit Phasen
von Verlusten. Vergangene Ergebnisse sind keine Garantie.

## So funktioniert die Strategie

1. **Einstieg:** Der Kurs schließt über dem Hoch der letzten 20 Kerzen (4 h) **und** liegt
   über dem 200er-Durchschnitt → Long. Spiegelbildlich für Short.
2. **Stop-Loss:** 3 × ATR (durchschnittliche Schwankung) vom Einstieg, wird bei Gewinn
   automatisch nachgezogen, nie zurück.
3. **Positionsgröße:** So berechnet, dass ein Stop-Treffer **1,5 % des Kontos** kostet.
4. **Hebel:** maximal **2x** auf das ganze Konto, im Schnitt nur ca. 0,4x genutzt.
5. **Notbremsen:** ab -5 % an einem Tag keine neuen Trades; ab -30 % vom Höchststand
   alles schließen und 30 Tage Pause.

### Warum nicht mehr Hebel?

| Einstellung | Rendite p.a. | Größter Verlust | Sharpe |
|---|---|---|---|
| 1 % Risiko, 1x | +21,4 % | -16,4 % | 1,13 |
| **1,5 % Risiko, max 2x (Standard)** | **+31,7 %** | **-23,6 %** | **1,13** |
| 2 % Risiko, max 2x | +34,2 % | -42,3 % | 1,02 |
| 3 % Risiko, max 3x | +37,6 % | -57,1 % | 0,89 |

Über dem Standard bringt jeder Schritt kaum mehr Rendite, aber deutlich höhere Verluste
und mehr Gebühren. Der Standard ist der Punkt, an dem das Verhältnis noch stimmt.

### Robustheit geprüft

- 36 Parameter-Kombinationen getestet; auf 4 h waren alle 18 in beiden Zeiträumen profitabel
- 2020–2022 und 2023–heute liefern fast identische Ergebnisse (+32 % / +32 % p.a.)
- Signale eine Kerze verzögert: gleiches Ergebnis → kein versehentlicher Blick in die Zukunft
- Doppelte Gebühren und Slippage: immer noch +25,7 % p.a.

## Installation

Voraussetzung: Python 3.11 oder neuer.

```bash
cd trading-bot
pip install -r requirements.txt
python run_backtest.py          # Backtest + Bericht in berichte/
python run_paper.py             # Paper-Trading im Dauerbetrieb
python run_paper.py --status    # aktuellen Stand anzeigen
```

### Rund um die Uhr laufen lassen

- **Raspberry Pi oder kleiner Linux-Server (ca. 4–5 €/Monat):** `akm-bot.service` nutzen,
  Anleitung steht in der Datei. Startet nach Stromausfall oder Neustart automatisch.
- **Windows-PC:** `python run_paper.py` in einem Fenster offen lassen; der PC darf dann
  aber nicht in den Ruhezustand gehen.

### Benachrichtigung aufs Handy (optional)

1. In Telegram bei `@BotFather` einen Bot anlegen und den Token notieren
2. In `config.toml` unter `[telegram]` `aktiv = true` setzen
3. Token und Chat-ID als Umgebungsvariablen `AKM_TELEGRAM_TOKEN` / `AKM_TELEGRAM_CHAT`
   setzen (niemals in Dateien im Repo eintragen)

Du bekommst dann jede Order und einen täglichen Bericht.

## Dateien

| Pfad | Inhalt |
|---|---|
| `config.toml` | alle Einstellungen (Märkte, Strategie, Risiko, Kosten) |
| `akm_bot/engine.py` | Handelslogik, identisch für Backtest und Paper-Trading |
| `akm_bot/strategy.py` | Indikatoren und Signale |
| `akm_bot/risk.py` | Positionsgröße und Hebelgrenzen |
| `berichte/` | Backtest-Bericht, Chart, alle Trades als CSV |
| `zustand/` | Paper-Konto, Trades, Kontoverlauf (wird lokal angelegt) |

## Vor dem Einsatz von echtem Geld

- **Börse:** Für Deutschland/EU eignet sich z. B. **Kraken Futures** (EU-reguliert,
  kleine Mindestgrößen ab 0,0001 BTC). Bei Binance Futures liegt die Mindestgröße
  bei 0,001 BTC (ca. 60 USDT). Mit 100 € wären dort BTC-Trades oft zu klein.
- **Erst 4–8 Wochen Paper-Trading** laufen lassen und mit dem Backtest vergleichen.
- **API-Schlüssel nur mit Handelsrecht, niemals mit Auszahlungsrecht** anlegen.
- **Steuern:** Gewinne aus Krypto-Derivaten sind in Deutschland steuerpflichtig;
  Trades werden in `zustand/paper_trades.csv` bzw. später im Live-Log protokolliert.
- Nur Geld einsetzen, dessen Verlust dich nicht belastet.
