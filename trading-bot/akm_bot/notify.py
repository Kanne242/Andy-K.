"""Optionale Telegram-Benachrichtigung (Token nur über Umgebungsvariablen)."""
import json
import os
import urllib.parse
import urllib.request


def sende(text: str, cfg: dict) -> None:
    if not cfg.get("telegram", {}).get("aktiv"):
        return
    token, chat = os.environ.get("AKM_TELEGRAM_TOKEN"), os.environ.get("AKM_TELEGRAM_CHAT")
    if not token or not chat:
        return
    daten = urllib.parse.urlencode({"chat_id": chat, "text": text[:4000]}).encode()
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", daten, timeout=15)
    except Exception as e:
        print("Telegram-Fehler:", e)
