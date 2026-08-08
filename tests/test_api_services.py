"""API «Сервисов»: CRUD, summary, валидация. Схема — как у course-тестов."""
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.main import create_app


@pytest.fixture()
def client():
    app = create_app(database_url="sqlite://", seed=False, fx_autofetch=False)
    with TestClient(app) as c:
        yield c


def test_service_tables_exist(client):
    from app.db import Service, ServiceCost, ServiceTariff, ServiceTariffUsage  # noqa: F401
    session = client.app.state.SessionLocal()
    engine = session.get_bind()
    tables = set(inspect(engine).get_table_names())
    assert {
        "services", "service_costs", "service_tariffs", "service_tariff_usage",
        "trendwatcher_config", "trendwatcher_scenarios",
    } <= tables


def test_existing_sqlite_services_table_gets_version_columns():
    from sqlalchemy import inspect, text
    from app.db import init_db, make_engine

    engine = make_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(80) NOT NULL, "
            "note VARCHAR(300))"
        ))

    init_db(engine, seed=False)
    columns = {c["name"] for c in inspect(engine).get_columns("services")}
    assert {"preset_key", "preset_version"} <= columns


def test_existing_sqlite_trendwatcher_config_gets_pack_columns():
    from sqlalchemy import inspect, text
    from app.db import init_db, make_engine

    engine = make_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE trendwatcher_config (service_id INTEGER PRIMARY KEY, "
            "active_scenario VARCHAR(12) DEFAULT 'base' NOT NULL)"
        ))

    init_db(engine, seed=False)
    columns = {c["name"] for c in inspect(engine).get_columns("trendwatcher_config")}
    assert {
        "scrapecreators_pack_price_usd",
        "scrapecreators_pack_credits",
        "scrapecreators_credit_balance",
        "llm_retry_overhead_pct",
        "llm_platform_fee_pct",
        "payment_fee_pct",
        "payment_fee_fixed_usd",
        "monthly_churn_pct",
        "cac_per_client_usd",
    } <= columns


def test_existing_sqlite_trendwatcher_scenario_gets_workflow_columns():
    from sqlalchemy import inspect, text
    from app.db import init_db, make_engine

    engine = make_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE trendwatcher_scenarios (id INTEGER PRIMARY KEY, "
            "service_id INTEGER NOT NULL, key VARCHAR(12) NOT NULL)"
        ))

    init_db(engine, seed=False)
    columns = {c["name"] for c in inspect(engine).get_columns("trendwatcher_scenarios")}
    assert {
        "llm_annotated_videos", "llm_similarity_videos", "llm_profile_rebuilds",
        "llm_idea_candidates", "llm_manual_calls",
    } <= columns


def test_services_crud_and_summary(client):
    client.post("/api/rates", json={"currency": "USD", "rate_to_base": 1})
    r = client.post("/api/services", json={"name": "TrendWatcher", "preset": "trendwatcher"})
    assert r.status_code == 201
    sid = r.json()["id"]

    assert any(s["id"] == sid for s in client.get("/api/services").json())

    summary = client.get(f"/api/services/{sid}/summary").json()
    assert summary["service"]["preset_key"] == "trendwatcher"
    assert summary["trendwatcher"]["config"]["provider_allowance_usd"] == 10
    assert {s["key"] for s in summary["trendwatcher"]["scenarios"]} == {
        "low", "base", "stress",
    }
    assert summary["trendwatcher"]["active"]["key"] == "base"
    sources = summary["trendwatcher"]["pricing_sources"]
    assert sources["scrapecreators"] == {
        "status": "verified",
        "label": "Freelance $1.88 / 1,000 credits",
        "url": "https://scrapecreators.com/#pricing",
        "checked_on": "2026-07-23",
    }
    assert sources["apify"]["status"] == "assumption"
    assert sources["llm"]["checked_on"] == "2026-07-23"

    # Тариф: четыре Managed-клиента получают provider COGS активного base-сценария.
    managed = next(t for t in summary["tariffs"] if t["name"] == "Managed")
    r = client.patch(f"/api/services/{sid}/tariffs/{managed['id']}",
                     json={"clients": 4})
    assert r.status_code == 200
    summary = client.get(f"/api/services/{sid}/summary").json()
    assert summary["clients_total"] == 4
    assert summary["mrr"] == pytest.approx(396.0)
    assert summary["provider_monthly"] == pytest.approx(57.45296)
    assert summary["cogs_monthly"] == pytest.approx(117.45296)

    # своя статья + свой тариф
    r = client.post(f"/api/services/{sid}/costs",
                    json={"name": "S3", "amount": 5, "currency": "USD", "kind": "fixed"})
    assert r.status_code == 201
    r = client.post(f"/api/services/{sid}/tariffs",
                    json={"name": "Enterprise", "price": 500, "currency": "USD", "clients": 1})
    assert r.status_code == 201

    # DELETE сервиса каскадно чистит строки
    assert client.delete(f"/api/services/{sid}").status_code == 200
    assert client.get(f"/api/services/{sid}/summary").status_code == 404


def _trendwatcher_summary_with_clients(client, managed_clients=0, byo_clients=0):
    client.post("/api/rates", json={"currency": "USD", "rate_to_base": 1})
    sid = client.post("/api/services", json={
        "name": "TrendWatcher", "preset": "trendwatcher",
    }).json()["id"]
    summary = client.get(f"/api/services/{sid}/summary").json()
    managed = next(t for t in summary["tariffs"] if not t["is_byo"])
    byo = next(t for t in summary["tariffs"] if t["is_byo"])
    client.patch(f"/api/services/{sid}/tariffs/{managed['id']}",
                 json={"clients": managed_clients})
    client.patch(f"/api/services/{sid}/tariffs/{byo['id']}",
                 json={"clients": byo_clients})
    return client.get(f"/api/services/{sid}/summary").json()


def test_trendwatcher_summary_exposes_portfolio_unit_and_capacity_breakdown(client):
    summary = _trendwatcher_summary_with_clients(client, managed_clients=10)
    base = summary["trendwatcher"]["active"]
    econ = base["economics"]

    assert econ["revenue_monthly_base"] == pytest.approx(990)
    assert econ["provider_data_monthly_base"] == pytest.approx(134.3824)
    assert econ["provider_llm_monthly_base"] == pytest.approx(9.25)
    assert econ["generic_variable_monthly_base"] == pytest.approx(100)
    assert econ["fixed_monthly_base"] == pytest.approx(20)
    assert econ["contribution_monthly_base"] == pytest.approx(746.3676)
    assert econ["net_monthly"] == pytest.approx(726.3676)

    managed = next(row for row in econ["by_tariff"] if row["name"] == "Managed")
    assert managed["clients"] == 10
    assert managed["price_base"] == pytest.approx(99)
    assert managed["provider_data_per_client_base"] == pytest.approx(13.43824)
    assert managed["provider_llm_per_client_base"] == pytest.approx(0.925)
    assert managed["generic_variable_per_client_base"] == pytest.approx(10)
    assert managed["fixed_allocation_per_client_base"] == pytest.approx(2)
    assert managed["unit_profit_per_client_base"] == pytest.approx(72.63676)

    capacity = base["capacity"]
    assert capacity["monthly_demand_credits"] == 71_480
    assert capacity["packs_to_buy"] == 3
    assert capacity["next_topup_cash_usd"] == pytest.approx(141)
    assert capacity["ending_balance_credits"] == 3_520


def test_trendwatcher_mixed_managed_byo_separates_provider_from_support(client):
    summary = _trendwatcher_summary_with_clients(
        client, managed_clients=2, byo_clients=3,
    )
    active = summary["trendwatcher"]["active"]
    econ = active["economics"]

    assert summary["clients_total"] == 5
    assert econ["provider_data_monthly_base"] == pytest.approx(26.87648)
    assert econ["provider_llm_monthly_base"] == pytest.approx(1.85)
    assert econ["generic_variable_monthly_base"] == pytest.approx(50)
    assert active["capacity"]["monthly_demand_credits"] == 14_296

    byo = next(row for row in econ["by_tariff"] if row["is_byo"])
    assert byo["provider_data_per_client_base"] == 0
    assert byo["provider_llm_per_client_base"] == 0
    assert byo["generic_variable_per_client_base"] == pytest.approx(10)


def test_trendwatcher_portfolio_switch_moves_all_clients_atomically(client):
    client.post("/api/rates", json={"currency": "USD", "rate_to_base": 1})
    summary = _trendwatcher_summary_with_clients(
        client, managed_clients=5, byo_clients=1,
    )
    sid = summary["service"]["id"]
    byo = next(row for row in summary["tariffs"] if row["is_byo"])

    response = client.patch(f"/api/services/{sid}/trendwatcher/portfolio", json={
        "tariff_id": byo["id"],
        "clients": 6,
    })

    assert response.status_code == 200
    switched = client.get(f"/api/services/{sid}/summary").json()
    assert switched["clients_total"] == 6
    assert [(row["name"], row["clients"]) for row in switched["tariffs"]] == [
        ("Managed", 0),
        ("BYO keys", 6),
    ]
    active = switched["trendwatcher"]["active"]["economics"]
    assert active["provider_monthly_base"] == 0
    assert active["generic_variable_monthly_base"] == pytest.approx(60)
    assert active["fixed_monthly_base"] == pytest.approx(20)


def test_trendwatcher_portfolio_rejects_tariff_from_another_service(client):
    first = _trendwatcher_summary_with_clients(client, managed_clients=2)
    second = _trendwatcher_summary_with_clients(client, managed_clients=1)
    foreign_tariff = second["tariffs"][0]

    response = client.patch(
        f"/api/services/{first['service']['id']}/trendwatcher/portfolio",
        json={"tariff_id": foreign_tariff["id"], "clients": 2},
    )

    assert response.status_code == 404


def test_trendwatcher_canonical_tariff_roles_cannot_be_inverted(client):
    summary = _trendwatcher_summary_with_clients(client, managed_clients=5)
    sid = summary["service"]["id"]
    managed = next(row for row in summary["tariffs"] if row["name"] == "Managed")
    byo = next(row for row in summary["tariffs"] if row["name"] == "BYO keys")

    assert client.patch(
        f"/api/services/{sid}/tariffs/{managed['id']}",
        json={"is_byo": True},
    ).status_code == 422
    assert client.patch(
        f"/api/services/{sid}/tariffs/{byo['id']}",
        json={"is_byo": False},
    ).status_code == 422

    roles = {
        row["name"]: row["is_byo"]
        for row in client.get(f"/api/services/{sid}/summary").json()["tariffs"]
    }
    assert roles == {"Managed": False, "BYO keys": True}


def test_trendwatcher_config_and_scenario_patch(client):
    client.post("/api/rates", json={"currency": "USD", "rate_to_base": 1})
    sid = client.post("/api/services", json={
        "name": "TrendWatcher", "preset": "trendwatcher",
    }).json()["id"]

    r = client.patch(f"/api/services/{sid}/trendwatcher/config", json={
        "instagram_source": "apify",
        "provider_allowance_usd": 12,
        "apify_instagram_price_per_1000": 2.30,
        "llm_provider": "custom-model",
        "llm_input_usd_per_million": 0.4,
        "llm_output_usd_per_million": 3.0,
    })
    assert r.status_code == 200
    r = client.patch(f"/api/services/{sid}/trendwatcher/scenarios/base", json={
        "instagram_accounts": 30,
        "instagram_refreshes_per_month": 30,
        "instagram_results_per_refresh": 13,
        "instagram_radar_runs": 30,
    })
    assert r.status_code == 200

    summary = client.get(f"/api/services/{sid}/summary").json()
    tw = summary["trendwatcher"]
    assert tw["config"]["instagram_source"] == "apify"
    assert tw["config"]["provider_allowance_usd"] == 12
    base = next(s for s in tw["scenarios"] if s["key"] == "base")
    assert base["usage"]["apify"]["results"] > 0
    assert base["usage"]["instagram"]["unsupported_radar_runs"] == 30
    assert base["usage"]["youtube"]["cost_usd"] is None

    assert client.patch(f"/api/services/{sid}/trendwatcher/config", json={
        "instagram_source": "unknown",
    }).status_code == 422
    assert client.patch(f"/api/services/{sid}/trendwatcher/scenarios/base", json={
        "instagram_accounts": -1,
    }).status_code == 422


def test_trendwatcher_draft_preview_is_ephemeral_and_apply_is_atomic(client):
    client.post("/api/rates", json={"currency": "USD", "rate_to_base": 1})
    summary = _trendwatcher_summary_with_clients(client, managed_clients=3)
    sid = summary["service"]["id"]
    saved_base = next(
        scenario for scenario in summary["trendwatcher"]["scenarios"]
        if scenario["key"] == "base"
    )
    saved_allowance = summary["trendwatcher"]["config"]["provider_allowance_usd"]

    draft = {
        "scenario_key": "base",
        "config": {
            "provider_allowance_usd": 12,
            "llm_retry_overhead_pct": 7.5,
        },
        "drivers": {
            "instagram_accounts": 31,
            "instagram_refreshes_per_month": 30,
        },
    }
    preview_response = client.post(
        f"/api/services/{sid}/trendwatcher/draft/preview",
        json=draft,
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert preview["trendwatcher"]["config"]["provider_allowance_usd"] == 12
    assert preview["trendwatcher"]["active"]["drivers"]["instagram_accounts"] == 31
    assert preview["trendwatcher"]["active"]["usage"]["instagram"]["credits"] > (
        saved_base["usage"]["instagram"]["credits"]
    )

    unchanged = client.get(f"/api/services/{sid}/summary").json()
    assert unchanged["trendwatcher"]["config"]["provider_allowance_usd"] == saved_allowance
    assert unchanged["trendwatcher"]["active"]["drivers"]["instagram_accounts"] == (
        saved_base["drivers"]["instagram_accounts"]
    )

    applied_response = client.patch(
        f"/api/services/{sid}/trendwatcher/draft",
        json=draft,
    )
    assert applied_response.status_code == 200
    applied = applied_response.json()
    assert applied["trendwatcher"]["config"]["provider_allowance_usd"] == 12
    assert applied["trendwatcher"]["config"]["llm_retry_overhead_pct"] == 7.5
    assert applied["trendwatcher"]["active"]["drivers"]["instagram_accounts"] == 31

    persisted = client.get(f"/api/services/{sid}/summary").json()
    assert persisted["trendwatcher"]["config"]["provider_allowance_usd"] == 12
    assert persisted["trendwatcher"]["active"]["drivers"]["instagram_accounts"] == 31


def test_trendwatcher_invalid_draft_does_not_partially_apply_config(client):
    summary = _trendwatcher_summary_with_clients(client, managed_clients=1)
    sid = summary["service"]["id"]
    allowance = summary["trendwatcher"]["config"]["provider_allowance_usd"]

    response = client.patch(
        f"/api/services/{sid}/trendwatcher/draft",
        json={
            "scenario_key": "base",
            "config": {"provider_allowance_usd": 99},
            "drivers": {"outcome_checks_per_video": 5},
        },
    )

    assert response.status_code == 422
    persisted = client.get(f"/api/services/{sid}/summary").json()
    assert persisted["trendwatcher"]["config"]["provider_allowance_usd"] == allowance


def test_trendwatcher_workflow_llm_and_commercial_unit_metrics(client):
    client.post("/api/rates", json={"currency": "USD", "rate_to_base": 1})
    summary = _trendwatcher_summary_with_clients(client, managed_clients=2)
    sid = summary["service"]["id"]

    config_response = client.patch(f"/api/services/{sid}/trendwatcher/config", json={
        "llm_retry_overhead_pct": 10,
        "llm_platform_fee_pct": 5.5,
        "payment_fee_pct": 3,
        "payment_fee_fixed_usd": 0.30,
        "monthly_churn_pct": 5,
        "cac_per_client_usd": 100,
    })
    assert config_response.status_code == 200
    scenario_response = client.patch(
        f"/api/services/{sid}/trendwatcher/scenarios/base",
        json={
            "llm_calls": 0,
            "llm_annotated_videos": 100,
            "llm_similarity_videos": 81,
            "llm_profile_rebuilds": 1,
            "llm_idea_candidates": 5,
            "llm_manual_calls": 2,
            "llm_input_tokens_per_call": 2000,
            "llm_output_tokens_per_call": 500,
        },
    )
    assert scenario_response.status_code == 200

    active = client.get(f"/api/services/{sid}/summary").json()["trendwatcher"]["active"]
    llm = active["usage"]["llm"]
    assert llm["base_calls"] == 117
    assert llm["billed_calls"] == 129
    assert llm["breakdown"] == {
        "annotations": 100,
        "similarity_batches": 3,
        "profile": 2,
        "ideas": 10,
        "manual": 2,
    }
    assert llm["inference_cost_usd"] == pytest.approx(0.23865)
    assert llm["platform_fee_usd"] == pytest.approx(0.01312575)
    assert llm["cost_usd"] == pytest.approx(0.25177575)

    economics = active["economics"]
    unit = next(row for row in economics["by_tariff"] if not row["is_byo"])
    assert unit["payment_fee_per_client_base"] == pytest.approx(3.27)
    assert economics["payment_fees_monthly_base"] == pytest.approx(6.54)
    assert economics["gross_margin_pct"] == pytest.approx(
        economics["contribution_monthly_base"] / economics["revenue_monthly_base"]
    )
    assert unit["cac_payback_months"] == pytest.approx(
        100 / unit["contribution_per_client_base"]
    )
    assert unit["ltv_contribution_base"] == pytest.approx(
        unit["contribution_per_client_base"] / 0.05
    )
    assert unit["ltv_cac_ratio"] == pytest.approx(
        unit["ltv_contribution_base"] / 100
    )

    assert client.patch(f"/api/services/{sid}/trendwatcher/config", json={
        "payment_fee_pct": 101,
    }).status_code == 422


def test_trendwatcher_pack_config_patch_and_validation(client):
    client.post("/api/rates", json={"currency": "USD", "rate_to_base": 1})
    sid = client.post("/api/services", json={
        "name": "TrendWatcher", "preset": "trendwatcher",
    }).json()["id"]

    ok = client.patch(f"/api/services/{sid}/trendwatcher/config", json={
        "scrapecreators_pack_price_usd": 497,
        "scrapecreators_pack_credits": 500_000,
        "scrapecreators_credit_balance": 12_345,
        "scrapecreators_price_per_1000": 0.994,
    })
    assert ok.status_code == 200
    config = client.get(f"/api/services/{sid}/summary").json()["trendwatcher"]["config"]
    assert config["scrapecreators_pack_price_usd"] == 497
    assert config["scrapecreators_pack_credits"] == 500_000
    assert config["scrapecreators_credit_balance"] == 12_345
    assert client.patch(f"/api/services/{sid}/trendwatcher/config", json={
        "scrapecreators_pack_credits": 0,
    }).status_code == 422
    assert client.patch(f"/api/services/{sid}/trendwatcher/config", json={
        "scrapecreators_credit_balance": -1,
    }).status_code == 422


def test_services_validation(client):
    assert client.post("/api/services", json={"name": "x" * 81}).status_code == 422
    r = client.post("/api/services", json={"name": "S"})
    sid = r.json()["id"]
    bad = client.post(f"/api/services/{sid}/costs",
                      json={"name": "n", "amount": -1, "currency": "USD", "kind": "fixed"})
    assert bad.status_code == 422
    bad = client.post(f"/api/services/{sid}/costs",
                      json={"name": "n", "amount": 1, "currency": "USD", "kind": "weird"})
    assert bad.status_code == 422
    assert client.post("/api/services", json={"name": "S", "preset": "nope"}).status_code == 404


def test_services_demo_isolated(client):
    client.post("/api/services", json={"name": "Real"})
    demo = client.get("/api/services", headers={"X-Demo": "1"}).json()
    assert all(s["name"] != "Real" for s in demo)


def test_service_preset_with_note(client):
    """POST /services with preset and note: note should be applied."""
    r = client.post("/api/services", json={"name": "TW", "preset": "trendwatcher", "note": "n1"})
    assert r.status_code == 201
    sid = r.json()["id"]
    summary = client.get(f"/api/services/{sid}/summary").json()
    assert summary["service"]["name"] == "TW"
    assert summary["service"]["note"] == "n1"


def test_service_usage_validation_before_delete(client):
    """PATCH tariff with negative usage: should reject before deleting existing usage."""
    # Create service with USD rate
    client.post("/api/rates", json={"currency": "USD", "rate_to_base": 1})
    r = client.post("/api/services", json={"name": "S"})
    sid = r.json()["id"]

    # Create a cost
    r = client.post(f"/api/services/{sid}/costs",
                   json={"name": "Cost1", "amount": 10, "currency": "USD", "kind": "fixed"})
    assert r.status_code == 201
    cost_id = r.json()["id"]

    # Create a tariff with initial usage
    r = client.post(f"/api/services/{sid}/tariffs",
                   json={"name": "T1", "price": 100, "currency": "USD", "clients": 1,
                         "usage": {str(cost_id): 5}})
    assert r.status_code == 201
    tariff_id = r.json()["id"]

    # Verify initial usage is set
    summary = client.get(f"/api/services/{sid}/summary").json()
    tariff = next(t for t in summary["tariffs"] if t["id"] == tariff_id)
    assert tariff["usage"].get(str(cost_id)) == 5

    # Try to PATCH with negative usage: should fail with 422
    r = client.patch(f"/api/services/{sid}/tariffs/{tariff_id}",
                    json={"usage": {str(cost_id): -5}})
    assert r.status_code == 422

    # Verify usage is still intact after failed PATCH
    summary = client.get(f"/api/services/{sid}/summary").json()
    tariff = next(t for t in summary["tariffs"] if t["id"] == tariff_id)
    assert tariff["usage"].get(str(cost_id)) == 5
