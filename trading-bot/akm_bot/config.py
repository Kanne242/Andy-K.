import tomllib
from pathlib import Path

BASIS = Path(__file__).resolve().parent.parent


def lade_config(pfad: str | Path | None = None) -> dict:
    pfad = Path(pfad) if pfad else BASIS / "config.toml"
    with open(pfad, "rb") as f:
        return tomllib.load(f)
