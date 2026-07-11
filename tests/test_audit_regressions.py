"""Регрессионные тесты по findings аудита docs/audit/finplan-service-audit.md.
Каждый тест фиксирует ИСПРАВЛЕННОЕ поведение конкретного пункта (#N в имени)."""
import os
from datetime import date, timedelta
from decimal import Decimal as D

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base, SettingsRow, _ensure_columns, make_engine, init_db, Account, SnapshotRow, ObligationRow
from app.forecast import Snap, Obligation, build_forecast
from app.images import is_real_image, is_safe_remote_url
from app.main import create_app
from app.service import expenses_summary, get_settings, rebase_currency, get_rates, wishes_summary

TODAY = date.today()


def _client(seed=True):
    return TestClient(create_app(database_url="sqlite://", fx_autofetch=False, seed=seed))


def real_png():
    from io import BytesIO

    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (32, 32), (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


# ---------- #5: чистый движок не роняет KeyError на валюте без курса ----------
def test_5_engine_missing_rate_counts_as_zero_not_keyerror():
    r = build_forecast(today=date(2026, 6, 7), horizon_days=30, rates={"USD": D("1")},
                       snapshots=[Snap(date(2026, 6, 7), "B", "EUR", D("1000"))],
                       obligations=[], inflows=[], cushion=D("0"))
    assert r.t0 == D("0")  # EUR без курса = 0, без исключения


# ---------- #4: просроченное регулярное обязательство не складывает все периоды ----------
def test_4_overdue_recurring_collapses_to_single_payment():
    snaps = [Snap(date(2026, 6, 7), "B", "USD", D("10000"))]
    ob = Obligation("Месячный", D("1000"), "USD", date(2026, 3, 7), recurrence="monthly", status="planned")
    r = build_forecast(today=date(2026, 6, 7), horizon_days=120, rates={"USD": D("1")},
                       snapshots=snaps, obligations=[ob], inflows=[], cushion=D("0"))
    pts = dict(r.scenarios["base"].points)
    assert D("10000") - pts[date(2026, 6, 7)] == D("1000")  # один платёж, не 4000


# ---------- #2: derived burn вычитает регулярные обязательства, наступившие в окне снимков ----------
def test_2_derived_burn_nets_out_in_window_recurring_obligation():
    # снимки падают 1000/нед; еженедельная подписка 1000 — её трата уже в дельте,
    # значит burn должен её вычесть (иначе двойной счёт с событиями кривой).
    snaps = [Snap(date(2026, 5, d), "B", "USD", D(str(a)))
             for d, a in [(3, 20000), (10, 19000), (17, 18000), (24, 17000), (31, 16000)]]
    ob = Obligation("Подписка", D("1000"), "USD", date(2026, 5, 7), recurrence="weekly", status="planned")
    with_ob = build_forecast(today=date(2026, 6, 7), horizon_days=60, rates={"USD": D("1")},
                             snapshots=snaps, obligations=[ob], inflows=[], cushion=D("0"))
    no_ob = build_forecast(today=date(2026, 6, 7), horizon_days=60, rates={"USD": D("1")},
                           snapshots=snaps, obligations=[], inflows=[], cushion=D("0"))
    assert no_ob.burn_weekly == D("1000")   # без обязательств весь спад = burn
    assert with_ob.burn_weekly == D("0")    # обязательство вычтено из burn → не задвоится


# ---------- #3/#7: breakeven не складывает обязательства с derived burn ----------
def test_3_7_required_not_double_counted_when_burn_derived():
    eng = make_engine("sqlite://")
    init_db(eng)
    db = Session(eng)
    s = get_settings(db)
    s.base_currency, s.cushion = "USD", D("0")
    db.commit()
    acc = Account(name="A", currency="USD", type="bank")
    db.add(acc)
    db.flush()
    for w in range(5):
        db.add(SnapshotRow(taken_at=TODAY - timedelta(days=7 * (4 - w)), account_id=acc.id,
                           amount=D(20000 - 500 * w)))
    db.add(ObligationRow(name="rent", amount=D("2166.67"), currency="USD",
                         due_date=TODAY + timedelta(days=40), recurrence="monthly",
                         status="planned", category="Жильё"))
    db.commit()
    e = expenses_summary(db)
    # required = max(obligations, burn), НЕ их сумма (раньше было ~двойное)
    assert e["required_monthly_income"] == pytest.approx(max(e["monthly_obligations"], e["burn_monthly"]))
    assert e["required_monthly_income"] < e["monthly_obligations"] + e["burn_monthly"]


def test_3_7_required_still_sums_when_burn_not_derived():
    # без снимков (burn none) поведение прежнее: obligations + burn (тут burn 0)
    c = _client(seed=True)
    c.post("/api/obligations", json={"name": "Аренда", "amount": 1000, "currency": "USD",
                                     "due_date": TODAY.isoformat(), "recurrence": "monthly"})
    d = c.get("/api/expenses").json()
    assert d["required_monthly_income"] == pytest.approx(d["monthly_obligations"] + d["burn_monthly"])


# ---------- #8: get_rates детерминированный тай-брейк (rate_date, id) ----------
def test_8_get_rates_uses_id_tiebreaker():
    eng = make_engine("sqlite://")
    init_db(eng)
    db = Session(eng)
    from app.db import FxRate
    db.add_all([FxRate(rate_date=date(2026, 6, 1), currency="EUR", rate_to_base=D("1.1")),
                FxRate(rate_date=date(2026, 6, 1), currency="EUR", rate_to_base=D("1.2"))])
    db.commit()
    rates, _ = get_rates(db, "USD")
    assert rates["EUR"] == D("1.2")  # позднейший id выигрывает детерминированно


# ---------- #9: rebase сохраняет исходную дату курса ----------
def test_9_rebase_preserves_rate_date():
    eng = make_engine("sqlite://")
    init_db(eng)
    db = Session(eng)
    from app.db import FxRate
    old = TODAY - timedelta(days=120)
    s = get_settings(db)
    s.base_currency = "USD"
    db.add(FxRate(rate_date=old, currency="EUR", rate_to_base=D("1.08")))
    db.commit()
    rebase_currency(db, "USD", "EUR")
    db.commit()
    assert get_rates(db, "EUR")[1] == old  # дата НЕ перескочила на today


# ---------- #10: course_summary считает прогноз один раз ----------
def test_10_course_computes_forecast_once(monkeypatch):
    import app.service as svc
    calls = []
    orig = svc.forecast_from_db
    monkeypatch.setattr(svc, "forecast_from_db", lambda *a, **k: (calls.append(1), orig(*a, **k))[1])
    c = _client(seed=True)
    calls.clear()
    c.get("/api/course")
    assert len(calls) == 1


# ---------- #11: horizon_days вне 7..730 → 422, эндпоинты живы ----------
def test_11_negative_horizon_rejected_422():
    c = TestClient(create_app(database_url="sqlite://", fx_autofetch=False, seed=True),
                   raise_server_exceptions=False)
    assert c.patch("/api/settings", json={"horizon_days": -50}).status_code == 422
    assert c.get("/api/summary").status_code == 200
    assert c.get("/api/forecast").status_code == 200


# ---------- #12: отрицательные суммы → 422 ----------
def test_12_negative_amounts_rejected():
    c = _client()
    due = (TODAY + timedelta(days=10)).isoformat()
    assert c.post("/api/obligations", json={"name": "n", "amount": -5000, "currency": "USD",
                                            "due_date": due}).status_code == 422
    assert c.post("/api/inflows", json={"amount": -1, "currency": "USD",
                                        "expected_date": due}).status_code == 422
    assert c.post("/api/wishes", json={"name": "w", "amount": -1, "currency": "USD"}).status_code == 422


# ---------- #13/#18/#19: over-length строки → 422 на обоих бэкендах ----------
def test_13_18_19_overlength_rejected():
    c = _client()
    assert c.post("/api/accounts", json={"name": "L", "currency": "ABCDEFGHIJKLMNOP"}).status_code == 422
    assert c.post("/api/accounts", json={"name": "A" * 200, "currency": "USD"}).status_code == 422
    assert c.post("/api/obligations", json={"name": "N" * 500, "amount": 10, "currency": "USD",
                                            "due_date": "2026-07-01"}).status_code == 422
    assert c.post("/api/course/tariffs", json={"name": "t", "price": 100,
                                               "currency": "verylongticker", "students": 5}).status_code == 422


# ---------- #15: add_fx отвергает пустую валюту / неположительный курс ----------
def test_15_add_fx_rejects_blank_currency_and_nonpositive_rate():
    c = _client()
    assert c.post("/api/fx", json={"currency": "", "rate_to_base": 1.5}).status_code == 422
    assert c.post("/api/fx", json={"currency": "   ", "rate_to_base": 1.5}).status_code == 422
    assert c.post("/api/fx", json={"currency": "EUR", "rate_to_base": 0}).status_code == 422
    assert c.post("/api/fx", json={"currency": "GBP", "rate_to_base": -5}).status_code == 422
    assert "" not in [r["currency"] for r in c.get("/api/rates").json()["rates"]]


# ---------- #14: PATCH с явным null очищает nullable-поле ----------
def test_14_patch_null_clears_field():
    c = _client()
    i = c.post("/api/inflows", json={"amount": 100, "currency": "USD", "expected_date": "2026-07-01",
                                     "note": "hi", "counterparty": "Bob", "recurrence": "monthly",
                                     "recurrence_end": "2026-12-01"}).json()["id"]
    assert c.patch(f"/api/inflows/{i}", json={"note": None, "counterparty": None,
                                              "recurrence_end": None}).status_code == 200
    r = [x for x in c.get("/api/inflows").json() if x["id"] == i][0]
    assert r["note"] is None and r["counterparty"] is None and r["recurrence_end"] is None


# ---------- #16: 404 несёт конкретный detail ----------
def test_16_404_has_specific_detail():
    c = _client()
    assert c.patch("/api/inflows/999", json={"amount": 5}).json()["detail"] == "unknown inflow 999"
    assert c.delete("/api/wishes/999").json()["detail"] == "unknown wish 999"


# ---------- #17: дубль account_id в снимке → честный count ----------
def test_17_snapshot_dedup_count_matches_stored():
    c = _client()
    a = c.post("/api/accounts", json={"name": "A", "currency": "USD"}).json()["id"]
    r = c.post("/api/snapshots", json={"items": [{"account_id": a, "amount": 100},
                                                 {"account_id": a, "amount": 200}]})
    assert r.json()["items"] == 1
    stored = c.get("/api/snapshots/last").json()["items"]
    assert len(stored) == 1 and stored[0]["amount"] == 200.0


# ---------- #20: NULL sort_order не роняет /api/wishes ----------
def test_20_null_sort_order_does_not_crash():
    e = create_engine("sqlite://")
    Base.metadata.create_all(e)
    with e.begin() as conn:
        conn.execute(text("DROP TABLE wishes"))
        conn.execute(text("CREATE TABLE wishes (id INTEGER PRIMARY KEY, name VARCHAR(120), "
                          "amount NUMERIC(18,2), currency VARCHAR(12), priority VARCHAR(10), "
                          "target_date DATE, category VARCHAR(80), status VARCHAR(10), note VARCHAR(300))"))
    _ensure_columns(e)
    assert inspect(e).get_columns("wishes")  # колонка добавлена
    with e.begin() as conn:
        conn.execute(text("INSERT INTO wishes(name,amount,currency,priority,status,sort_order) "
                          "VALUES('a',10,'USD','medium','active',NULL)"))
        conn.execute(text("INSERT INTO wishes(name,amount,currency,priority,status,sort_order) "
                          "VALUES('b',10,'USD','medium','active',0)"))
    S = sessionmaker(bind=e)
    with S() as db:
        db.add(SettingsRow(id=1))
        db.commit()
    with S() as db:
        res = wishes_summary(db)  # не должно бросать TypeError
        assert len(res["items"]) == 2


# ---------- #21: миграция inflows.recurrence приходит NOT NULL ----------
def test_21_migration_recurrence_not_null():
    e = create_engine("sqlite://")
    Base.metadata.create_all(e)
    with e.begin() as conn:
        conn.execute(text("DROP TABLE inflows"))
        conn.execute(text("CREATE TABLE inflows (id INTEGER PRIMARY KEY, name VARCHAR(120), "
                          "amount NUMERIC(18,2), currency VARCHAR(12), expected_date DATE, "
                          "probability VARCHAR(10), status VARCHAR(10), note VARCHAR(300))"))
    _ensure_columns(e)
    cols = {c["name"]: c["nullable"] for c in inspect(e).get_columns("inflows")}
    assert cols["recurrence"] is False  # мигрированная схема NOT NULL, как в модели


def test_partial_payment_migration_adds_non_null_zero_paid_amount():
    e = create_engine("sqlite://")
    Base.metadata.create_all(e)
    with e.begin() as conn:
        conn.execute(text("DROP TABLE obligations"))
        conn.execute(text("CREATE TABLE obligations (id INTEGER PRIMARY KEY, name VARCHAR(120), "
                          "amount NUMERIC(18,2), currency VARCHAR(12), due_date DATE, "
                          "recurrence VARCHAR(10), recurrence_end DATE, status VARCHAR(10), "
                          "category VARCHAR(80), note VARCHAR(300))"))
        conn.execute(text("INSERT INTO obligations(name,amount,currency,due_date,recurrence,status) "
                          "VALUES('old',100,'USD','2026-07-11','once','planned')"))

    _ensure_columns(e)
    cols = {c["name"]: c["nullable"] for c in inspect(e).get_columns("obligations")}
    assert cols["paid_amount"] is False
    with e.connect() as conn:
        assert conn.execute(text("SELECT paid_amount FROM obligations")).scalar_one() == 0


# ---------- #26/#27: SSRF-гард резолвит и блокирует числовые/internal-хосты ----------
def test_26_numeric_ip_encodings_blocked():
    fake = lambda host, port: [(2, 1, 6, "", ("127.0.0.1", 0))]
    for h in ["2130706433", "0x7f000001", "127.1"]:
        assert is_safe_remote_url(f"http://{h}/x", resolve=fake) is False


def test_27_internal_metadata_hostnames_blocked():
    meta = lambda host, port: [(2, 1, 6, "", ("169.254.169.254", 0))]
    assert is_safe_remote_url("http://metadata.google.internal/latest/", resolve=meta) is False

    def nxdomain(host, port):
        raise OSError("nodename nor servname provided")
    assert is_safe_remote_url("http://internal.local/", resolve=nxdomain) is False


def test_26_27_public_host_still_allowed():
    pub = lambda host, port: [(2, 1, 6, "", ("104.20.23.154", 0))]
    assert is_safe_remote_url("https://images.unsplash.com/p.jpg", resolve=pub) is True


# ---------- #28: фетч-ответ не-картинка не сохраняется и не отдаётся ----------
def test_28_non_image_fetch_not_stored(tmp_path, monkeypatch):
    import app.images as images
    c = TestClient(create_app(database_url="sqlite://", fx_autofetch=False, seed=True,
                              image_dir=str(tmp_path)))
    wid = c.post("/api/wishes", json={"name": "x", "amount": 1, "currency": "USD"}).json()["id"]
    monkeypatch.setattr(images, "fetch_bytes", lambda *a, **k: b"SECRET-INTERNAL-RESPONSE")
    r = c.post(f"/api/wishes/{wid}/image/url", json={"url": "https://example.com/x.jpg"})
    assert r.json()["ok"] is False and r.json()["image_url"] is None
    assert list(tmp_path.iterdir()) == []  # ничего не записано


def test_28_real_image_fetch_saved_and_served(tmp_path, monkeypatch):
    import app.images as images
    c = TestClient(create_app(database_url="sqlite://", fx_autofetch=False, seed=True,
                              image_dir=str(tmp_path)))
    wid = c.post("/api/wishes", json={"name": "x", "amount": 1, "currency": "USD"}).json()["id"]
    monkeypatch.setattr(images, "fetch_bytes", lambda *a, **k: real_png())
    r = c.post(f"/api/wishes/{wid}/image/url", json={"url": "https://example.com/x.jpg"})
    assert r.json()["ok"] is True
    assert c.get(r.json()["image_url"]).status_code == 200


# ---------- #29: не-картинка по upload отвергается; настоящая проходит ----------
def test_29_is_real_image_distinguishes():
    assert is_real_image(b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>') is False
    assert is_real_image(b"") is False
    assert is_real_image(real_png()) is True
