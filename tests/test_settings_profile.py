"""Профиль пользователя: имя хранится в настройках (settings.display_name)."""
import os

from fastapi.testclient import TestClient

from app.main import create_app


def make_client(seed=False):
    app = create_app(
        database_url=os.environ.get("TEST_DATABASE_URL", "sqlite://"),
        api_token=None, seed=seed,
    )
    return TestClient(app)


def test_settings_exposes_display_name_default_empty():
    with make_client() as c:
        s = c.get("/api/settings").json()
        assert "display_name" in s
        assert (s["display_name"] or "") == ""


def test_settings_display_name_patch_persists():
    with make_client() as c:
        assert c.patch("/api/settings", json={"display_name": "Иван Петров"}).status_code == 200
        assert c.get("/api/settings").json()["display_name"] == "Иван Петров"


def test_settings_display_name_keeps_base_currency():
    # имя не ломает существующее поведение базовой валюты
    with make_client() as c:
        c.patch("/api/settings", json={"display_name": "Анна"})
        s = c.get("/api/settings").json()
        assert s["display_name"] == "Анна"
        assert s["base_currency"] == "USD"


def test_demo_persona_display_name_is_artem():
    # демо-персона — «Артём»; реальная (пустая) БД остаётся без имени
    with make_client() as c:
        assert c.get("/api/settings", headers={"X-Demo": "1"}).json()["display_name"] == "Артём"
        assert (c.get("/api/settings").json().get("display_name") or "") == ""
