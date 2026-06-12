"""REST API: ТЗ §7. JSON, Bearer-токен (если настроен)."""
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import images
from .db import (
    Account, Category, CourseConfigRow, CourseCost, CourseTariff, Direction, FxRate,
    InflowRow, ObligationRow, SnapshotRow, Wish,
)
from .forecast import next_period
from .service import (
    course_summary, expenses_summary, forecast_from_db, get_course_config, get_settings,
    income_summary, rates_overview, snapshots_history, upsert_snapshot, wishes_summary,
)


def register_reference(db: Session, model, name: str | None):
    """Идемпотентно заносит значение в справочник (directions/categories)."""
    name = (name or "").strip()
    if not name:
        return
    exists = db.scalar(select(model).where(model.name == name).limit(1))
    if exists is None:
        db.add(model(name=name))

router = APIRouter(prefix="/api")


# ---------- deps ----------

def get_db(request: Request):
    state = request.app.state
    demo = getattr(state, "DemoSessionLocal", None)
    # X-Demo: 1 → отдельная in-memory демо-БД (показ на Zoom), реальную не трогаем
    if demo is not None and request.headers.get("X-Demo") == "1":
        db = demo()
    else:
        db = state.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_token(request: Request):
    token = request.app.state.api_token
    if token is None:
        return
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="invalid or missing token")


# ---------- schemas ----------

class AccountIn(BaseModel):
    name: str
    currency: str
    type: str = "bank"
    sort_order: int = 0


class AccountPatch(BaseModel):
    name: str | None = None
    currency: str | None = None
    type: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class SnapshotItem(BaseModel):
    account_id: int
    amount: float


class SnapshotIn(BaseModel):
    taken_at: date | None = None
    items: list[SnapshotItem]


Recurrence = Literal["once", "weekly", "monthly", "yearly"]
ObStatus = Literal["planned", "paid", "cancelled"]
Probability = Literal["confirmed", "likely", "possible"]
InflowStatus = Literal["expected", "received", "lost"]
WishPriority = Literal["high", "medium", "low"]
WishStatus = Literal["active", "bought", "dropped"]
CardSize = Literal["small", "square", "tall", "wide", "large", "auto"]


class ObligationIn(BaseModel):
    name: str
    amount: float
    currency: str
    due_date: date
    recurrence: Recurrence = "once"
    recurrence_end: date | None = None
    category: str | None = None
    note: str | None = None


class ObligationPatch(BaseModel):
    name: str | None = None
    amount: float | None = None
    currency: str | None = None
    due_date: date | None = None
    recurrence: Recurrence | None = None
    recurrence_end: date | None = None
    status: ObStatus | None = None
    category: str | None = None
    note: str | None = None


class RefIn(BaseModel):
    name: str


class WishIn(BaseModel):
    name: str
    amount: float
    currency: str
    priority: WishPriority = "medium"
    target_date: date | None = None
    category: str | None = None
    note: str | None = None
    image_url: str | None = None
    image_source: str | None = None


class WishPatch(BaseModel):
    name: str | None = None
    amount: float | None = None
    currency: str | None = None
    priority: WishPriority | None = None
    target_date: date | None = None
    category: str | None = None
    status: WishStatus | None = None
    note: str | None = None
    image_url: str | None = None
    image_source: str | None = None
    card_size: CardSize | None = None  # small | square | tall | wide | large | auto


class WishImageUrl(BaseModel):
    url: str


class InflowIn(BaseModel):
    name: str | None = None
    amount: float
    currency: str
    expected_date: date
    probability: Probability = "confirmed"
    counterparty: str | None = None
    direction: str | None = None
    note: str | None = None


class InflowPatch(BaseModel):
    name: str | None = None
    amount: float | None = None
    currency: str | None = None
    expected_date: date | None = None
    probability: Probability | None = None
    status: InflowStatus | None = None
    counterparty: str | None = None
    direction: str | None = None
    note: str | None = None


class IncomeIn(BaseModel):
    """Быстрая запись факта: «заработал X от Y по направлению Z»."""
    amount: float
    currency: str
    counterparty: str | None = None
    direction: str | None = None
    name: str | None = None
    received_date: date | None = None


class SettingsPatch(BaseModel):
    base_currency: str | None = None
    cushion: float | None = None
    horizon_days: int | None = None
    manual_burn_weekly: float | None = None


class FxIn(BaseModel):
    currency: str
    rate_to_base: float
    rate_date: date | None = None


class CourseTariffIn(BaseModel):
    name: str
    price: float
    currency: str
    students: int = 0
    sort_order: int = 0


class CourseTariffPatch(BaseModel):
    name: str | None = None
    price: float | None = None
    currency: str | None = None
    students: int | None = None
    sort_order: int | None = None


class CourseCostIn(BaseModel):
    name: str
    amount: float
    currency: str
    kind: str = "monthly"  # monthly | per_student
    sort_order: int = 0


class CourseCostPatch(BaseModel):
    name: str | None = None
    amount: float | None = None
    currency: str | None = None
    kind: str | None = None
    sort_order: int | None = None


class CourseConfigPatch(BaseModel):
    cohort_months: int | None = None


def dec(v: float) -> Decimal:
    return Decimal(str(v))


# ---------- accounts ----------

@router.get("/accounts", dependencies=[Depends(require_token)])
def list_accounts(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Account).where(Account.is_active.is_(True)).order_by(Account.sort_order, Account.id)
    ).all()
    return [
        {"id": a.id, "name": a.name, "currency": a.currency, "type": a.type, "sort_order": a.sort_order}
        for a in rows
    ]


@router.post("/accounts", status_code=201, dependencies=[Depends(require_token)])
def create_account(body: AccountIn, db: Session = Depends(get_db)):
    a = Account(name=body.name, currency=body.currency.upper(), type=body.type, sort_order=body.sort_order)
    db.add(a)
    db.commit()
    return {"id": a.id}


@router.patch("/accounts/{acc_id}", dependencies=[Depends(require_token)])
def patch_account(acc_id: int, body: AccountPatch, db: Session = Depends(get_db)):
    a = db.get(Account, acc_id)
    if a is None:
        raise HTTPException(404)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(a, field, value.upper() if field == "currency" else value)
    db.commit()
    return {"ok": True}


@router.delete("/accounts/{acc_id}", dependencies=[Depends(require_token)])
def delete_account(acc_id: int, db: Session = Depends(get_db)):
    a = db.get(Account, acc_id)
    if a is None:
        raise HTTPException(404)
    a.is_active = False  # soft: история снимков остаётся
    db.commit()
    return {"ok": True}


# ---------- snapshots ----------

@router.post("/snapshots", status_code=201, dependencies=[Depends(require_token)])
def create_snapshot(body: SnapshotIn, db: Session = Depends(get_db)):
    taken_at = body.taken_at or date.today()
    for item in body.items:
        if db.get(Account, item.account_id) is None:
            raise HTTPException(400, f"unknown account_id {item.account_id}")
    n = upsert_snapshot(db, taken_at, [(i.account_id, dec(i.amount)) for i in body.items])
    return {"taken_at": taken_at.isoformat(), "items": n}


@router.get("/snapshots/last", dependencies=[Depends(require_token)])
def last_snapshot(db: Session = Depends(get_db)):
    last_date = db.scalar(select(SnapshotRow.taken_at).order_by(SnapshotRow.taken_at.desc()).limit(1))
    items = []
    if last_date is not None:
        rows = db.scalars(select(SnapshotRow).where(SnapshotRow.taken_at == last_date)).all()
        for r in rows:
            acc = db.get(Account, r.account_id)
            items.append({
                "account_id": r.account_id,
                "account": acc.name if acc else "?",
                "currency": acc.currency if acc else "?",
                "amount": float(r.amount),
            })
    return {"taken_at": last_date.isoformat() if last_date else None, "items": items}


@router.get("/snapshots/history", dependencies=[Depends(require_token)])
def snapshot_history(db: Session = Depends(get_db)):
    return snapshots_history(db)


@router.get("/snapshots/prefill", dependencies=[Depends(require_token)])
def snapshot_prefill(db: Session = Depends(get_db)):
    # последний известный остаток ПО КАЖДОМУ счёту (даже если он выпал из последнего снимка) —
    # чтобы форма префиллилась и счёт не обнулялся молча
    accounts = db.scalars(
        select(Account).where(Account.is_active.is_(True)).order_by(Account.sort_order, Account.id)
    ).all()
    items = []
    for acc in accounts:
        row = db.scalars(
            select(SnapshotRow)
            .where(SnapshotRow.account_id == acc.id)
            .order_by(SnapshotRow.taken_at.desc(), SnapshotRow.id.desc())
            .limit(1)
        ).first()
        if row is not None:
            items.append({
                "account_id": acc.id,
                "account": acc.name,
                "currency": acc.currency,
                "amount": float(row.amount),
                "taken_at": row.taken_at.isoformat(),
            })
    return {"items": items}


@router.get("/snapshots/{taken_at}", dependencies=[Depends(require_token)])
def snapshot_by_date(taken_at: date, db: Session = Depends(get_db)):
    rows = db.scalars(select(SnapshotRow).where(SnapshotRow.taken_at == taken_at)).all()
    if not rows:
        raise HTTPException(404, f"no snapshot for {taken_at.isoformat()}")
    items = []
    for r in rows:
        acc = db.get(Account, r.account_id)
        items.append({
            "account_id": r.account_id,
            "account": acc.name if acc else "?",
            "currency": acc.currency if acc else "?",
            "amount": float(r.amount),
        })
    return {"taken_at": taken_at.isoformat(), "items": items}


# ---------- obligations ----------

@router.get("/obligations", dependencies=[Depends(require_token)])
def list_obligations(db: Session = Depends(get_db)):
    rows = db.scalars(select(ObligationRow).order_by(ObligationRow.due_date)).all()
    return [
        {"id": o.id, "name": o.name, "amount": float(o.amount), "currency": o.currency,
         "due_date": o.due_date.isoformat(), "recurrence": o.recurrence,
         "recurrence_end": o.recurrence_end.isoformat() if o.recurrence_end else None,
         "status": o.status, "category": o.category, "note": o.note}
        for o in rows
    ]


@router.post("/obligations", status_code=201, dependencies=[Depends(require_token)])
def create_obligation(body: ObligationIn, db: Session = Depends(get_db)):
    o = ObligationRow(
        name=body.name, amount=dec(body.amount), currency=body.currency.upper(),
        due_date=body.due_date, recurrence=body.recurrence,
        recurrence_end=body.recurrence_end, category=body.category, note=body.note,
    )
    db.add(o)
    register_reference(db, Category, body.category)
    db.commit()
    return {"id": o.id}


@router.patch("/obligations/{ob_id}", dependencies=[Depends(require_token)])
def patch_obligation(ob_id: int, body: ObligationPatch, db: Session = Depends(get_db)):
    o = db.get(ObligationRow, ob_id)
    if o is None:
        raise HTTPException(404)
    data = body.model_dump(exclude_none=True)
    # повторяющееся + «оплачено» → не закрываем серию, а двигаем на следующий платёж
    if data.get("status") == "paid" and o.recurrence != "once":
        # Следующее наступление on-or-after сегодня — это и есть следующий платёж.
        # Просрочено → доматываем серию до него; в будущем → шагаем на один период.
        if o.due_date >= date.today():
            nxt = next_period(o.due_date, o.recurrence)
        else:
            nxt = o.due_date
            while nxt < date.today():
                nxt = next_period(nxt, o.recurrence)
        if o.recurrence_end is not None and nxt > o.recurrence_end:
            o.status = "paid"  # следующий платёж за пределами серии → завершена
        else:
            o.due_date = nxt
            o.status = "planned"
        data.pop("status", None)
    for field, value in data.items():
        if field == "amount":
            value = dec(value)
        if field == "currency":
            value = value.upper()
        setattr(o, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/obligations/{ob_id}", dependencies=[Depends(require_token)])
def delete_obligation(ob_id: int, db: Session = Depends(get_db)):
    o = db.get(ObligationRow, ob_id)
    if o is None:
        raise HTTPException(404)
    db.delete(o)
    db.commit()
    return {"ok": True}


# ---------- inflows ----------

@router.get("/inflows", dependencies=[Depends(require_token)])
def list_inflows(db: Session = Depends(get_db)):
    rows = db.scalars(select(InflowRow).order_by(InflowRow.expected_date)).all()
    return [
        {"id": i.id, "name": i.name, "amount": float(i.amount), "currency": i.currency,
         "expected_date": i.expected_date.isoformat(), "probability": i.probability,
         "status": i.status, "counterparty": i.counterparty, "direction": i.direction,
         "note": i.note}
        for i in rows
    ]


@router.post("/inflows", status_code=201, dependencies=[Depends(require_token)])
def create_inflow(body: InflowIn, db: Session = Depends(get_db)):
    i = InflowRow(
        name=body.name or body.counterparty or "Поступление",
        amount=dec(body.amount), currency=body.currency.upper(),
        expected_date=body.expected_date, probability=body.probability,
        counterparty=body.counterparty, direction=body.direction, note=body.note,
    )
    db.add(i)
    register_reference(db, Direction, body.direction)
    db.commit()
    return {"id": i.id}


# ---------- income: факты заработка ----------

@router.post("/income", status_code=201, dependencies=[Depends(require_token)])
def add_income(body: IncomeIn, db: Session = Depends(get_db)):
    i = InflowRow(
        name=body.name or body.counterparty or "Доход",
        amount=dec(body.amount), currency=body.currency.upper(),
        expected_date=body.received_date or date.today(),
        probability="confirmed", status="received",
        counterparty=body.counterparty, direction=body.direction,
    )
    db.add(i)
    register_reference(db, Direction, body.direction)
    db.commit()
    return {"id": i.id}


@router.get("/income", dependencies=[Depends(require_token)])
def income(db: Session = Depends(get_db)):
    return income_summary(db)


@router.get("/expenses", dependencies=[Depends(require_token)])
def expenses(db: Session = Depends(get_db)):
    return expenses_summary(db)


# ---------- course: песочница декомпозиции ----------

@router.get("/course", dependencies=[Depends(require_token)])
def course(db: Session = Depends(get_db)):
    return course_summary(db)


@router.post("/course/tariffs", status_code=201, dependencies=[Depends(require_token)])
def create_course_tariff(body: CourseTariffIn, db: Session = Depends(get_db)):
    t = CourseTariff(
        name=body.name, price=dec(body.price), currency=body.currency.upper(),
        students=body.students, sort_order=body.sort_order,
    )
    db.add(t)
    db.commit()
    return {"id": t.id}


@router.patch("/course/tariffs/{tariff_id}", dependencies=[Depends(require_token)])
def patch_course_tariff(tariff_id: int, body: CourseTariffPatch, db: Session = Depends(get_db)):
    t = db.get(CourseTariff, tariff_id)
    if t is None:
        raise HTTPException(404)
    for field, value in body.model_dump(exclude_none=True).items():
        if field == "price":
            value = dec(value)
        if field == "currency":
            value = value.upper()
        setattr(t, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/course/tariffs/{tariff_id}", dependencies=[Depends(require_token)])
def delete_course_tariff(tariff_id: int, db: Session = Depends(get_db)):
    t = db.get(CourseTariff, tariff_id)
    if t is None:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/course/costs", status_code=201, dependencies=[Depends(require_token)])
def create_course_cost(body: CourseCostIn, db: Session = Depends(get_db)):
    c = CourseCost(
        name=body.name, amount=dec(body.amount), currency=body.currency.upper(),
        kind=body.kind, sort_order=body.sort_order,
    )
    db.add(c)
    db.commit()
    return {"id": c.id}


@router.patch("/course/costs/{cost_id}", dependencies=[Depends(require_token)])
def patch_course_cost(cost_id: int, body: CourseCostPatch, db: Session = Depends(get_db)):
    c = db.get(CourseCost, cost_id)
    if c is None:
        raise HTTPException(404)
    for field, value in body.model_dump(exclude_none=True).items():
        if field == "amount":
            value = dec(value)
        if field == "currency":
            value = value.upper()
        setattr(c, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/course/costs/{cost_id}", dependencies=[Depends(require_token)])
def delete_course_cost(cost_id: int, db: Session = Depends(get_db)):
    c = db.get(CourseCost, cost_id)
    if c is None:
        raise HTTPException(404)
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.patch("/course/config", dependencies=[Depends(require_token)])
def patch_course_config(body: CourseConfigPatch, db: Session = Depends(get_db)):
    cfg = get_course_config(db)
    data = body.model_dump(exclude_none=True)
    if "cohort_months" in data:
        cfg.cohort_months = max(1, data["cohort_months"])
    db.commit()
    return {"ok": True}


# ---------- справочники: directions / categories ----------

def _ref_router(prefix: str, model):
    @router.get(f"/{prefix}", dependencies=[Depends(require_token)], name=f"list_{prefix}")
    def _list(db: Session = Depends(get_db)):
        rows = db.scalars(select(model).order_by(model.name)).all()
        return [{"id": r.id, "name": r.name} for r in rows]

    @router.post(f"/{prefix}", status_code=201, dependencies=[Depends(require_token)], name=f"add_{prefix}")
    def _add(body: RefIn, db: Session = Depends(get_db)):
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "empty name")
        existing = db.scalar(select(model).where(model.name == name).limit(1))
        if existing is not None:
            return {"id": existing.id}
        row = model(name=name)
        db.add(row)
        db.commit()
        return {"id": row.id}

    @router.delete(f"/{prefix}/{{ref_id}}", dependencies=[Depends(require_token)], name=f"del_{prefix}")
    def _del(ref_id: int, db: Session = Depends(get_db)):
        row = db.get(model, ref_id)
        if row is None:
            raise HTTPException(404)
        db.delete(row)
        db.commit()
        return {"ok": True}

    return _list, _add, _del


_ref_router("directions", Direction)
_ref_router("categories", Category)


# ---------- хотелки ----------

@router.get("/wishes", dependencies=[Depends(require_token)])
def list_wishes(db: Session = Depends(get_db)):
    return wishes_summary(db)


@router.post("/wishes", status_code=201, dependencies=[Depends(require_token)])
def create_wish(body: WishIn, db: Session = Depends(get_db)):
    w = Wish(
        name=body.name, amount=dec(body.amount), currency=body.currency.upper(),
        priority=body.priority, target_date=body.target_date,
        category=body.category, note=body.note,
        image_url=body.image_url, image_source=body.image_source,
    )
    db.add(w)
    register_reference(db, Category, body.category)
    db.commit()
    return {"id": w.id}


@router.patch("/wishes/{wish_id}", dependencies=[Depends(require_token)])
def patch_wish(wish_id: int, body: WishPatch, db: Session = Depends(get_db)):
    w = db.get(Wish, wish_id)
    if w is None:
        raise HTTPException(404)
    for field, value in body.model_dump(exclude_none=True).items():
        if field == "amount":
            value = dec(value)
        if field == "currency":
            value = value.upper()
        setattr(w, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/wishes/{wish_id}", dependencies=[Depends(require_token)])
def delete_wish(wish_id: int, db: Session = Depends(get_db)):
    w = db.get(Wish, wish_id)
    if w is None:
        raise HTTPException(404)
    db.delete(w)
    db.commit()
    return {"ok": True}


@router.post("/wishes/{wish_id}/promote", status_code=201, dependencies=[Depends(require_token)])
def promote_wish(wish_id: int, db: Session = Depends(get_db)):
    """Хотелка → обязательство (попадает в прогноз), сама помечается купленной."""
    w = db.get(Wish, wish_id)
    if w is None:
        raise HTTPException(404)
    o = ObligationRow(
        name=w.name, amount=w.amount, currency=w.currency,
        due_date=w.target_date or date.today(), recurrence="once",
        category=w.category,
    )
    db.add(o)
    w.status = "bought"
    register_reference(db, Category, w.category)
    db.commit()
    return {"obligation_id": o.id}


MAX_IMAGE_BYTES = 15 * 1024 * 1024  # 15 MB на загрузку


@router.post("/wishes/{wish_id}/image/url", dependencies=[Depends(require_token)])
def set_wish_image_url(request: Request, wish_id: int, body: WishImageUrl,
                       db: Session = Depends(get_db)):
    """Картинку по ссылке: скачиваем по URL и сохраняем у себя на сервере (не хотлинк)."""
    w = db.get(Wish, wish_id)
    if w is None:
        raise HTTPException(404)
    if not images.is_safe_remote_url(body.url):
        raise HTTPException(400, "unsafe url")
    data = images.fetch_bytes(body.url)
    if not data:
        return {"ok": False, "image_url": None, "image_source": None}
    fname = images.save_wish_image(request.app.state.image_dir, wish_id, data)
    w.image_url = f"/wish-images/{fname}"
    w.image_source = "manual"
    db.commit()
    return {"ok": True, "image_url": w.image_url, "image_source": "manual"}


@router.post("/wishes/{wish_id}/image/upload", dependencies=[Depends(require_token)])
async def upload_wish_image(request: Request, wish_id: int, file: UploadFile = File(...),
                            db: Session = Depends(get_db)):
    """Картинку файлом: загруженный файл сохраняем на сервере."""
    w = db.get(Wish, wish_id)
    if w is None:
        raise HTTPException(404)
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "not an image")
    data = await file.read()
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "empty or too large (>15MB)")
    fname = images.save_wish_image(request.app.state.image_dir, wish_id, data)
    w.image_url = f"/wish-images/{fname}"
    w.image_source = "upload"
    db.commit()
    return {"ok": True, "image_url": w.image_url, "image_source": "upload"}


@router.patch("/inflows/{inf_id}", dependencies=[Depends(require_token)])
def patch_inflow(inf_id: int, body: InflowPatch, db: Session = Depends(get_db)):
    i = db.get(InflowRow, inf_id)
    if i is None:
        raise HTTPException(404)
    for field, value in body.model_dump(exclude_none=True).items():
        if field == "amount":
            value = dec(value)
        if field == "currency":
            value = value.upper()
        setattr(i, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/inflows/{inf_id}", dependencies=[Depends(require_token)])
def delete_inflow(inf_id: int, db: Session = Depends(get_db)):
    i = db.get(InflowRow, inf_id)
    if i is None:
        raise HTTPException(404)
    db.delete(i)
    db.commit()
    return {"ok": True}


# ---------- settings / fx ----------

@router.get("/settings", dependencies=[Depends(require_token)])
def read_settings(db: Session = Depends(get_db)):
    s = get_settings(db)
    return {
        "base_currency": s.base_currency,
        "cushion": float(s.cushion),
        "horizon_days": s.horizon_days,
        "manual_burn_weekly": float(s.manual_burn_weekly) if s.manual_burn_weekly is not None else None,
    }


@router.patch("/settings", dependencies=[Depends(require_token)])
def patch_settings(body: SettingsPatch, db: Session = Depends(get_db)):
    s = get_settings(db)
    data = body.model_dump(exclude_none=True)
    if "cushion" in data:
        s.cushion = dec(data["cushion"])
    if "base_currency" in data:
        s.base_currency = data["base_currency"].upper()
    if "horizon_days" in data:
        s.horizon_days = data["horizon_days"]
    if "manual_burn_weekly" in data:
        s.manual_burn_weekly = dec(data["manual_burn_weekly"])
    db.commit()
    return {"ok": True}


@router.get("/rates", dependencies=[Depends(require_token)])
def list_rates(db: Session = Depends(get_db)):
    return rates_overview(db)


@router.post("/fx", status_code=201, dependencies=[Depends(require_token)])
def add_fx(body: FxIn, db: Session = Depends(get_db)):
    rate_date = body.rate_date or date.today()
    cur = body.currency.upper()
    # upsert: ручной курс заменяет курс того же дня (в т.ч. авто-фетч)
    for old in db.scalars(select(FxRate).where(FxRate.rate_date == rate_date, FxRate.currency == cur)).all():
        db.delete(old)
    db.add(FxRate(rate_date=rate_date, currency=cur, rate_to_base=dec(body.rate_to_base)))
    db.commit()
    return {"ok": True}


@router.post("/fx/refresh", dependencies=[Depends(require_token)])
def refresh_fx(request: Request):
    from .fx import fetch_and_store
    return {"written": fetch_and_store(request.app)}


# ---------- forecast / summary ----------

@router.get("/forecast", dependencies=[Depends(require_token)])
def forecast(db: Session = Depends(get_db)):
    result, settings, _ = forecast_from_db(db)
    return {
        "cushion": float(settings.cushion),
        "scenarios": {
            name: [[d.isoformat(), float(total)] for d, total in sc.points]
            for name, sc in result.scenarios.items()
        },
    }


@router.get("/summary", dependencies=[Depends(require_token)])
def summary(db: Session = Depends(get_db)):
    result, settings, extras = forecast_from_db(db)
    return {
        "t0": float(result.t0),
        "t0_by_currency": {c: float(a) for c, a in result.t0_by_currency.items()},
        "burn_weekly": float(result.burn_weekly),
        "burn_source": result.burn_source,
        "gap_amount": float(result.gap_amount),
        "gap_deadline": result.gap_deadline.isoformat() if result.gap_deadline else None,
        "last_snapshot_date": result.last_snapshot_date.isoformat() if result.last_snapshot_date else None,
        "snapshot_stale": extras["snapshot_stale"],
        "missing_rates": extras["missing_rates"],
        "rates_date": extras["rates_date"].isoformat() if extras["rates_date"] else None,
        "base_currency": settings.base_currency,
        "cushion": float(settings.cushion),
        "horizon_days": settings.horizon_days,
        "scenarios": {
            name: {
                "min_total": float(sc.min_total) if sc.min_total is not None else None,
                "min_date": sc.min_date.isoformat() if sc.min_date else None,
                "cushion_breach_date": sc.cushion_breach_date.isoformat() if sc.cushion_breach_date else None,
                "breakdown": {k: float(v) for k, v in sc.breakdown.items()},
            }
            for name, sc in result.scenarios.items()
        },
    }
