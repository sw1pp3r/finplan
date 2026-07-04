"""Движок юнит-экономики сервиса: MRR − COGS (fixed / per_client / per_unit × usage)."""
from decimal import Decimal

from app.services_econ import SvcCost, SvcTariff, compute_service

R = {"USD": Decimal("1")}
D = Decimal


def test_empty_service():
    res = compute_service(tariffs=[], costs=[], rates=R)
    assert res.mrr == 0 and res.cogs_monthly == 0 and res.net_monthly == 0
    assert res.margin_pct is None


def test_mrr_and_fixed():
    res = compute_service(
        tariffs=[SvcTariff("Pro", D("50"), "USD", 10, False, {})],
        costs=[SvcCost(1, "хостинг", D("20"), "USD", "fixed", 1)],
        rates=R,
    )
    assert res.mrr == D("500")
    assert res.fixed_monthly == D("20")
    assert res.net_monthly == D("480")
    assert res.margin_pct == D("480") / D("500")


def test_per_client_cost():
    res = compute_service(
        tariffs=[SvcTariff("A", D("10"), "USD", 3, False, {}),
                 SvcTariff("B", D("20"), "USD", 2, False, {})],
        costs=[SvcCost(1, "саппорт", D("2"), "USD", "per_client", 1)],
        rates=R,
    )
    assert res.clients_total == 5
    assert res.per_client_monthly == D("10")  # 2 × 5


def test_per_unit_with_unit_size_and_usage():
    # Apify $3.80 за 1000 роликов; тариф Managed: 5000 роликов/клиента/мес × 4 клиента
    apify = SvcCost(7, "Apify", D("3.80"), "USD", "per_unit", 1000)
    res = compute_service(
        tariffs=[SvcTariff("Managed", D("99"), "USD", 4, False, {7: D("5000")})],
        costs=[apify],
        rates=R,
    )
    assert res.per_unit_monthly == D("3.80") / 1000 * 5000 * 4  # 76.00
    assert res.cogs_monthly == D("76")


def test_net_per_client_zero_clients_includes_var_costs():
    apify = SvcCost(7, "Apify", D("3.80"), "USD", "per_unit", 1000)
    support = SvcCost(8, "саппорт", D("7"), "USD", "per_client", 1)
    res = compute_service(
        tariffs=[SvcTariff("Planned", D("99"), "USD", 0, False, {7: D("5000")})],
        costs=[apify, support],
        rates=R,
    )
    assert res.by_tariff[0]["net_per_client"] == D("73")  # 99 - 19 - 7


def test_byo_zero_usage():
    apify = SvcCost(7, "Apify", D("3.80"), "USD", "per_unit", 1000)
    res = compute_service(
        tariffs=[SvcTariff("BYO", D("49"), "USD", 3, True, {7: D("0")})],
        costs=[apify],
        rates=R,
    )
    assert res.per_unit_monthly == 0
    assert res.by_tariff[0]["net_per_client"] == D("49")


def test_multicurrency_and_missing_rate():
    rates = {"USD": D("1"), "EUR": D("1.1")}
    res = compute_service(
        tariffs=[SvcTariff("X", D("100"), "EUR", 1, False, {})],
        costs=[SvcCost(1, "KZT-строка", D("999"), "KZT", "fixed", 1)],  # нет курса → 0
        rates=rates,
    )
    assert res.mrr == D("110.0")
    assert res.fixed_monthly == 0


def test_by_tariff_var_cost_allocation():
    llm = SvcCost(2, "LLM", D("1"), "USD", "per_unit", 100)
    sup = SvcCost(3, "саппорт", D("5"), "USD", "per_client", 1)
    res = compute_service(
        tariffs=[SvcTariff("Pro", D("100"), "USD", 2, False, {2: D("300")})],
        costs=[llm, sup],
        rates=R,
    )
    t = res.by_tariff[0]
    # per_unit: 1/100 × 300 × 2 = 6; per_client: 5 × 2 = 10
    assert t["var_cost_base"] == D("16")
    assert t["net_per_client"] == D("100") - D("8")  # 100 − (3 + 5)


def test_trendwatcher_preset_rows():
    from sqlalchemy.orm import sessionmaker
    from app.db import ServiceCost, ServiceTariff, ServiceTariffUsage, init_db, make_engine
    from app.service_presets import PRESETS, apply_preset
    from sqlalchemy import select

    assert "trendwatcher" in PRESETS
    engine = make_engine("sqlite://")
    init_db(engine, seed=False)
    with sessionmaker(bind=engine)() as db:
        svc = apply_preset(db, "trendwatcher")
        db.commit()
        costs = db.scalars(select(ServiceCost).where(ServiceCost.service_id == svc.id)).all()
        tariffs = db.scalars(select(ServiceTariff).where(ServiceTariff.service_id == svc.id)).all()
        apify = next(c for c in costs if "Apify" in c.name)
        assert apify.kind == "per_unit" and float(apify.amount) == 3.80 and apify.unit_size == 1000
        assert any(t.is_byo for t in tariffs)
        # у BYO-тарифа потребление по Apify = 0
        byo = next(t for t in tariffs if t.is_byo)
        usage = db.scalars(select(ServiceTariffUsage).where(
            ServiceTariffUsage.tariff_id == byo.id, ServiceTariffUsage.cost_id == apify.id)).all()
        assert all(float(u.units_per_client_month) == 0 for u in usage)
