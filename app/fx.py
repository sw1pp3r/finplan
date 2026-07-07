"""Курсы валют: open.er-api.com раз в сутки + ручной фолбэк (ТЗ §8)."""
import logging
from datetime import date
from decimal import Decimal

import httpx
from sqlalchemy import select

from .db import (
    Account,
    CourseCost,
    CourseTariff,
    FxRate,
    InflowRow,
    ObligationRow,
    ServiceCost,
    ServiceTariff,
    Wish,
)

log = logging.getLogger("finplan.fx")

ER_API_URL = "https://open.er-api.com/v6/latest/{base}"

# Стейблкоины приравниваем к фиату: er-api крипту не отдаёт
PEGS = {"USDT": "USD", "USDC": "USD"}


def store_rates(db, base_currency: str, api_rates: dict, currencies: set, rate_date: date | None = None) -> int:
    """Пишет rate_to_base для нужных валют из payload er-api (base→cur). Возвращает число записей."""
    rate_date = rate_date or date.today()
    written = 0
    for cur in sorted(currencies):
        effective = PEGS.get(cur, cur)
        if cur == base_currency or effective not in api_rates:
            continue
        exists = db.scalar(
            select(FxRate).where(FxRate.rate_date == rate_date, FxRate.currency == cur).limit(1)
        )
        if exists is not None:
            continue
        rate = Decimal("1") / Decimal(str(api_rates[effective]))
        db.add(FxRate(rate_date=rate_date, currency=cur, rate_to_base=rate))
        written += 1
    db.commit()
    return written


def _used_currencies(db) -> set:
    used = set(db.scalars(select(Account.currency).where(Account.is_active.is_(True))).all())
    used |= set(db.scalars(select(ObligationRow.currency)).all())
    used |= set(db.scalars(select(InflowRow.currency)).all())
    used |= set(db.scalars(select(Wish.currency).where(Wish.status == "active")).all())
    used |= set(db.scalars(select(CourseTariff.currency)).all())
    used |= set(db.scalars(select(CourseCost.currency)).all())
    used |= set(db.scalars(select(ServiceTariff.currency)).all())
    used |= set(db.scalars(select(ServiceCost.currency)).all())
    return used


def fetch_and_store(app, extra: set | None = None) -> int:
    """Тянет курсы для всех используемых валют (+ опц. `extra` — например, новой базовой
    валюты, для которой ещё нет курса). Ошибки сети не роняют приложение — прогноз
    работает на последнем известном курсе (фолбэк по ТЗ §8)."""
    from .service import get_settings

    with app.state.SessionLocal() as db:
        base = get_settings(db).base_currency
        currencies = _used_currencies(db)
        if extra:
            currencies |= {c.upper() for c in extra if c}
        if not currencies - {base}:
            return 0
        try:
            resp = httpx.get(ER_API_URL.format(base=base), timeout=20)
            resp.raise_for_status()
            payload = resp.json()
            if payload.get("result") != "success":
                raise ValueError(f"er-api result={payload.get('result')}")
        except Exception as e:  # noqa: BLE001 — любой сбой сети = работаем на старом курсе
            log.warning("fx fetch failed, using last known rates: %s", e)
            return 0
        return store_rates(db, base, payload["rates"], currencies)


def start_fx_scheduler(app) -> None:
    from apscheduler.schedulers.background import BackgroundScheduler

    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(lambda: fetch_and_store(app), "cron", hour=6, minute=0)
    scheduler.start()
    app.state.fx_scheduler = scheduler
    fetch_and_store(app)  # первый фетч сразу при старте
