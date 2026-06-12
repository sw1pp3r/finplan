"""Демо-данные для локальной разработки: python scripts/seed_demo.py (пишет в demo.db).

Датасет живёт в app/demo.py (один источник правды с in-memory демо-режимом).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker

from app.db import Account, init_db, make_engine
from app.demo import seed_demo_data

DB = os.environ.get("DATABASE_URL", "sqlite:///./demo.db")
engine = make_engine(DB)
init_db(engine)

with sessionmaker(bind=engine)() as db:
    if db.query(Account).count():
        print("already seeded, skip")
        raise SystemExit(0)
    seed_demo_data(db)
    print(f"seeded {DB}")
