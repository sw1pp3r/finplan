import os
"""Демо-режим: заголовок X-Demo роутит запросы на отдельную засеянную in-memory БД."""
from fastapi.testclient import TestClient

from app.main import create_app


def make_client():
    # реальная (тестовая) БД пустая: seed=False, без демо-данных
    app = create_app(database_url=os.environ.get("TEST_DATABASE_URL", "sqlite://"), api_token=None, seed=False)
    return TestClient(app)


def test_demo_header_serves_seeded_demo_data():
    with make_client() as c:
        # без заголовка — пустая реальная БД
        assert c.get("/api/accounts").json() == []
        assert c.get("/api/summary").json()["t0"] == 0

        # с X-Demo: 1 — отдаётся засеянный демо-набор
        assert c.get("/api/summary", headers={"X-Demo": "1"}).json()["t0"] > 0
        demo_accounts = c.get("/api/accounts", headers={"X-Demo": "1"}).json()
        assert len(demo_accounts) > 0


def test_demo_data_populates_all_tabs():
    # демо-набор должен оживить каждую вкладку, а не только дашборд
    with make_client() as c:
        h = {"X-Demo": "1"}
        wishes = c.get("/api/wishes", headers=h).json()
        assert len(wishes["items"]) >= 2  # Покупки

        income = c.get("/api/income", headers=h).json()
        assert len(income["items"]) >= 2          # Доходы → лента «Получено»
        assert len(income["by_direction"]) >= 2   # сводка по направлениям

        expenses = c.get("/api/expenses", headers=h).json()
        assert len(expenses["by_category"]) >= 3   # Расходы → несколько категорий


def test_demo_received_income_does_not_distort_burn():
    # полученные факты датированы вне окна снимков → расчётный burn не раздут
    with make_client() as c:
        s = c.get("/api/summary", headers={"X-Demo": "1"}).json()
        assert s["burn_source"] == "derived"
        assert 0 < s["burn_weekly"] < 2000  # ≈ $700/нед, не подскочил из-за доходов


def test_demo_persona_artem_balance_in_range():
    # персона Артёма (AI Builder): баланс ≈ $18 400 в базовой валюте USD
    with make_client() as c:
        s = c.get("/api/summary", headers={"X-Demo": "1"}).json()
        assert s["base_currency"] == "USD"
        assert 15000 < s["t0"] < 22000


def test_demo_forecast_saws_and_cautious_goes_negative():
    # прогноз должен «пилить», а осторожный сценарий — нырять в минус
    with make_client() as c:
        h = {"X-Demo": "1"}
        s = c.get("/api/summary", headers=h).json()
        pess = s["scenarios"]["pessimistic"]["min_total"]
        base = s["scenarios"]["base"]["min_total"]
        opt = s["scenarios"]["optimistic"]["min_total"]
        assert pess < 0, "осторожный сценарий должен уходить в минус"
        assert base > pess, "базовый здоровее осторожного"
        assert opt >= base, "оптимистичный — не хуже базового"

        # «пилит»: в базовой кривой есть подъёмы (поступления) между спадами (burn)
        fc = c.get("/api/forecast", headers=h).json()
        pts = [p[1] for p in fc["scenarios"]["base"]]
        rises = sum(1 for a, b in zip(pts, pts[1:]) if b > a)
        assert rises > 0, "базовая кривая должна расти на днях поступлений"


def test_demo_writes_do_not_touch_real_db():
    with make_client() as c:
        r = c.post("/api/accounts", json={"name": "ДемоСчёт", "currency": "USD"},
                   headers={"X-Demo": "1"})
        assert r.status_code == 201
        # в реальной БД счёта нет — движки изолированы
        assert c.get("/api/accounts").json() == []
