import os
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.db import CourseCost, CourseTariff, FxRate, init_db, make_engine
from app.fx import _used_currencies, store_rates

D = date(2026, 6, 7)


@pytest.fixture()
def db():
    engine = make_engine(os.environ.get("TEST_DATABASE_URL", "sqlite://"))
    init_db(engine)
    with sessionmaker(bind=engine)() as session:
        yield session


def test_store_rates_inverts_er_api_payload(db):
    # er-api отдаёт base→currency (1 USD = 7.8 HKD); нам нужен currency→base
    api_rates = {"USD": 1, "HKD": 7.8, "KZT": 512.0, "EUR": 0.92}
    n = store_rates(db, "USD", api_rates, currencies={"HKD", "KZT"}, rate_date=D)
    assert n == 2
    rows = {r.currency: r for r in db.scalars(select(FxRate)).all()}
    assert set(rows) == {"HKD", "KZT"}  # EUR не нужен, USD — база
    assert rows["HKD"].rate_to_base == pytest.approx(Decimal(1) / Decimal("7.8"))
    assert rows["HKD"].rate_date == D


def test_store_rates_pegs_usdt_to_usd(db):
    # er-api не отдаёт крипту: USDT приравнивается к USD через peg
    api_rates = {"USD": 1, "KZT": 512.0}
    n = store_rates(db, "USD", api_rates, currencies={"USDT", "KZT"}, rate_date=D)
    assert n == 2
    rows = {r.currency: r for r in db.scalars(select(FxRate)).all()}
    assert rows["USDT"].rate_to_base == Decimal("1")


def test_store_rates_skips_existing_date_and_unknown_currency(db):
    api_rates = {"USD": 1, "HKD": 7.8}
    store_rates(db, "USD", api_rates, currencies={"HKD"}, rate_date=D)
    # повторный прогон того же дня — без дублей
    n = store_rates(db, "USD", api_rates, currencies={"HKD", "XXX"}, rate_date=D)
    assert n == 0
    assert len(db.scalars(select(FxRate)).all()) == 1


def test_used_currencies_includes_course_tariffs_and_cost(db):
    db.add(CourseTariff(name="Базовый", price=Decimal("500"), currency="KZT", students=10))
    db.add(CourseCost(name="Реклама", amount=Decimal("100"), currency="EUR", kind="monthly"))
    db.commit()
    used = _used_currencies(db)
    assert "KZT" in used and "EUR" in used
