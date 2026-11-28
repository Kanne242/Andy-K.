"""Positionsgröße und Hebelgrenzen."""


def positionsgroesse(konto: float, preis: float, stop_abstand: float,
                     belegter_nominalwert: float, cfg: dict) -> float:
    """Menge so, dass ein Stop-Treffer ~risiko_pro_trade des Kontos kostet,
    begrenzt durch Positions- und Gesamthebel."""
    r = cfg["risiko"]
    if konto <= 0 or stop_abstand <= 0:
        return 0.0
    menge = konto * r["risiko_pro_trade"] / stop_abstand
    max_pos = konto * r["max_hebel_position"] / preis
    frei = max(0.0, konto * r["max_hebel_gesamt"] - belegter_nominalwert) / preis
    return max(0.0, min(menge, max_pos, frei))
