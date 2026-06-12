import os
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

TODAY = date.today()


@pytest.fixture()
def client():
    app = create_app(database_url=os.environ.get("TEST_DATABASE_URL", "sqlite://"), api_token=None, seed=False)  # in-memory, чистый справочник
    with TestClient(app) as c:
        yield c


def seed_fx(client, currency, rate):
    r = client.post("/api/fx", json={"currency": currency, "rate_to_base": rate})
    assert r.status_code == 201, r.text


def make_account(client, name, currency, type_="bank"):
    r = client.post("/api/accounts", json={"name": name, "currency": currency, "type": type_})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def post_snapshot(client, items, taken_at=None):
    body = {"items": items}
    if taken_at:
        body["taken_at"] = taken_at.isoformat()
    r = client.post("/api/snapshots", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ---------- accounts ----------

def test_accounts_crud(client):
    acc_id = make_account(client, "HSBC", "HKD")
    accounts = client.get("/api/accounts").json()
    assert [a["name"] for a in accounts] == ["HSBC"]

    r = client.patch(f"/api/accounts/{acc_id}", json={"name": "HSBC HK"})
    assert r.status_code == 200
    assert client.get("/api/accounts").json()[0]["name"] == "HSBC HK"

    # delete = soft: счёт уходит из активных
    r = client.delete(f"/api/accounts/{acc_id}")
    assert r.status_code == 200
    assert client.get("/api/accounts").json() == []


# ---------- snapshots + summary ----------

def test_snapshot_and_summary_t0(client):
    seed_fx(client, "HKD", 0.128)
    hsbc = make_account(client, "HSBC", "HKD")
    ibkr = make_account(client, "IBKR", "USD")
    post_snapshot(client, [
        {"account_id": hsbc, "amount": 100000},
        {"account_id": ibkr, "amount": 5000},
    ])
    s = client.get("/api/summary").json()
    assert s["t0"] == pytest.approx(17800.0)
    assert s["t0_by_currency"] == {"HKD": 100000.0, "USD": 5000.0}
    assert s["last_snapshot_date"] == TODAY.isoformat()
    assert s["snapshot_stale"] is False


def test_summary_marks_stale_snapshot(client):
    acc = make_account(client, "Bank", "USD")
    post_snapshot(client, [{"account_id": acc, "amount": 1000}], taken_at=TODAY - timedelta(days=15))
    s = client.get("/api/summary").json()
    assert s["snapshot_stale"] is True


def test_snapshots_last_for_prefill(client):
    acc = make_account(client, "Bank", "USD")
    post_snapshot(client, [{"account_id": acc, "amount": 1000}], taken_at=TODAY - timedelta(days=7))
    post_snapshot(client, [{"account_id": acc, "amount": 900}])
    last = client.get("/api/snapshots/last").json()
    assert last["taken_at"] == TODAY.isoformat()
    assert last["items"][0]["amount"] == 900.0


def test_snapshot_same_day_overwrites_account_rows(client):
    acc = make_account(client, "Bank", "USD")
    other = make_account(client, "Cash", "USD")
    post_snapshot(client, [{"account_id": acc, "amount": 1000}, {"account_id": other, "amount": 50}])
    # поправил цифру по одному счёту тем же днём — replace, не сумма; второй счёт не трогаем
    post_snapshot(client, [{"account_id": acc, "amount": 900}])
    s = client.get("/api/summary").json()
    assert s["t0"] == pytest.approx(950.0)


def test_snapshots_history_totals_by_date(client):
    seed_fx(client, "HKD", 0.128)
    bank = make_account(client, "Bank", "USD")
    hk = make_account(client, "HK", "HKD")
    post_snapshot(client, [{"account_id": bank, "amount": 1000}, {"account_id": hk, "amount": 10000}],
                  taken_at=TODAY - timedelta(days=7))
    post_snapshot(client, [{"account_id": bank, "amount": 1200}], taken_at=TODAY)
    h = client.get("/api/snapshots/history").json()
    assert h["base_currency"] == "USD"
    assert len(h["items"]) == 2
    assert h["items"][0]["date"] == (TODAY - timedelta(days=7)).isoformat()
    assert h["items"][0]["total"] == pytest.approx(1000 + 10000 * 0.128)  # 2280
    assert h["items"][1]["total"] == pytest.approx(1200)  # последний день — только Bank


def test_snapshot_by_date_returns_items(client):
    acc = make_account(client, "Bank", "USD")
    other = make_account(client, "Cash", "USD")
    old = TODAY - timedelta(days=7)
    post_snapshot(client, [{"account_id": acc, "amount": 1000}, {"account_id": other, "amount": 50}], taken_at=old)
    post_snapshot(client, [{"account_id": acc, "amount": 1200}], taken_at=TODAY)

    r = client.get(f"/api/snapshots/{old.isoformat()}")
    assert r.status_code == 200
    snap = r.json()
    assert snap["taken_at"] == old.isoformat()
    by_acc = {i["account_id"]: i["amount"] for i in snap["items"]}
    assert by_acc == {acc: 1000.0, other: 50.0}


def test_snapshot_by_date_404_when_empty(client):
    make_account(client, "Bank", "USD")
    r = client.get(f"/api/snapshots/{TODAY.isoformat()}")
    assert r.status_code == 404


def test_snapshot_prefill_carries_latest_per_account(client):
    # счёт, выпавший из последнего снимка, всё равно отдаёт последний известный остаток
    a = make_account(client, "Bank", "USD")
    b = make_account(client, "Cash", "USD")
    post_snapshot(client, [{"account_id": a, "amount": 100}, {"account_id": b, "amount": 50}],
                  taken_at=TODAY - timedelta(days=7))
    post_snapshot(client, [{"account_id": a, "amount": 120}], taken_at=TODAY)  # b выпал

    pf = client.get("/api/snapshots/prefill").json()
    by_acc = {i["account_id"]: i["amount"] for i in pf["items"]}
    assert by_acc == {a: 120.0, b: 50.0}  # a — из сегодня, b — перенесён с прошлого


# ---------- gap ----------

def test_summary_gap_with_obligation_and_cushion(client):
    acc = make_account(client, "Bank", "USD")
    post_snapshot(client, [{"account_id": acc, "amount": 5000}])
    client.patch("/api/settings", json={"cushion": 2000})
    r = client.post("/api/obligations", json={
        "name": "Платёж", "amount": 4000, "currency": "USD",
        "due_date": (TODAY + timedelta(days=60)).isoformat(),
    })
    assert r.status_code == 201
    s = client.get("/api/summary").json()
    assert s["gap_amount"] == pytest.approx(1000.0)
    assert s["gap_deadline"] == (TODAY + timedelta(days=46)).isoformat()


# ---------- obligations / inflows ----------

def test_obligation_paid_drops_from_forecast(client):
    acc = make_account(client, "Bank", "USD")
    post_snapshot(client, [{"account_id": acc, "amount": 5000}])
    ob = client.post("/api/obligations", json={
        "name": "Платёж", "amount": 1000, "currency": "USD",
        "due_date": (TODAY + timedelta(days=10)).isoformat(),
    }).json()

    end_total = client.get("/api/forecast").json()["scenarios"]["base"][-1][1]
    assert end_total == pytest.approx(4000.0)

    client.patch(f"/api/obligations/{ob['id']}", json={"status": "paid"})
    end_total = client.get("/api/forecast").json()["scenarios"]["base"][-1][1]
    assert end_total == pytest.approx(5000.0)


def test_inflow_crud_and_scenarios(client):
    acc = make_account(client, "Bank", "USD")
    post_snapshot(client, [{"account_id": acc, "amount": 5000}])
    client.post("/api/inflows", json={
        "name": "Инвойс", "amount": 1000, "currency": "USD",
        "expected_date": (TODAY + timedelta(days=5)).isoformat(),
        "probability": "likely",
    })
    f = client.get("/api/forecast").json()
    assert f["scenarios"]["pessimistic"][-1][1] == pytest.approx(5000.0)
    assert f["scenarios"]["base"][-1][1] == pytest.approx(5700.0)
    assert f["scenarios"]["optimistic"][-1][1] == pytest.approx(6000.0)


# ---------- хотелки ----------

def test_wishes_crud_with_base_conversion(client):
    seed_fx(client, "KZT", 0.002)
    assert client.get("/api/wishes").json()["items"] == []
    r = client.post("/api/wishes", json={
        "name": "iPhone", "amount": 1500, "currency": "USD", "priority": "high",
    })
    assert r.status_code == 201
    r2 = client.post("/api/wishes", json={
        "name": "Велик", "amount": 500000, "currency": "KZT", "priority": "low",
    })
    assert r2.status_code == 201
    data = client.get("/api/wishes").json()
    assert {i["name"] for i in data["items"]} == {"iPhone", "Велик"}
    iphone = next(i for i in data["items"] if i["name"] == "iPhone")
    assert iphone["amount_base"] == pytest.approx(1500.0)
    velik = next(i for i in data["items"] if i["name"] == "Велик")
    assert velik["amount_base"] == pytest.approx(1000.0)  # 500000 * 0.002
    assert data["by_priority"]["high"] == pytest.approx(1500.0)
    assert data["by_priority"]["low"] == pytest.approx(1000.0)
    assert data["total"] == pytest.approx(2500.0)


def test_wish_delete(client):
    wid = client.post("/api/wishes", json={"name": "X", "amount": 10, "currency": "USD"}).json()["id"]
    assert client.delete(f"/api/wishes/{wid}").status_code == 200
    assert client.get("/api/wishes").json()["items"] == []


def test_wish_promote_creates_obligation_and_marks_bought(client):
    wid = client.post("/api/wishes", json={
        "name": "Ноутбук", "amount": 2000, "currency": "USD", "priority": "high",
        "target_date": (TODAY + timedelta(days=30)).isoformat(), "category": "Техника",
    }).json()["id"]
    r = client.post(f"/api/wishes/{wid}/promote")
    assert r.status_code == 201
    # появилось обязательство с теми же параметрами
    obs = client.get("/api/obligations").json()
    assert any(o["name"] == "Ноутбук" and o["amount"] == 2000.0 and o["category"] == "Техника" for o in obs)
    # хотелка помечена купленной (исчезла из активных)
    active = client.get("/api/wishes").json()["items"]
    assert "Ноутбук" not in [i["name"] for i in active]


def test_wish_image_fields_roundtrip(client):
    wid = client.post("/api/wishes", json={
        "name": "Камера", "amount": 2000, "currency": "USD",
        "image_url": "https://img/cam.jpg", "image_source": "manual",
    }).json()["id"]
    item = next(i for i in client.get("/api/wishes").json()["items"] if i["id"] == wid)
    assert item["image_url"] == "https://img/cam.jpg"
    assert item["image_source"] == "manual"


def test_wish_image_defaults_none(client):
    client.post("/api/wishes", json={"name": "X", "amount": 10, "currency": "USD"})
    item = client.get("/api/wishes").json()["items"][0]
    assert item["image_url"] is None
    assert item["image_source"] is None


def test_wish_patch_image_url(client):
    wid = client.post("/api/wishes", json={"name": "X", "amount": 10, "currency": "USD"}).json()["id"]
    client.patch(f"/api/wishes/{wid}", json={"image_url": "https://img/x.png", "image_source": "manual"})
    item = client.get("/api/wishes").json()["items"][0]
    assert item["image_url"] == "https://img/x.png"
    assert item["image_source"] == "manual"


def test_wish_image_url_downloads_and_serves_locally(client, monkeypatch):
    from pathlib import Path

    from app import images
    monkeypatch.setattr(images, "fetch_bytes", lambda *a, **k: b"IMGBYTES")
    wid = client.post("/api/wishes", json={"name": "Велосипед", "amount": 500, "currency": "USD"}).json()["id"]
    r = client.post(f"/api/wishes/{wid}/image/url", json={"url": "https://example.com/x.jpg"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["image_url"].startswith("/wish-images/")  # сохранено у нас, не хотлинк
    assert body["image_source"] == "manual"
    fname = body["image_url"].split("/wish-images/")[1]
    assert (Path(client.app.state.image_dir) / fname).read_bytes() == b"IMGBYTES"
    item = next(i for i in client.get("/api/wishes").json()["items"] if i["id"] == wid)
    assert item["image_url"] == body["image_url"]


def test_wish_image_url_rejects_unsafe(client):
    wid = client.post("/api/wishes", json={"name": "X", "amount": 1, "currency": "USD"}).json()["id"]
    assert client.post(f"/api/wishes/{wid}/image/url", json={"url": "http://127.0.0.1/x"}).status_code == 400


def test_wish_image_url_404_for_missing(client):
    assert client.post("/api/wishes/999/image/url", json={"url": "https://example.com/x.jpg"}).status_code == 404


def test_wish_image_url_download_failure(client, monkeypatch):
    from app import images
    monkeypatch.setattr(images, "fetch_bytes", lambda *a, **k: None)  # скачивание упало
    wid = client.post("/api/wishes", json={"name": "X", "amount": 1, "currency": "USD"}).json()["id"]
    r = client.post(f"/api/wishes/{wid}/image/url", json={"url": "https://example.com/x.jpg"})
    assert r.json()["ok"] is False and r.json()["image_url"] is None


def test_wish_image_upload_saves(client):
    from pathlib import Path
    wid = client.post("/api/wishes", json={"name": "Камера", "amount": 1, "currency": "USD"}).json()["id"]
    r = client.post(f"/api/wishes/{wid}/image/upload",
                    files={"file": ("dream.png", b"PNGDATA", "image/png")})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["image_url"].startswith("/wish-images/")
    assert body["image_source"] == "upload"
    fname = body["image_url"].split("/wish-images/")[1]
    assert (Path(client.app.state.image_dir) / fname).read_bytes() == b"PNGDATA"
    item = next(i for i in client.get("/api/wishes").json()["items"] if i["id"] == wid)
    assert item["image_url"] == body["image_url"]


def test_wish_image_upload_rejects_non_image(client):
    wid = client.post("/api/wishes", json={"name": "X", "amount": 1, "currency": "USD"}).json()["id"]
    r = client.post(f"/api/wishes/{wid}/image/upload",
                    files={"file": ("notes.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_wish_card_size_patch(client):
    wid = client.post("/api/wishes", json={"name": "X", "amount": 1, "currency": "USD"}).json()["id"]
    assert client.get("/api/wishes").json()["items"][0]["card_size"] is None
    client.patch(f"/api/wishes/{wid}", json={"card_size": "wide"})
    item = client.get("/api/wishes").json()["items"][0]
    assert item["card_size"] == "wide"
    # «Квадратик» на Доске — маленький квадрат
    client.patch(f"/api/wishes/{wid}", json={"card_size": "small"})
    assert client.get("/api/wishes").json()["items"][0]["card_size"] == "small"


# ---------- справочники: направления и категории ----------

def test_directions_crud(client):
    assert client.get("/api/directions").json() == []
    r = client.post("/api/directions", json={"name": "Консалтинг"})
    assert r.status_code == 201
    did = r.json()["id"]
    assert [d["name"] for d in client.get("/api/directions").json()] == ["Консалтинг"]
    # дубликаты молча игнорируются (idempotent)
    client.post("/api/directions", json={"name": "Консалтинг"})
    assert len(client.get("/api/directions").json()) == 1
    client.delete(f"/api/directions/{did}")
    assert client.get("/api/directions").json() == []


def test_categories_crud(client):
    r = client.post("/api/categories", json={"name": "Жильё"})
    assert r.status_code == 201
    assert [c["name"] for c in client.get("/api/categories").json()] == ["Жильё"]


def test_income_post_registers_direction_in_reference(client):
    # новое направление из формы дохода само попадает в справочник
    client.post("/api/income", json={"amount": 100, "currency": "USD", "direction": "новое-направление"})
    assert "новое-направление" in [d["name"] for d in client.get("/api/directions").json()]


def test_obligation_accepts_category(client):
    cat = client.post("/api/obligations", json={
        "name": "Аренда", "amount": 1000, "currency": "AED",
        "due_date": TODAY.isoformat(), "category": "Жильё",
    })
    assert cat.status_code == 201
    assert client.get("/api/obligations").json()[0]["category"] == "Жильё"
    # категория тоже зарегистрировалась в справочнике
    assert "Жильё" in [c["name"] for c in client.get("/api/categories").json()]


# ---------- доходы: от кого и по какому направлению ----------

def test_inflow_accepts_direction_and_counterparty(client):
    r = client.post("/api/inflows", json={
        "name": "Поток июнь", "amount": 5000, "currency": "USD",
        "expected_date": TODAY.isoformat(),
        "counterparty": "Client A", "direction": "Консалтинг",
    })
    assert r.status_code == 201
    row = client.get("/api/inflows").json()[0]
    assert row["counterparty"] == "Client A"
    assert row["direction"] == "Консалтинг"


def test_inflow_name_optional_derives_from_counterparty(client):
    # без name заголовок берётся из counterparty — как у доходов
    r = client.post("/api/inflows", json={
        "amount": 5000, "currency": "USD",
        "expected_date": TODAY.isoformat(), "counterparty": "Oasis",
    })
    assert r.status_code == 201
    assert client.get("/api/inflows").json()[0]["name"] == "Oasis"

    # без name и без counterparty — дефолтный заголовок
    r2 = client.post("/api/inflows", json={
        "amount": 100, "currency": "USD", "expected_date": TODAY.isoformat(),
    })
    assert r2.status_code == 201
    assert any(x["name"] == "Поступление" for x in client.get("/api/inflows").json())


def test_enum_validation_rejects_bad_values(client):
    # плохой recurrence при создании
    assert client.post("/api/obligations", json={
        "name": "X", "amount": 1, "currency": "USD",
        "due_date": TODAY.isoformat(), "recurrence": "nonsense",
    }).status_code == 422
    # плохой status при PATCH
    r = client.post("/api/obligations", json={
        "name": "Y", "amount": 1, "currency": "USD",
        "due_date": TODAY.isoformat(), "recurrence": "monthly",
    })
    ob_id = r.json()["id"]
    assert client.patch(f"/api/obligations/{ob_id}", json={"status": "panned"}).status_code == 422
    # плохая probability у inflow
    assert client.post("/api/inflows", json={
        "amount": 1, "currency": "USD", "expected_date": TODAY.isoformat(), "probability": "maybe",
    }).status_code == 422


def test_enum_validation_accepts_valid_values(client):
    r = client.post("/api/obligations", json={
        "name": "Z", "amount": 1, "currency": "USD",
        "due_date": TODAY.isoformat(), "recurrence": "monthly",
    })
    assert r.status_code == 201
    ob_id = r.json()["id"]
    assert client.patch(f"/api/obligations/{ob_id}", json={"status": "cancelled"}).status_code == 200
    assert client.post("/api/inflows", json={
        "amount": 1, "currency": "USD", "expected_date": TODAY.isoformat(), "probability": "likely",
    }).status_code == 201


def test_inflow_patch_status_transitions(client):
    r = client.post("/api/inflows", json={
        "name": "Поток", "amount": 1000, "currency": "USD", "expected_date": TODAY.isoformat(),
    })
    inf_id = r.json()["id"]
    for status in ("received", "lost", "expected"):
        assert client.patch(f"/api/inflows/{inf_id}", json={"status": status}).status_code == 200
        assert client.get("/api/inflows").json()[0]["status"] == status


def test_inflow_patch_fields(client):
    r = client.post("/api/inflows", json={
        "name": "Поток", "amount": 1000, "currency": "USD", "expected_date": TODAY.isoformat(),
    })
    inf_id = r.json()["id"]
    resp = client.patch(f"/api/inflows/{inf_id}", json={
        "amount": 1234.5, "currency": "usdt", "expected_date": "2026-07-01",
        "probability": "likely", "counterparty": "X",
    })
    assert resp.status_code == 200
    row = client.get("/api/inflows").json()[0]
    assert row["amount"] == 1234.5
    assert row["currency"] == "USDT"  # хендлер аплоадит валюту в верхний регистр
    assert row["expected_date"] == "2026-07-01"
    assert row["probability"] == "likely"
    assert row["counterparty"] == "X"


def test_inflow_patch_404(client):
    assert client.patch("/api/inflows/999999", json={"status": "received"}).status_code == 404


def test_inflow_delete(client):
    r = client.post("/api/inflows", json={
        "amount": 500, "currency": "USD", "expected_date": TODAY.isoformat(),
    })
    inf_id = r.json()["id"]
    assert client.delete(f"/api/inflows/{inf_id}").status_code == 200
    assert all(i["id"] != inf_id for i in client.get("/api/inflows").json())


def test_inflow_delete_404(client):
    assert client.delete("/api/inflows/999999").status_code == 404


def test_income_quick_add_creates_received_inflow(client):
    r = client.post("/api/income", json={
        "amount": 3000, "currency": "USD",
        "counterparty": "Client B", "direction": "Фриланс",
    })
    assert r.status_code == 201
    inflows = client.get("/api/inflows").json()
    assert len(inflows) == 1
    assert inflows[0]["status"] == "received"
    assert inflows[0]["expected_date"] == TODAY.isoformat()
    assert inflows[0]["direction"] == "Фриланс"


def test_income_summary_groups_by_direction_and_month(client):
    seed_fx(client, "HKD", 0.125)
    # два факта в разных направлениях + один ожидаемый (в сводку не входит)
    client.post("/api/income", json={
        "amount": 3000, "currency": "USD", "counterparty": "Client B",
        "direction": "Фриланс", "received_date": TODAY.isoformat(),
    })
    client.post("/api/income", json={
        "amount": 40000, "currency": "HKD", "counterparty": "Client A",
        "direction": "Консалтинг", "received_date": TODAY.isoformat(),
    })
    client.post("/api/inflows", json={
        "name": "Ожидаемое", "amount": 9999, "currency": "USD",
        "expected_date": TODAY.isoformat(),
    })
    s = client.get("/api/income").json()
    assert s["base_currency"] == "USD"
    assert s["by_direction"]["Фриланс"] == pytest.approx(3000.0)
    assert s["by_direction"]["Консалтинг"] == pytest.approx(5000.0)  # 40000 * 0.125
    month = TODAY.strftime("%Y-%m")
    assert s["by_month"][month] == pytest.approx(8000.0)
    assert len(s["items"]) == 2


# ---------- recurring obligations: «оплачено» сдвигает на следующий период ----------

def test_paying_recurring_obligation_advances_to_next_period(client):
    from app.forecast import next_period
    due = TODAY + timedelta(days=10)
    r = client.post("/api/obligations", json={
        "name": "Аренда", "amount": 1000, "currency": "USD",
        "due_date": due.isoformat(), "recurrence": "monthly",
    })
    ob_id = r.json()["id"]
    client.patch(f"/api/obligations/{ob_id}", json={"status": "paid"})
    o = client.get("/api/obligations").json()[0]
    assert o["status"] == "planned"  # серия продолжается
    assert o["due_date"] == next_period(due, "monthly").isoformat()  # сдвинулась на месяц


def test_paying_overdue_recurring_advances_only_one_occurrence(client):
    """Просроченное повторяющееся «оплачено» должно встать на ПЕРВОЕ наступление
    on-or-after сегодня, а не перепрыгнуть его на лишний период."""
    from app.forecast import next_period
    # первое число прошлого месяца — гарантированно в прошлом, на ~2 периода назад
    due = (TODAY.replace(day=1) - timedelta(days=1)).replace(day=1)
    r = client.post("/api/obligations", json={
        "name": "Аренда просрочена", "amount": 1000, "currency": "USD",
        "due_date": due.isoformat(), "recurrence": "monthly",
    })
    ob_id = r.json()["id"]
    client.patch(f"/api/obligations/{ob_id}", json={"status": "paid"})
    o = client.get("/api/obligations").json()[0]
    expected = due  # первое наступление on-or-after сегодня
    while expected < TODAY:
        expected = next_period(expected, "monthly")
    assert o["status"] == "planned"
    assert o["due_date"] == expected.isoformat()  # ровно следующее, без пропуска


def test_paying_recurring_at_series_end_marks_paid(client):
    due = TODAY + timedelta(days=5)
    r = client.post("/api/obligations", json={
        "name": "Курс", "amount": 100, "currency": "USD",
        "due_date": due.isoformat(), "recurrence": "monthly", "recurrence_end": due.isoformat(),
    })
    ob_id = r.json()["id"]
    client.patch(f"/api/obligations/{ob_id}", json={"status": "paid"})
    o = client.get("/api/obligations").json()[0]
    assert o["status"] == "paid"  # следующий платёж за пределами серии → завершена


def test_paying_oneoff_obligation_marks_paid(client):
    r = client.post("/api/obligations", json={
        "name": "Билеты", "amount": 500, "currency": "USD",
        "due_date": (TODAY + timedelta(days=12)).isoformat(), "recurrence": "once",
    })
    ob_id = r.json()["id"]
    client.patch(f"/api/obligations/{ob_id}", json={"status": "paid"})
    o = client.get("/api/obligations").json()[0]
    assert o["status"] == "paid"  # разовое — как раньше


# ---------- fx / rates ----------

def test_rates_overview_lists_rates_and_missing(client):
    seed_fx(client, "HKD", 0.128)
    make_account(client, "Wio", "AED")  # AED в обороте, но курса нет
    data = client.get("/api/rates").json()
    assert data["base_currency"] == "USD"
    hkd = next(x for x in data["rates"] if x["currency"] == "HKD")
    assert hkd["rate_to_base"] == pytest.approx(0.128)
    assert "AED" in data["missing"]  # used currency без курса


def test_manual_fx_overrides_same_day_rate(client):
    seed_fx(client, "BTC", 0.00001)   # ошибочный ручной курс
    seed_fx(client, "BTC", 60000)     # тем же днём правим — должен заменить
    data = client.get("/api/rates").json()
    btc = next(x for x in data["rates"] if x["currency"] == "BTC")
    assert btc["rate_to_base"] == pytest.approx(60000)


def test_wish_currency_counts_as_used(client):
    # валюта, встречающаяся только в покупке, должна учитываться как используемая
    client.post("/api/wishes", json={"name": "Камера", "amount": 2000, "currency": "EUR"})
    data = client.get("/api/rates").json()
    assert "EUR" in data["missing"]


def test_fx_refresh_without_foreign_currency_returns_zero(client):
    # в обороте только база → внешний фетч не нужен, сети не касаемся
    r = client.post("/api/fx/refresh")
    assert r.status_code == 200
    assert r.json()["written"] == 0


# ---------- expenses summary / required monthly income ----------

def test_expenses_summary_normalizes_to_monthly_by_category(client):
    client.post("/api/obligations", json={"name": "Аренда", "amount": 1000, "currency": "USD",
        "due_date": TODAY.isoformat(), "recurrence": "monthly", "category": "Жильё"})
    client.post("/api/obligations", json={"name": "Налог", "amount": 12000, "currency": "USD",
        "due_date": TODAY.isoformat(), "recurrence": "yearly", "category": "Налоги"})
    client.post("/api/obligations", json={"name": "Психолог", "amount": 100, "currency": "USD",
        "due_date": TODAY.isoformat(), "recurrence": "weekly", "category": "Здоровье"})
    client.post("/api/obligations", json={"name": "Билеты", "amount": 1500, "currency": "USD",
        "due_date": TODAY.isoformat(), "recurrence": "once", "category": "Путешествия"})
    d = client.get("/api/expenses").json()
    assert d["by_category"]["Жильё"] == pytest.approx(1000)
    assert d["by_category"]["Налоги"] == pytest.approx(1000)          # 12000 / 12
    assert d["by_category"]["Здоровье"] == pytest.approx(100 * 52 / 12)  # ≈ 433.33
    assert d["monthly_obligations"] == pytest.approx(1000 + 1000 + 100 * 52 / 12)
    assert d["one_off_total"] == pytest.approx(1500)
    assert d["one_off_count"] == 1
    assert d["burn_monthly"] == pytest.approx(0)  # без снимков и manual burn
    assert d["required_monthly_income"] == pytest.approx(d["monthly_obligations"])


def test_required_monthly_income_includes_burn(client):
    client.patch("/api/settings", json={"manual_burn_weekly": 700})
    client.post("/api/obligations", json={"name": "Аренда", "amount": 1000, "currency": "USD",
        "due_date": TODAY.isoformat(), "recurrence": "monthly", "category": "Жильё"})
    d = client.get("/api/expenses").json()
    assert d["burn_monthly"] == pytest.approx(700 * 52 / 12)
    assert d["required_monthly_income"] == pytest.approx(1000 + 700 * 52 / 12)


def test_income_expected_pipeline_by_probability(client):
    for prob in ["confirmed", "likely", "possible"]:
        client.post("/api/inflows", json={"amount": 1000, "currency": "USD",
            "expected_date": TODAY.isoformat(), "probability": prob, "counterparty": prob})
    client.post("/api/income", json={"amount": 500, "currency": "USD", "counterparty": "X"})  # received — не пайплайн
    exp = client.get("/api/income").json()["expected"]
    assert exp["by_probability"]["confirmed"] == pytest.approx(1000)
    assert exp["total"] == pytest.approx(3000)
    assert exp["weighted"] == pytest.approx(1000 + 700 + 300)  # 1 / 0.7 / 0.3
    assert exp["by_month"][TODAY.strftime("%Y-%m")] == pytest.approx(3000)  # разбивка по месяцам


# ---------- course (песочница декомпозиции) ----------

def test_course_summary_net_and_vs_required(client):
    # тариф 1000 USD × 5 учеников = 5000 за поток, поток раз в месяц → 5000/мес
    r = client.post("/api/course/tariffs",
                    json={"name": "Основной", "price": 1000, "currency": "USD", "students": 5})
    assert r.status_code == 201, r.text
    client.patch("/api/course/config", json={"cohort_months": 1})
    client.post("/api/course/costs", json={"name": "Реклама", "amount": 1000, "currency": "USD", "kind": "monthly"})

    # обязательство 2000 USD/мес → required_monthly_income = 2000 (нет снимков/burn)
    client.post("/api/obligations", json={"name": "Аренда", "amount": 2000, "currency": "USD",
        "due_date": TODAY.isoformat(), "recurrence": "monthly"})

    c = client.get("/api/course").json()
    assert c["students_total"] == 5
    assert c["gross_monthly"] == pytest.approx(5000.0)
    assert c["net_monthly"] == pytest.approx(4000.0)            # 5000 − 1000 fixed
    assert c["required_monthly_income"] == pytest.approx(2000.0)
    assert c["net_vs_required"] == pytest.approx(2000.0)        # покрывает с запасом
    assert c["cohort_months"] == 1
    assert len(c["tariffs"]) == 1


def test_course_tariffs_crud(client):
    r = client.post("/api/course/tariffs",
                    json={"name": "Базовый", "price": 500, "currency": "usd", "students": 10})
    tid = r.json()["id"]
    t = client.get("/api/course").json()["tariffs"][0]
    assert t["currency"] == "USD"        # аптокейс
    assert t["gross_base"] == pytest.approx(5000.0)

    client.patch(f"/api/course/tariffs/{tid}", json={"students": 12})
    assert client.get("/api/course").json()["tariffs"][0]["students"] == 12

    assert client.delete(f"/api/course/tariffs/{tid}").status_code == 200
    assert client.get("/api/course").json()["tariffs"] == []


def test_course_summary_includes_one_offs_and_gap(client):
    client.patch("/api/settings", json={"cushion": 1000})
    client.post("/api/obligations", json={"name": "Школа, семестр", "amount": 3000,
        "currency": "USD", "due_date": TODAY.isoformat(), "recurrence": "once"})
    c = client.get("/api/course").json()
    assert c["one_off_total"] == pytest.approx(3000.0)
    assert c["one_off_count"] == 1
    # подушка 1000 + разовый расход 3000, ни снимков, ни доходов → дефицит до подушки > 0
    assert c["gap_amount"] >= 1000.0


def test_course_costs_crud_and_kinds(client):
    client.post("/api/course/tariffs",
                json={"name": "Базовый", "price": 1000, "currency": "USD", "students": 4})
    client.patch("/api/course/config", json={"cohort_months": 1})
    # фикс/мес + на ученика (как отдельные строки)
    r = client.post("/api/course/costs",
                    json={"name": "Реклама", "amount": 500, "currency": "usd", "kind": "monthly"})
    cid = r.json()["id"]
    client.post("/api/course/costs",
                json={"name": "Проверка работ", "amount": 50, "currency": "USD", "kind": "per_student"})

    c = client.get("/api/course").json()
    assert {x["name"] for x in c["costs"]} == {"Реклама", "Проверка работ"}
    assert c["costs"][0]["currency"] == "USD"          # аптокейс
    assert c["fixed_monthly"] == pytest.approx(500.0)
    assert c["variable_monthly"] == pytest.approx(200.0)  # 50 × 4 ученика
    assert c["net_monthly"] == pytest.approx(3300.0)      # 4000 − 700

    client.patch(f"/api/course/costs/{cid}", json={"amount": 800})
    assert client.get("/api/course").json()["fixed_monthly"] == pytest.approx(800.0)

    assert client.delete(f"/api/course/costs/{cid}").status_code == 200
    assert {x["name"] for x in client.get("/api/course").json()["costs"]} == {"Проверка работ"}


def test_course_tariff_currency_surfaces_in_rates(client):
    client.post("/api/course/tariffs",
                json={"name": "KZT-тариф", "price": 200000, "currency": "KZT", "students": 3})
    rates = client.get("/api/rates").json()
    assert "KZT" in rates["missing"]  # валюта используется, курса ещё нет


# ---------- auth ----------

def test_api_token_enforced_when_configured():
    app = create_app(database_url=os.environ.get("TEST_DATABASE_URL", "sqlite://"), api_token="secret")
    with TestClient(app) as c:
        assert c.get("/api/summary").status_code == 401
        ok = c.get("/api/summary", headers={"Authorization": "Bearer secret"})
        assert ok.status_code == 200
