"""Local SQLite CRUD for demo portfolios and their weighted holdings."""

import argparse
import json
import math
import sqlite3
from contextlib import closing
from pathlib import Path


DATABASE = Path(__file__).resolve().parent / "data" / "portfolios.sqlite3"
SAMPLE_TICKERS = ("AAPL", "GOOGL", "GE", "BRK-B", "AVGO", "NVDA", "HLT")


def connect(path: Path = DATABASE) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS portfolios (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS holdings (
            portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
            asset_id TEXT NOT NULL,
            weight REAL NOT NULL CHECK (weight > 0 AND weight <= 1),
            PRIMARY KEY (portfolio_id, asset_id)
        );
    """)
    return db


def portfolio(db: sqlite3.Connection, name: str) -> dict:
    row = db.execute("SELECT id FROM portfolios WHERE name = ?", (name,)).fetchone()
    if row is None:
        raise ValueError(f"Portfolio does not exist: {name}")
    holdings = db.execute("SELECT asset_id, weight FROM holdings WHERE portfolio_id = ? ORDER BY asset_id", (row[0],)).fetchall()
    return {"id": row[0], "name": name, "holdings": [{"asset_id": asset_id, "weight": weight} for asset_id, weight in holdings]}


def set_holding(db: sqlite3.Connection, name: str, asset_id: str, weight: float) -> None:
    if not math.isfinite(weight) or not 0 < weight <= 1:
        raise ValueError("weight must be finite and in (0, 1]")
    row = db.execute("SELECT id FROM portfolios WHERE name = ?", (name,)).fetchone()
    if row is None:
        raise ValueError(f"Portfolio does not exist: {name}")
    portfolio_id = row[0]
    previous = db.execute("SELECT COALESCE(SUM(weight), 0) FROM holdings WHERE portfolio_id = ? AND asset_id != ?", (portfolio_id, asset_id.upper())).fetchone()[0]
    if previous + weight > 1.000001:
        raise ValueError("Portfolio weights would exceed 1")
    db.execute("INSERT INTO holdings (portfolio_id, asset_id, weight) VALUES (?, ?, ?) ON CONFLICT(portfolio_id, asset_id) DO UPDATE SET weight = excluded.weight", (portfolio_id, asset_id.upper(), weight))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("seed", "create", "list", "set", "remove", "delete"))
    parser.add_argument("name", nargs="?", default="Sample Portfolio")
    parser.add_argument("asset_id", nargs="?")
    parser.add_argument("weight", nargs="?", type=float)
    args = parser.parse_args()
    with closing(connect()) as db, db:
        if args.action == "seed":
            db.execute("INSERT OR IGNORE INTO portfolios(name) VALUES (?)", (args.name,))
            if not portfolio(db, args.name)["holdings"]:
                for asset_id in SAMPLE_TICKERS:
                    set_holding(db, args.name, asset_id, 1 / len(SAMPLE_TICKERS))
        elif args.action == "create":
            db.execute("INSERT INTO portfolios(name) VALUES (?)", (args.name,))
        elif args.action == "set":
            if not args.asset_id or args.weight is None:
                parser.error("set requires NAME ASSET_ID WEIGHT")
            set_holding(db, args.name, args.asset_id, args.weight)
        elif args.action == "remove":
            if not args.asset_id:
                parser.error("remove requires NAME ASSET_ID")
            db.execute("DELETE FROM holdings WHERE portfolio_id = (SELECT id FROM portfolios WHERE name = ?) AND asset_id = ?", (args.name, args.asset_id.upper()))
        elif args.action == "delete":
            db.execute("DELETE FROM portfolios WHERE name = ?", (args.name,))
        if args.action == "list" and args.name == "Sample Portfolio":
            names = [row[0] for row in db.execute("SELECT name FROM portfolios ORDER BY name")]
            print(json.dumps([portfolio(db, name) for name in names], indent=2))
        elif args.action != "delete":
            print(json.dumps(portfolio(db, args.name), indent=2))


if __name__ == "__main__":
    main()
