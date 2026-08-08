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


def test_byo_ignores_provider_usage_but_keeps_hosting_and_support():
    apify = SvcCost(7, "Apify", D("3.80"), "USD", "per_unit", 1000)
    hosting = SvcCost(8, "hosting", D("20"), "USD", "fixed", 1)
    support = SvcCost(9, "support", D("7"), "USD", "per_client", 1)
    res = compute_service(
        tariffs=[SvcTariff("BYO", D("49"), "USD", 3, True, {7: D("5000")})],
        costs=[apify, hosting, support],
        rates=R,
    )
    assert res.per_unit_monthly == 0
    assert res.fixed_monthly == D("20")
    assert res.per_client_monthly == D("21")
    assert res.by_tariff[0]["net_per_client"] == D("42")


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
    from app.db import (
        ServiceCost, ServiceTariff, TrendWatcherConfig, TrendWatcherScenario,
        init_db, make_engine,
    )
    from app.service_presets import PRESETS, TRENDWATCHER_PRESET_VERSION, apply_preset
    from sqlalchemy import select

    assert "trendwatcher" in PRESETS
    engine = make_engine("sqlite://")
    init_db(engine, seed=False)
    with sessionmaker(bind=engine)() as db:
        svc = apply_preset(db, "trendwatcher")
        db.commit()
        costs = db.scalars(select(ServiceCost).where(ServiceCost.service_id == svc.id)).all()
        tariffs = db.scalars(select(ServiceTariff).where(ServiceTariff.service_id == svc.id)).all()
        config = db.get(TrendWatcherConfig, svc.id)
        scenarios = db.scalars(select(TrendWatcherScenario).where(
            TrendWatcherScenario.service_id == svc.id)).all()

        assert svc.preset_key == "trendwatcher"
        assert svc.preset_version == TRENDWATCHER_PRESET_VERSION
        assert {(c.name, c.kind) for c in costs} == {
            ("Хостинг", "fixed"), ("Поддержка", "per_client"),
        }
        assert any(t.is_byo for t in tariffs)
        assert config is not None and config.instagram_source == "scrapecreators"
        assert config.provider_allowance_usd == D("10")
        assert {s.key for s in scenarios} == {"low", "base", "stress"}


def test_legacy_placeholder_upgrade_is_fingerprint_guarded_and_idempotent():
    from sqlalchemy import func, select
    from sqlalchemy.orm import sessionmaker
    from app.db import (
        Service, ServiceCost, ServiceTariff, ServiceTariffUsage,
        TrendWatcherConfig, TrendWatcherScenario, init_db, make_engine,
    )
    from app.service_presets import TRENDWATCHER_PRESET_VERSION

    engine = make_engine("sqlite://")
    init_db(engine, seed=False)
    # Mirror Postgres FK enforcement: the guarded upgrade must delete child
    # usage rows before their tariff/cost parents.
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")
    Session = sessionmaker(bind=engine)

    def add_legacy(db, *, note="юнит-экономика; цифры-плейсхолдеры до product-saas-spec"):
        svc = Service(name="TrendWatcher", note=note)
        db.add(svc)
        db.flush()
        costs = {}
        for i, values in enumerate((
            ("Apify (скрейпинг)", D("3.80"), "per_unit", "роликов", 1000),
            ("LLM-метр", D("1.00"), "per_unit", "вызовов", 1000),
            ("YouTube-квота (лимит, не деньги)", D("0.01"), "fixed", None, 1),
            ("Хостинг", D("20"), "fixed", None, 1),
        )):
            name, amount, kind, label, size = values
            row = ServiceCost(service_id=svc.id, name=name, amount=amount, currency="USD",
                              kind=kind, unit_label=label, unit_size=size, sort_order=i)
            db.add(row)
            db.flush()
            costs[name] = row.id
        for i, (name, price, is_byo, usage) in enumerate((
            ("Managed", D("99"), False,
             {"Apify (скрейпинг)": D("5000"), "LLM-метр": D("2000")}),
            # Production legacy preset carried the historical bug: the BYO row
            # had zero provider usage but is_byo itself was false.
            ("BYO keys", D("49"), False,
             {"Apify (скрейпинг)": D("0"), "LLM-метр": D("0")}),
        )):
            tariff = ServiceTariff(service_id=svc.id, name=name, price=price, currency="USD",
                                    clients=0, is_byo=is_byo, sort_order=i)
            db.add(tariff)
            db.flush()
            for cost_name, units in usage.items():
                db.add(ServiceTariffUsage(tariff_id=tariff.id, cost_id=costs[cost_name],
                                          units_per_client_month=units))
        return svc

    with Session() as db:
        exact = add_legacy(db)
        customized = add_legacy(db, note="моя ручная версия")
        other = Service(name="Другой сервис", note="не трогать")
        db.add(other)
        db.commit()
        exact_id, custom_id, other_id = exact.id, customized.id, other.id

    init_db(engine, seed=False)
    with Session() as db:
        exact = db.get(Service, exact_id)
        customized = db.get(Service, custom_id)
        other = db.get(Service, other_id)
        assert exact.preset_key == "trendwatcher"
        assert exact.preset_version == TRENDWATCHER_PRESET_VERSION
        assert db.get(TrendWatcherConfig, exact_id) is not None
        assert db.scalar(select(func.count()).select_from(TrendWatcherScenario).where(
            TrendWatcherScenario.service_id == exact_id)) == 3
        assert db.scalar(select(ServiceTariff).where(
            ServiceTariff.service_id == exact_id,
            ServiceTariff.name == "BYO keys",
        )).is_byo is True
        assert customized.preset_key is None and customized.note == "моя ручная версия"
        assert other.preset_key is None and other.name == "Другой сервис"
        counts = (
            db.scalar(select(func.count()).select_from(ServiceCost).where(ServiceCost.service_id == exact_id)),
            db.scalar(select(func.count()).select_from(ServiceTariff).where(ServiceTariff.service_id == exact_id)),
            db.scalar(select(func.count()).select_from(TrendWatcherScenario).where(
                TrendWatcherScenario.service_id == exact_id)),
        )

    init_db(engine, seed=False)
    with Session() as db:
        assert counts == (
            db.scalar(select(func.count()).select_from(ServiceCost).where(ServiceCost.service_id == exact_id)),
            db.scalar(select(func.count()).select_from(ServiceTariff).where(ServiceTariff.service_id == exact_id)),
            db.scalar(select(func.count()).select_from(TrendWatcherScenario).where(
                TrendWatcherScenario.service_id == exact_id)),
        )


def test_v2_trendwatcher_upgrade_preserves_client_scenario_and_user_edits():
    from sqlalchemy import select
    from sqlalchemy.orm import sessionmaker
    from app.db import (
        Service, ServiceCost, ServiceTariff, TrendWatcherConfig, TrendWatcherScenario,
        init_db, make_engine,
    )
    from app.service_presets import TRENDWATCHER_PRESET_VERSION, apply_preset

    engine = make_engine("sqlite://")
    init_db(engine, seed=False)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        exact = apply_preset(db, "trendwatcher")
        exact.preset_version = 2
        exact.note = "Операционная юнит-экономика v2; source-backed допущения редактируются ниже"
        v2_calls = {"low": 100, "base": 500, "stress": 1000}
        for row in db.scalars(select(TrendWatcherScenario).where(
                TrendWatcherScenario.service_id == exact.id)).all():
            row.llm_calls = v2_calls[row.key]
            row.llm_annotated_videos = row.llm_similarity_videos = 0
            row.llm_profile_rebuilds = row.llm_idea_candidates = row.llm_manual_calls = 0
        managed = db.scalar(select(ServiceTariff).where(
            ServiceTariff.service_id == exact.id,
            ServiceTariff.is_byo.is_(False),
        ))
        managed.clients = 5

        malformed = apply_preset(db, "trendwatcher")
        malformed.preset_version = 2
        malformed.note = exact.note
        for row in db.scalars(select(TrendWatcherScenario).where(
                TrendWatcherScenario.service_id == malformed.id)).all():
            row.llm_calls = v2_calls[row.key]
            row.llm_annotated_videos = row.llm_similarity_videos = 0
            row.llm_profile_rebuilds = row.llm_idea_candidates = row.llm_manual_calls = 0
        malformed_tariffs = db.scalars(select(ServiceTariff).where(
            ServiceTariff.service_id == malformed.id
        ).order_by(ServiceTariff.sort_order)).all()
        malformed_tariffs[0].clients = 5
        malformed_tariffs[0].is_byo = True
        malformed_tariffs[1].clients = 1

        customized = apply_preset(db, "trendwatcher")
        customized.preset_version = 2
        customized.note = exact.note
        for row in db.scalars(select(TrendWatcherScenario).where(
                TrendWatcherScenario.service_id == customized.id)).all():
            row.llm_calls = v2_calls[row.key]
            row.llm_annotated_videos = row.llm_similarity_videos = 0
            row.llm_profile_rebuilds = row.llm_idea_candidates = row.llm_manual_calls = 0
        custom_config = db.get(TrendWatcherConfig, customized.id)
        custom_config.llm_input_usd_per_million = D("0.99")
        db.commit()
        exact_id, malformed_id, customized_id = exact.id, malformed.id, customized.id

    init_db(engine, seed=False)
    with Session() as db:
        exact = db.get(Service, exact_id)
        malformed = db.get(Service, malformed_id)
        customized = db.get(Service, customized_id)
        assert exact.preset_version == TRENDWATCHER_PRESET_VERSION == 4
        assert db.scalar(select(ServiceTariff).where(
            ServiceTariff.service_id == exact_id,
            ServiceTariff.is_byo.is_(False),
        )).clients == 5
        base = db.scalar(select(TrendWatcherScenario).where(
            TrendWatcherScenario.service_id == exact_id,
            TrendWatcherScenario.key == "base",
        ))
        assert base.llm_calls == 0
        assert base.llm_annotated_videos > 0
        assert malformed.preset_version == TRENDWATCHER_PRESET_VERSION
        malformed_tariffs = db.scalars(select(ServiceTariff).where(
            ServiceTariff.service_id == malformed_id
        ).order_by(ServiceTariff.sort_order)).all()
        assert [(row.name, row.clients, row.is_byo) for row in malformed_tariffs] == [
            ("Managed", 5, False),
            ("BYO keys", 1, True),
        ]
        assert customized.preset_version == 2
        assert db.get(TrendWatcherConfig, customized_id).llm_input_usd_per_million == D("0.99")


def test_v3_trendwatcher_role_upgrade_repairs_only_canonical_pair_and_preserves_edits():
    from sqlalchemy import select
    from sqlalchemy.orm import sessionmaker
    from app.db import (
        Service, ServiceTariff, TrendWatcherConfig, TrendWatcherScenario, init_db, make_engine,
    )
    from app.service_presets import TRENDWATCHER_PRESET_VERSION, apply_preset

    engine = make_engine("sqlite://")
    init_db(engine, seed=False)
    Session = sessionmaker(bind=engine)

    with Session() as db:
        malformed = apply_preset(db, "trendwatcher")
        malformed.preset_version = 3
        malformed_tariffs = db.scalars(select(ServiceTariff).where(
            ServiceTariff.service_id == malformed.id
        ).order_by(ServiceTariff.sort_order)).all()
        malformed_tariffs[0].is_byo = True
        malformed_tariffs[0].clients = 5
        malformed_tariffs[0].price = D("123")
        db.get(TrendWatcherConfig, malformed.id).provider_allowance_usd = D("17")
        malformed_base = db.scalar(select(TrendWatcherScenario).where(
            TrendWatcherScenario.service_id == malformed.id,
            TrendWatcherScenario.key == "base",
        ))
        malformed_base.instagram_accounts = 12

        correct = apply_preset(db, "trendwatcher")
        correct.preset_version = 3

        customized = apply_preset(db, "trendwatcher")
        customized.preset_version = 3
        custom_managed = db.scalar(select(ServiceTariff).where(
            ServiceTariff.service_id == customized.id,
            ServiceTariff.sort_order == 0,
        ))
        custom_managed.name = "Agency"
        custom_managed.is_byo = True
        db.commit()
        malformed_id, correct_id, customized_id = malformed.id, correct.id, customized.id

    init_db(engine, seed=False)
    with Session() as db:
        assert TRENDWATCHER_PRESET_VERSION == 4
        malformed = db.get(Service, malformed_id)
        correct = db.get(Service, correct_id)
        customized = db.get(Service, customized_id)
        assert malformed.preset_version == 4
        assert correct.preset_version == 4
        assert customized.preset_version == 3

        malformed_tariffs = db.scalars(select(ServiceTariff).where(
            ServiceTariff.service_id == malformed_id
        ).order_by(ServiceTariff.sort_order)).all()
        assert [(row.name, row.is_byo) for row in malformed_tariffs] == [
            ("Managed", False),
            ("BYO keys", True),
        ]
        assert malformed_tariffs[0].clients == 5
        assert malformed_tariffs[0].price == D("123")
        assert db.get(TrendWatcherConfig, malformed_id).provider_allowance_usd == D("17")
        assert db.scalar(select(TrendWatcherScenario).where(
            TrendWatcherScenario.service_id == malformed_id,
            TrendWatcherScenario.key == "base",
        )).instagram_accounts == 12

    # Повторный startup ничего больше не меняет.
    init_db(engine, seed=False)
    with Session() as db:
        assert db.get(Service, malformed_id).preset_version == 4
        assert db.get(Service, customized_id).preset_version == 3
