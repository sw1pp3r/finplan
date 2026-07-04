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
    assert {"services", "service_costs", "service_tariffs", "service_tariff_usage"} <= tables


def test_services_crud_and_summary(client):
    client.post("/api/rates", json={"currency": "USD", "rate_to_base": 1})
    r = client.post("/api/services", json={"name": "TrendWatcher", "preset": "trendwatcher"})
    assert r.status_code == 201
    sid = r.json()["id"]

    assert any(s["id"] == sid for s in client.get("/api/services").json())

    summary = client.get(f"/api/services/{sid}/summary").json()
    costs = summary["costs"]
    apify = next(c for c in costs if "Apify" in c["name"])
    assert apify["unit_size"] == 1000

    # тариф: 4 клиента Managed, потребление Apify 5000 → per_unit 76
    managed = next(t for t in summary["tariffs"] if t["name"] == "Managed")
    r = client.patch(f"/api/services/{sid}/tariffs/{managed['id']}",
                     json={"clients": 4, "usage": {str(apify["id"]): 5000, }})
    assert r.status_code == 200
    summary = client.get(f"/api/services/{sid}/summary").json()
    assert summary["clients_total"] == 4
    assert summary["mrr"] == pytest.approx(396.0)
    assert summary["per_unit_monthly"] == pytest.approx(76.0)

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
