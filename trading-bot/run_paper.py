#!/usr/bin/env python3
"""Paper-Trading starten.

  python run_paper.py            # Dauerbetrieb (läuft rund um die Uhr)
  python run_paper.py --einmal   # ein Durchlauf (z. B. für Cron)
  python run_paper.py --status   # aktuellen Stand anzeigen
"""
import sys

from akm_bot.config import lade_config
from akm_bot.paper import PaperBot, dauerbetrieb

if __name__ == "__main__":
    cfg = lade_config()
    if "--status" in sys.argv:
        print(PaperBot(cfg).status())
    elif "--einmal" in sys.argv:
        bot = PaperBot(cfg)
        for e in bot.durchlauf():
            print(e)
        print(bot.status())
    else:
        dauerbetrieb(cfg)
