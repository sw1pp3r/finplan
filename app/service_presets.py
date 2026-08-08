"""Versioned service presets and guarded upgrades for legacy placeholders."""
from decimal import Decimal

from .db import (
    Service, ServiceCost, ServiceTariff, ServiceTariffUsage,
    TrendWatcherConfig, TrendWatcherScenario,
)

TRENDWATCHER_PRESET_VERSION = 4
_TRENDWATCHER_V2_NOTE = "Операционная юнит-экономика v2; source-backed допущения редактируются ниже"
_TRENDWATCHER_V3_NOTE = "Финансовая модель v3: workflow LLM, payment fees и growth unit economics"

# cost: (name, amount, currency, kind, unit_label, unit_size)
# tariff: (name, price, currency, clients, is_byo, usage {cost-name: units/клиента/мес})
PRESETS = {
    "trendwatcher": {
        "name": "TrendWatcher",
        "note": "Финансовая модель v4: защищённые роли Managed/BYO",
        "costs": [
            ("Хостинг", Decimal("20"), "USD", "fixed", None, 1),
            ("Поддержка", Decimal("10"), "USD", "per_client", None, 1),
        ],
        "tariffs": [
            ("Managed", Decimal("99"), "USD", 0, False, {}),
            ("BYO keys", Decimal("49"), "USD", 0, True, {}),
        ],
    },
}


TRENDWATCHER_SCENARIOS_V2 = (
    dict(key="low", label="Low", sort_order=0,
         instagram_accounts=10, instagram_refreshes_per_month=8,
         instagram_credits_per_refresh=2, instagram_results_per_refresh=13,
         manual_instagram_full_collections=1, instagram_radar_runs=4,
         instagram_transcripts=20, instagram_published_videos=10,
         tiktok_accounts=10, tiktok_refreshes_per_month=8,
         tiktok_credits_per_refresh=3, manual_tiktok_full_collections=1,
         tiktok_discovery_runs=4, tiktok_transcripts=20, tiktok_published_videos=10,
         youtube_channels=10, youtube_refreshes_per_month=8,
         manual_youtube_full_collections=1, youtube_radar_queries=4,
         youtube_published_videos=10, outcome_checks_per_video=4,
         llm_calls=100, llm_input_tokens_per_call=2000, llm_output_tokens_per_call=500),
    dict(key="base", label="Base", sort_order=1,
         instagram_accounts=30, instagram_refreshes_per_month=30,
         instagram_credits_per_refresh=2, instagram_results_per_refresh=13,
         manual_instagram_full_collections=4, instagram_radar_runs=30,
         instagram_transcripts=100, instagram_published_videos=100,
         tiktok_accounts=30, tiktok_refreshes_per_month=30,
         tiktok_credits_per_refresh=3, manual_tiktok_full_collections=4,
         tiktok_discovery_runs=30, tiktok_transcripts=100, tiktok_published_videos=100,
         youtube_channels=30, youtube_refreshes_per_month=30,
         manual_youtube_full_collections=4, youtube_radar_queries=30,
         youtube_published_videos=100, outcome_checks_per_video=4,
         llm_calls=500, llm_input_tokens_per_call=2000, llm_output_tokens_per_call=500),
    dict(key="stress", label="Stress", sort_order=2,
         instagram_accounts=30, instagram_refreshes_per_month=30,
         instagram_credits_per_refresh=4, instagram_results_per_refresh=31,
         manual_instagram_full_collections=10, instagram_radar_runs=30,
         instagram_transcripts=100, instagram_published_videos=100,
         tiktok_accounts=30, tiktok_refreshes_per_month=30,
         tiktok_credits_per_refresh=3, manual_tiktok_full_collections=10,
         tiktok_discovery_runs=60, tiktok_transcripts=200, tiktok_published_videos=150,
         youtube_channels=30, youtube_refreshes_per_month=30,
         manual_youtube_full_collections=10, youtube_radar_queries=60,
         youtube_published_videos=150, outcome_checks_per_video=4,
         llm_calls=1000, llm_input_tokens_per_call=3000, llm_output_tokens_per_call=800),
)


_V3_LLM_WORKLOAD = {
    # Editable starting workloads. The breakdown follows real code paths and
    # intentionally preserves the v2 aggregate call totals (100/500/1000).
    "low": dict(llm_annotated_videos=80, llm_similarity_videos=80,
                llm_profile_rebuilds=1, llm_idea_candidates=8, llm_manual_calls=0),
    "base": dict(llm_annotated_videos=446, llm_similarity_videos=446,
                 llm_profile_rebuilds=1, llm_idea_candidates=20, llm_manual_calls=0),
    "stress": dict(llm_annotated_videos=891, llm_similarity_videos=891,
                   llm_profile_rebuilds=2, llm_idea_candidates=40, llm_manual_calls=2),
}

TRENDWATCHER_SCENARIOS = tuple(
    {**values, "llm_calls": 0, **_V3_LLM_WORKLOAD[values["key"]]}
    for values in TRENDWATCHER_SCENARIOS_V2
)


def _install_trendwatcher_model(db, service_id: int) -> None:
    db.add(TrendWatcherConfig(service_id=service_id))
    for values in TRENDWATCHER_SCENARIOS:
        db.add(TrendWatcherScenario(service_id=service_id, **values))


def _populate_preset_rows(db, svc: Service, preset_key: str) -> None:
    p = PRESETS[preset_key]
    cost_ids = {}
    for i, (name, amount, cur, kind, unit_label, unit_size) in enumerate(p["costs"]):
        c = ServiceCost(service_id=svc.id, name=name, amount=amount, currency=cur,
                        kind=kind, unit_label=unit_label, unit_size=unit_size, sort_order=i)
        db.add(c)
        db.flush()
        cost_ids[name] = c.id
    for i, (name, price, cur, clients, is_byo, usage) in enumerate(p["tariffs"]):
        t = ServiceTariff(service_id=svc.id, name=name, price=price, currency=cur,
                          clients=clients, is_byo=is_byo, sort_order=i)
        db.add(t)
        db.flush()
        for cost_name, units in usage.items():
            db.add(ServiceTariffUsage(tariff_id=t.id, cost_id=cost_ids[cost_name],
                                      units_per_client_month=units))
    if preset_key == "trendwatcher":
        _install_trendwatcher_model(db, svc.id)


def _matches_legacy_trendwatcher(db, svc: Service) -> bool:
    """Match every old placeholder field; any user edit makes the upgrade a no-op."""
    from sqlalchemy import select

    if (svc.name != "TrendWatcher"
            or svc.note != "юнит-экономика; цифры-плейсхолдеры до product-saas-spec"
            or svc.preset_key is not None or svc.preset_version is not None):
        return False
    costs = db.scalars(select(ServiceCost).where(ServiceCost.service_id == svc.id)
                       .order_by(ServiceCost.sort_order, ServiceCost.id)).all()
    expected_costs = (
        ("Apify (скрейпинг)", Decimal("3.80"), "USD", "per_unit", "роликов", 1000, 0),
        ("LLM-метр", Decimal("1.00"), "USD", "per_unit", "вызовов", 1000, 1),
        ("YouTube-квота (лимит, не деньги)", Decimal("0.01"), "USD", "fixed", None, 1, 2),
        ("Хостинг", Decimal("20"), "USD", "fixed", None, 1, 3),
    )
    actual_costs = tuple(
        (c.name, Decimal(c.amount), c.currency, c.kind, c.unit_label, c.unit_size, c.sort_order)
        for c in costs
    )
    if actual_costs != expected_costs:
        return False

    tariffs = db.scalars(select(ServiceTariff).where(ServiceTariff.service_id == svc.id)
                         .order_by(ServiceTariff.sort_order, ServiceTariff.id)).all()
    expected_tariffs = (
        ("Managed", Decimal("99"), "USD", 0, False, 0,
         {"Apify (скрейпинг)": Decimal("5000"), "LLM-метр": Decimal("2000")}),
        # Legacy v1 bug: zero provider usage was configured, but the BYO flag
        # itself was false. The v2 rows created after this match correct it.
        ("BYO keys", Decimal("49"), "USD", 0, False, 1,
         {"Apify (скрейпинг)": Decimal("0"), "LLM-метр": Decimal("0")}),
    )
    cost_names = {c.id: c.name for c in costs}
    actual_tariffs = []
    for tariff in tariffs:
        usage_rows = db.scalars(select(ServiceTariffUsage).where(
            ServiceTariffUsage.tariff_id == tariff.id)).all()
        usage = {cost_names.get(u.cost_id, ""): Decimal(u.units_per_client_month)
                 for u in usage_rows}
        actual_tariffs.append((tariff.name, Decimal(tariff.price), tariff.currency,
                               tariff.clients, bool(tariff.is_byo), tariff.sort_order, usage))
    return tuple(actual_tariffs) == expected_tariffs


def _matches_v2_trendwatcher(db, svc: Service) -> bool:
    """Guard the v2→current model upgrade; client counts are scenario data, not a fingerprint."""
    from sqlalchemy import select

    if (svc.name != "TrendWatcher" or svc.note != _TRENDWATCHER_V2_NOTE
            or svc.preset_key != "trendwatcher" or svc.preset_version != 2):
        return False
    costs = db.scalars(select(ServiceCost).where(ServiceCost.service_id == svc.id)
                       .order_by(ServiceCost.sort_order, ServiceCost.id)).all()
    if tuple((c.name, Decimal(c.amount), c.currency, c.kind, c.unit_label,
              c.unit_size, c.sort_order) for c in costs) != (
        ("Хостинг", Decimal("20"), "USD", "fixed", None, 1, 0),
        ("Поддержка", Decimal("10"), "USD", "per_client", None, 1, 1),
    ):
        return False
    tariffs = db.scalars(select(ServiceTariff).where(ServiceTariff.service_id == svc.id)
                         .order_by(ServiceTariff.sort_order, ServiceTariff.id)).all()
    # Intentionally ignore clients: changing scenario size must not block a safe
    # upgrade. Accept the one known malformed v2 state where the old editor
    # changed Managed to BYO while switching the unit-economics view; every
    # other price/BYO/name/manual usage edit still blocks the migration.
    tariff_fingerprint = tuple(
        (t.name, Decimal(t.price), t.currency, bool(t.is_byo), t.sort_order)
        for t in tariffs
    )
    expected_tariffs = (
        ("Managed", Decimal("99"), "USD", False, 0),
        ("BYO keys", Decimal("49"), "USD", True, 1),
    )
    known_malformed_byo_tariffs = (
        ("Managed", Decimal("99"), "USD", True, 0),
        ("BYO keys", Decimal("49"), "USD", True, 1),
    )
    if tariff_fingerprint not in (expected_tariffs, known_malformed_byo_tariffs):
        return False
    tariff_ids = [t.id for t in tariffs]
    if tariff_ids and db.scalars(select(ServiceTariffUsage).where(
            ServiceTariffUsage.tariff_id.in_(tariff_ids))).first() is not None:
        return False
    config = db.get(TrendWatcherConfig, svc.id)
    if config is None:
        return False
    expected_config = {
        "active_scenario": "base", "instagram_source": "scrapecreators",
        "provider_allowance_usd": Decimal("10"),
        "scrapecreators_price_per_1000": Decimal("1.88"),
        "scrapecreators_pack_price_usd": Decimal("47"),
        "scrapecreators_pack_credits": 25_000,
        "scrapecreators_credit_balance": 0,
        "apify_instagram_price_per_1000": Decimal("2.60"),
        "apify_actor_start_usd": Decimal("0.001"),
        "llm_provider": "openrouter/google-gemini-2.5-flash",
        "llm_input_usd_per_million": Decimal("0.30"),
        "llm_output_usd_per_million": Decimal("2.50"),
        "youtube_daily_general_units": 10_000,
        "youtube_daily_search_calls": 100,
        "llm_retry_overhead_pct": Decimal("0"), "llm_platform_fee_pct": Decimal("0"),
        "payment_fee_pct": Decimal("0"), "payment_fee_fixed_usd": Decimal("0"),
        "monthly_churn_pct": Decimal("0"), "cac_per_client_usd": Decimal("0"),
    }
    if any(getattr(config, field) != value for field, value in expected_config.items()):
        return False
    scenarios = db.scalars(select(TrendWatcherScenario).where(
        TrendWatcherScenario.service_id == svc.id
    ).order_by(TrendWatcherScenario.sort_order, TrendWatcherScenario.id)).all()
    if len(scenarios) != len(TRENDWATCHER_SCENARIOS_V2):
        return False
    for row, expected in zip(scenarios, TRENDWATCHER_SCENARIOS_V2):
        if any(getattr(row, field) != value for field, value in expected.items()):
            return False
        if any(getattr(row, field) != 0 for field in _V3_LLM_WORKLOAD[row.key]):
            return False
    return True


def upgrade_legacy_trendwatcher_presets(db) -> int:
    """Replace exact v1 placeholders in place; customized and unrelated rows are untouched."""
    from sqlalchemy import select

    upgraded = 0
    candidates = db.scalars(select(Service).where(Service.name == "TrendWatcher")).all()
    for svc in candidates:
        if not _matches_legacy_trendwatcher(db, svc):
            continue
        tariffs = db.scalars(select(ServiceTariff).where(
            ServiceTariff.service_id == svc.id)).all()
        tariff_ids = [t.id for t in tariffs]
        if tariff_ids:
            for usage in db.scalars(select(ServiceTariffUsage).where(
                    ServiceTariffUsage.tariff_id.in_(tariff_ids))).all():
                db.delete(usage)
            # No ORM relationships connect these legacy rows, so SQLAlchemy
            # cannot infer child-before-parent ordering. Flush explicitly for
            # Postgres (and SQLite with foreign_keys=ON).
            db.flush()
        for tariff in tariffs:
            db.delete(tariff)
        db.flush()
        for cost in db.scalars(select(ServiceCost).where(
                ServiceCost.service_id == svc.id)).all():
            db.delete(cost)
        db.flush()
        svc.note = PRESETS["trendwatcher"]["note"]
        svc.preset_key = "trendwatcher"
        svc.preset_version = TRENDWATCHER_PRESET_VERSION
        _populate_preset_rows(db, svc, "trendwatcher")
        upgraded += 1
    # v2 rows already have correct provider economics. Upgrade only the new LLM
    # workload assumptions after a full fingerprint match; preserve client counts.
    for svc in db.scalars(select(Service).where(
            Service.name == "TrendWatcher", Service.preset_version == 2)).all():
        if not _matches_v2_trendwatcher(db, svc):
            continue
        rows = db.scalars(select(TrendWatcherScenario).where(
            TrendWatcherScenario.service_id == svc.id
        )).all()
        by_key = {row.key: row for row in rows}
        tariffs = db.scalars(select(ServiceTariff).where(
            ServiceTariff.service_id == svc.id
        )).all()
        for tariff in tariffs:
            if tariff.name == "Managed" and tariff.sort_order == 0:
                tariff.is_byo = False
        for values in TRENDWATCHER_SCENARIOS:
            row = by_key[values["key"]]
            row.llm_calls = 0
            for field, value in _V3_LLM_WORKLOAD[row.key].items():
                setattr(row, field, value)
        svc.note = PRESETS["trendwatcher"]["note"]
        svc.preset_version = TRENDWATCHER_PRESET_VERSION
        upgraded += 1
    # v3 could already contain the one known editor corruption: both canonical
    # tariffs marked BYO. Repair only the exact Managed/BYO role pair and keep
    # all prices, clients, config and scenario edits untouched.
    for svc in db.scalars(select(Service).where(
            Service.preset_key == "trendwatcher", Service.preset_version == 3)).all():
        tariffs = db.scalars(select(ServiceTariff).where(
            ServiceTariff.service_id == svc.id
        ).order_by(ServiceTariff.sort_order, ServiceTariff.id)).all()
        if tuple((row.name, row.sort_order) for row in tariffs) != (
            ("Managed", 0),
            ("BYO keys", 1),
        ):
            continue
        roles = tuple(bool(row.is_byo) for row in tariffs)
        if roles not in ((False, True), (True, True)):
            continue
        tariffs[0].is_byo = False
        if svc.note == _TRENDWATCHER_V3_NOTE:
            svc.note = PRESETS["trendwatcher"]["note"]
        svc.preset_version = TRENDWATCHER_PRESET_VERSION
        upgraded += 1
    return upgraded


def apply_preset(db, preset_key: str) -> Service:
    p = PRESETS[preset_key]
    svc = Service(name=p["name"], note=p["note"], preset_key=preset_key,
                  preset_version=(TRENDWATCHER_PRESET_VERSION
                                  if preset_key == "trendwatcher" else 1))
    db.add(svc)
    db.flush()
    _populate_preset_rows(db, svc, preset_key)
    return svc
