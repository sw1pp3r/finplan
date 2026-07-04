"""REST API: ТЗ §7. JSON, Bearer-токен (если настроен)."""
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field, StringConstraints

# Денежные суммы строго положительны: отрицательное обязательство = фантомный доход (#12).
Amount = Annotated[float, Field(gt=0)]
NonNegativeAmount = Annotated[float, Field(ge=0)]
NonNegativeInt = Annotated[int, Field(ge=0)]
# Длины строк держим в паритете с колонками БД (SQLite не enforce-ит, Postgres рубит → 500).
# Отдаём 422 на обоих бэкендах вместо StringDataRightTruncation (#13/#18/#19).
Currency = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=12)]
Name80 = Annotated[str, Field(max_length=80)]
Name120 = Annotated[str, Field(max_length=120)]
Note = Annotated[str, Field(max_length=300)]
Ref80 = Annotated[str, Field(max_length=80)]
ImageUrl = Annotated[str, Field(max_length=500)]
ImageSource = Annotated[str, Field(max_length=40)]
# Горизонт планирования — тот же диапазон, что и Query у /forecast (#11).
HorizonDays = Annotated[int, Field(ge=7, le=730)]
CourseMonths = Annotated[int, Field(ge=1)]
AccountType = Literal["bank", "cash", "broker", "crypto"]
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import images
from .db import (
    Account, Category, CourseConfigRow, CourseCost, CourseTariff, Direction, FxRate,
    InflowRow, ObligationRow, Service, ServiceCost, ServiceTariff, ServiceTariffUsage,
    SnapshotRow, Wish,
)
from .forecast import next_period
from .service import (
    course_summary, expenses_summary, forecast_from_db, get_course_config, get_settings,
    income_summary, rates_overview, rebase_currency, service_summary_payload,
    snapshots_history, upsert_snapshot, wishes_summary,
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
    # Демо: заголовок X-Demo ИЛИ ?demo=1 → отдельная in-memory демо-БД (реальную не трогаем).
    # Квери-параметр — фолбэк для прокси/CDN, которые режут кастомные заголовки (напр. Railway).
    want_demo = request.headers.get("X-Demo") == "1" or request.query_params.get("demo") == "1"
    if demo is not None and want_demo:
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
    name: Name80
    currency: Currency
    type: AccountType = "bank"
    sort_order: int = 0


class AccountPatch(BaseModel):
    name: Name80 | None = None
    currency: Currency | None = None
    type: AccountType | None = None
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
CourseCostKind = Literal["monthly", "per_student"]
ServiceCostKind = Literal["fixed", "per_client", "per_unit"]
UnitLabel = Annotated[str, Field(max_length=40)]
UnitSize = Annotated[int, Field(ge=1)]


def _reject_nulls(data: dict, fields: set[str]):
    """PATCH принимает explicit null только для nullable-полей; non-null ловим до БД."""
    for field in fields:
        if field in data and data[field] is None:
            raise HTTPException(status_code=422, detail=f"{field} must not be null")


class ObligationIn(BaseModel):
    name: Name120
    amount: Amount
    currency: Currency
    due_date: date
    recurrence: Recurrence = "once"
    recurrence_end: date | None = None
    category: Ref80 | None = None
    note: Note | None = None


class ObligationPatch(BaseModel):
    name: Name120 | None = None
    amount: Amount | None = None
    currency: Currency | None = None
    due_date: date | None = None
    recurrence: Recurrence | None = None
    recurrence_end: date | None = None
    status: ObStatus | None = None
    category: Ref80 | None = None
    note: Note | None = None


class RefIn(BaseModel):
    name: Ref80


class WishIn(BaseModel):
    name: Name120
    amount: Amount
    currency: Currency
    priority: WishPriority = "medium"
    target_date: date | None = None
    category: Ref80 | None = None
    note: Note | None = None
    image_url: ImageUrl | None = None
    image_source: ImageSource | None = None


class WishPatch(BaseModel):
    name: Name120 | None = None
    amount: Amount | None = None
    currency: Currency | None = None
    priority: WishPriority | None = None
    target_date: date | None = None
    category: Ref80 | None = None
    status: WishStatus | None = None
    note: Note | None = None
    image_url: ImageUrl | None = None
    image_source: ImageSource | None = None
    card_size: CardSize | None = None  # small | square | tall | wide | large | auto


class WishImageUrl(BaseModel):
    url: str


class WishReorder(BaseModel):
    ids: list[int]  # желания в желаемом порядке (первое = sort_order 0)


class InflowIn(BaseModel):
    name: Name120 | None = None
    amount: Amount
    currency: Currency
    expected_date: date
    probability: Probability = "confirmed"
    recurrence: Recurrence = "once"
    recurrence_end: date | None = None
    counterparty: Name120 | None = None
    direction: Ref80 | None = None
    note: Note | None = None


class InflowPatch(BaseModel):
    name: Name120 | None = None
    amount: Amount | None = None
    currency: Currency | None = None
    expected_date: date | None = None
    probability: Probability | None = None
    recurrence: Recurrence | None = None
    recurrence_end: date | None = None
    status: InflowStatus | None = None
    counterparty: Name120 | None = None
    direction: Ref80 | None = None
    note: Note | None = None


class IncomeIn(BaseModel):
    """Быстрая запись факта: «заработал X от Y по направлению Z»."""
    amount: Amount
    currency: Currency
    counterparty: Name120 | None = None
    direction: Ref80 | None = None
    name: Name120 | None = None
    received_date: date | None = None


class SettingsPatch(BaseModel):
    base_currency: Currency | None = None
    cushion: NonNegativeAmount | None = None
    horizon_days: HorizonDays | None = None
    manual_burn_weekly: NonNegativeAmount | None = None
    display_name: Name120 | None = None


class FxIn(BaseModel):
    currency: Currency
    rate_to_base: Amount  # > 0: нулевой/отрицательный курс ломает конвертацию (#15)
    rate_date: date | None = None


class CourseTariffIn(BaseModel):
    name: Name80
    price: Amount
    currency: Currency
    students: NonNegativeInt = 0
    sort_order: int = 0


class CourseTariffPatch(BaseModel):
    name: Name80 | None = None
    price: Amount | None = None
    currency: Currency | None = None
    students: NonNegativeInt | None = None
    sort_order: int | None = None


class CourseCostIn(BaseModel):
    name: Name80
    amount: Amount
    currency: Currency
    kind: CourseCostKind = "monthly"  # monthly | per_student
    sort_order: int = 0


class CourseCostPatch(BaseModel):
    name: Name80 | None = None
    amount: Amount | None = None
    currency: Currency | None = None
    kind: CourseCostKind | None = None
    sort_order: int | None = None


class CourseConfigPatch(BaseModel):
    cohort_months: CourseMonths | None = None


class ServiceIn(BaseModel):
    name: Name80
    note: Note | None = None
    preset: str | None = None


class ServicePatch(BaseModel):
    name: Name80 | None = None
    note: Note | None = None


class ServiceTariffIn(BaseModel):
    name: Name80
    price: Amount
    currency: Currency
    clients: NonNegativeInt = 0
    is_byo: bool = False
    sort_order: int = 0
    usage: dict[int, float] | None = None  # cost_id -> юнитов/клиента/мес


class ServiceTariffPatch(BaseModel):
    name: Name80 | None = None
    price: Amount | None = None
    currency: Currency | None = None
    clients: NonNegativeInt | None = None
    is_byo: bool | None = None
    sort_order: int | None = None
    usage: dict[int, float] | None = None


class ServiceCostIn(BaseModel):
    name: Name80
    amount: Amount
    currency: Currency
    kind: ServiceCostKind = "fixed"
    unit_label: UnitLabel | None = None
    unit_size: UnitSize = 1
    sort_order: int = 0


class ServiceCostPatch(BaseModel):
    name: Name80 | None = None
    amount: Amount | None = None
    currency: Currency | None = None
    kind: ServiceCostKind | None = None
    unit_label: UnitLabel | None = None
    unit_size: UnitSize | None = None
    sort_order: int | None = None


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
        raise HTTPException(404, f"unknown account {acc_id}")
    # exclude_unset (не exclude_none): явный null очищает nullable-поле, а не молча отбрасывается (#14)
    data = body.model_dump(exclude_unset=True)
    _reject_nulls(data, {"name", "currency", "type", "is_active", "sort_order"})
    for field, value in data.items():
        setattr(a, field, value.upper() if field == "currency" and value is not None else value)
    db.commit()
    return {"ok": True}


@router.delete("/accounts/{acc_id}", dependencies=[Depends(require_token)])
def delete_account(acc_id: int, db: Session = Depends(get_db)):
    a = db.get(Account, acc_id)
    if a is None:
        raise HTTPException(404, f"unknown account {acc_id}")
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
    # дедуп по account_id (последний выигрывает) — upsert всё равно схлопывает дубли,
    # поэтому возвращаемый count должен совпадать с реально сохранёнными строками (#17)
    deduped = {i.account_id: dec(i.amount) for i in body.items}
    n = upsert_snapshot(db, taken_at, list(deduped.items()))
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
        raise HTTPException(404, f"unknown obligation {ob_id}")
    data = body.model_dump(exclude_unset=True)  # явный null очищает nullable-поле (#14)
    _reject_nulls(data, {"name", "amount", "currency", "due_date", "recurrence", "status"})
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
        if field == "amount" and value is not None:
            value = dec(value)
        if field == "currency" and value is not None:
            value = value.upper()
        setattr(o, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/obligations/{ob_id}", dependencies=[Depends(require_token)])
def delete_obligation(ob_id: int, db: Session = Depends(get_db)):
    o = db.get(ObligationRow, ob_id)
    if o is None:
        raise HTTPException(404, f"unknown obligation {ob_id}")
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
         "recurrence": i.recurrence or "once",
         "recurrence_end": i.recurrence_end.isoformat() if i.recurrence_end else None,
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
        recurrence=body.recurrence, recurrence_end=body.recurrence_end,
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
        raise HTTPException(404, f"unknown course tariff {tariff_id}")
    data = body.model_dump(exclude_unset=True)
    _reject_nulls(data, {"name", "price", "currency", "students", "sort_order"})
    for field, value in data.items():
        if field == "price" and value is not None:
            value = dec(value)
        if field == "currency" and value is not None:
            value = value.upper()
        setattr(t, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/course/tariffs/{tariff_id}", dependencies=[Depends(require_token)])
def delete_course_tariff(tariff_id: int, db: Session = Depends(get_db)):
    t = db.get(CourseTariff, tariff_id)
    if t is None:
        raise HTTPException(404, f"unknown course tariff {tariff_id}")
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
        raise HTTPException(404, f"unknown course cost {cost_id}")
    data = body.model_dump(exclude_unset=True)
    _reject_nulls(data, {"name", "amount", "currency", "kind", "sort_order"})
    for field, value in data.items():
        if field == "amount" and value is not None:
            value = dec(value)
        if field == "currency" and value is not None:
            value = value.upper()
        setattr(c, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/course/costs/{cost_id}", dependencies=[Depends(require_token)])
def delete_course_cost(cost_id: int, db: Session = Depends(get_db)):
    c = db.get(CourseCost, cost_id)
    if c is None:
        raise HTTPException(404, f"unknown course cost {cost_id}")
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.patch("/course/config", dependencies=[Depends(require_token)])
def patch_course_config(body: CourseConfigPatch, db: Session = Depends(get_db)):
    cfg = get_course_config(db)
    data = body.model_dump(exclude_unset=True)
    _reject_nulls(data, {"cohort_months"})
    if "cohort_months" in data:
        cfg.cohort_months = data["cohort_months"]
    db.commit()
    return {"ok": True}


# ---------- services: песочница юнит-экономики ----------

def _get_service(db: Session, service_id: int) -> Service:
    svc = db.get(Service, service_id)
    if svc is None:
        raise HTTPException(404, f"unknown service {service_id}")
    return svc


def _set_usage(db: Session, tariff: ServiceTariff, usage: dict[int, float]):
    """Полная замена матрицы потребления тарифа; cost_id валидируем по сервису."""
    valid_ids = set(db.scalars(select(ServiceCost.id).where(
        ServiceCost.service_id == tariff.service_id)).all())
    unknown = set(usage) - valid_ids
    if unknown:
        raise HTTPException(422, f"unknown cost ids for usage: {sorted(unknown)}")
    # Validate all units BEFORE deleting existing rows
    for cost_id, units in usage.items():
        if units < 0:
            raise HTTPException(422, "usage units must be >= 0")
    # Delete existing usage only after validation passes
    for row in db.scalars(select(ServiceTariffUsage).where(
            ServiceTariffUsage.tariff_id == tariff.id)).all():
        db.delete(row)
    # Add new usage rows
    for cost_id, units in usage.items():
        db.add(ServiceTariffUsage(tariff_id=tariff.id, cost_id=cost_id,
                                  units_per_client_month=dec(units)))


@router.get("/services", dependencies=[Depends(require_token)])
def list_services(db: Session = Depends(get_db)):
    rows = db.scalars(select(Service).order_by(Service.id)).all()
    return [{"id": s.id, "name": s.name, "note": s.note} for s in rows]


@router.post("/services", status_code=201, dependencies=[Depends(require_token)])
def create_service(body: ServiceIn, db: Session = Depends(get_db)):
    if body.preset is not None:
        from .service_presets import PRESETS, apply_preset
        if body.preset not in PRESETS:
            raise HTTPException(404, f"unknown preset {body.preset}")
        svc = apply_preset(db, body.preset)
        if body.name:
            svc.name = body.name
        if body.note is not None:
            svc.note = body.note
    else:
        svc = Service(name=body.name, note=body.note)
        db.add(svc)
    db.commit()
    return {"id": svc.id}


@router.patch("/services/{service_id}", dependencies=[Depends(require_token)])
def patch_service(service_id: int, body: ServicePatch, db: Session = Depends(get_db)):
    svc = _get_service(db, service_id)
    data = body.model_dump(exclude_unset=True)
    _reject_nulls(data, {"name"})
    for field, value in data.items():
        setattr(svc, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/services/{service_id}", dependencies=[Depends(require_token)])
def delete_service(service_id: int, db: Session = Depends(get_db)):
    svc = _get_service(db, service_id)
    tariff_ids = db.scalars(select(ServiceTariff.id).where(
        ServiceTariff.service_id == service_id)).all()
    if tariff_ids:
        for u in db.scalars(select(ServiceTariffUsage).where(
                ServiceTariffUsage.tariff_id.in_(tariff_ids))).all():
            db.delete(u)
    for t in db.scalars(select(ServiceTariff).where(ServiceTariff.service_id == service_id)).all():
        db.delete(t)
    for c in db.scalars(select(ServiceCost).where(ServiceCost.service_id == service_id)).all():
        db.delete(c)
    db.delete(svc)
    db.commit()
    return {"ok": True}


@router.get("/services/{service_id}/summary", dependencies=[Depends(require_token)])
def service_summary(service_id: int, db: Session = Depends(get_db)):
    payload = service_summary_payload(db, service_id)
    if payload is None:
        raise HTTPException(404, f"unknown service {service_id}")
    return payload


@router.post("/services/{service_id}/tariffs", status_code=201, dependencies=[Depends(require_token)])
def create_service_tariff(service_id: int, body: ServiceTariffIn, db: Session = Depends(get_db)):
    _get_service(db, service_id)
    t = ServiceTariff(service_id=service_id, name=body.name, price=dec(body.price),
                      currency=body.currency.upper(), clients=body.clients,
                      is_byo=body.is_byo, sort_order=body.sort_order)
    db.add(t)
    db.flush()
    if body.usage is not None:
        _set_usage(db, t, body.usage)
    db.commit()
    return {"id": t.id}


@router.patch("/services/{service_id}/tariffs/{tariff_id}", dependencies=[Depends(require_token)])
def patch_service_tariff(service_id: int, tariff_id: int, body: ServiceTariffPatch,
                         db: Session = Depends(get_db)):
    t = db.get(ServiceTariff, tariff_id)
    if t is None or t.service_id != service_id:
        raise HTTPException(404, f"unknown service tariff {tariff_id}")
    data = body.model_dump(exclude_unset=True)
    usage = data.pop("usage", None)
    _reject_nulls(data, {"name", "price", "currency", "clients", "is_byo", "sort_order"})
    for field, value in data.items():
        if field == "price" and value is not None:
            value = dec(value)
        if field == "currency" and value is not None:
            value = value.upper()
        setattr(t, field, value)
    if usage is not None:
        _set_usage(db, t, usage)
    db.commit()
    return {"ok": True}


@router.delete("/services/{service_id}/tariffs/{tariff_id}", dependencies=[Depends(require_token)])
def delete_service_tariff(service_id: int, tariff_id: int, db: Session = Depends(get_db)):
    t = db.get(ServiceTariff, tariff_id)
    if t is None or t.service_id != service_id:
        raise HTTPException(404, f"unknown service tariff {tariff_id}")
    for u in db.scalars(select(ServiceTariffUsage).where(
            ServiceTariffUsage.tariff_id == tariff_id)).all():
        db.delete(u)
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/services/{service_id}/costs", status_code=201, dependencies=[Depends(require_token)])
def create_service_cost(service_id: int, body: ServiceCostIn, db: Session = Depends(get_db)):
    _get_service(db, service_id)
    c = ServiceCost(service_id=service_id, name=body.name, amount=dec(body.amount),
                    currency=body.currency.upper(), kind=body.kind,
                    unit_label=body.unit_label, unit_size=body.unit_size,
                    sort_order=body.sort_order)
    db.add(c)
    db.commit()
    return {"id": c.id}


@router.patch("/services/{service_id}/costs/{cost_id}", dependencies=[Depends(require_token)])
def patch_service_cost(service_id: int, cost_id: int, body: ServiceCostPatch,
                       db: Session = Depends(get_db)):
    c = db.get(ServiceCost, cost_id)
    if c is None or c.service_id != service_id:
        raise HTTPException(404, f"unknown service cost {cost_id}")
    data = body.model_dump(exclude_unset=True)
    _reject_nulls(data, {"name", "amount", "currency", "kind", "unit_size", "sort_order"})
    for field, value in data.items():
        if field == "amount" and value is not None:
            value = dec(value)
        if field == "currency" and value is not None:
            value = value.upper()
        setattr(c, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/services/{service_id}/costs/{cost_id}", dependencies=[Depends(require_token)])
def delete_service_cost(service_id: int, cost_id: int, db: Session = Depends(get_db)):
    c = db.get(ServiceCost, cost_id)
    if c is None or c.service_id != service_id:
        raise HTTPException(404, f"unknown service cost {cost_id}")
    for u in db.scalars(select(ServiceTariffUsage).where(
            ServiceTariffUsage.cost_id == cost_id)).all():
        db.delete(u)
    db.delete(c)
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
            raise HTTPException(404, f"unknown {prefix} {ref_id}")
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


@router.post("/wishes/reorder", dependencies=[Depends(require_token)])
def reorder_wishes(body: WishReorder, db: Session = Depends(get_db)):
    """Ручной порядок на Доске: проставляет sort_order = позиция в присланном списке."""
    for position, wid in enumerate(body.ids):
        w = db.get(Wish, wid)
        if w is not None:
            w.sort_order = position
    db.commit()
    return {"ok": True}


@router.patch("/wishes/{wish_id}", dependencies=[Depends(require_token)])
def patch_wish(wish_id: int, body: WishPatch, db: Session = Depends(get_db)):
    w = db.get(Wish, wish_id)
    if w is None:
        raise HTTPException(404, f"unknown wish {wish_id}")
    data = body.model_dump(exclude_unset=True)
    _reject_nulls(data, {"name", "amount", "currency", "priority", "status"})
    for field, value in data.items():
        if field == "amount" and value is not None:
            value = dec(value)
        if field == "currency" and value is not None:
            value = value.upper()
        setattr(w, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/wishes/{wish_id}", dependencies=[Depends(require_token)])
def delete_wish(wish_id: int, db: Session = Depends(get_db)):
    w = db.get(Wish, wish_id)
    if w is None:
        raise HTTPException(404, f"unknown wish {wish_id}")
    db.delete(w)
    db.commit()
    return {"ok": True}


@router.post("/wishes/{wish_id}/promote", status_code=201, dependencies=[Depends(require_token)])
def promote_wish(wish_id: int, db: Session = Depends(get_db)):
    """Хотелка → обязательство (попадает в прогноз), сама помечается купленной."""
    w = db.get(Wish, wish_id)
    if w is None:
        raise HTTPException(404, f"unknown wish {wish_id}")
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
        raise HTTPException(404, f"unknown wish {wish_id}")
    if not images.is_safe_remote_url(body.url):
        raise HTTPException(400, "unsafe url")
    data = images.fetch_bytes(body.url)
    if not data:
        return {"ok": False, "image_url": None, "image_source": None}
    # фетч-ответ может быть не картинкой (внутренний JSON/HTML при SSRF) — не храним и не отдаём (#28/#29)
    if not images.is_real_image(data):
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
        raise HTTPException(404, f"unknown wish {wish_id}")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "not an image")
    data = await file.read()
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "empty or too large (>15MB)")
    # content_type клиент-контролируем — проверяем сами магические байты (#29)
    if not images.is_real_image(data):
        raise HTTPException(400, "not a decodable image")
    fname = images.save_wish_image(request.app.state.image_dir, wish_id, data)
    w.image_url = f"/wish-images/{fname}"
    w.image_source = "upload"
    db.commit()
    return {"ok": True, "image_url": w.image_url, "image_source": "upload"}


@router.patch("/inflows/{inf_id}", dependencies=[Depends(require_token)])
def patch_inflow(inf_id: int, body: InflowPatch, db: Session = Depends(get_db)):
    i = db.get(InflowRow, inf_id)
    if i is None:
        raise HTTPException(404, f"unknown inflow {inf_id}")
    data = body.model_dump(exclude_unset=True)
    _reject_nulls(data, {"name", "amount", "currency", "expected_date", "probability", "recurrence", "status"})
    for field, value in data.items():
        if field == "amount" and value is not None:
            value = dec(value)
        if field == "currency" and value is not None:
            value = value.upper()
        setattr(i, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/inflows/{inf_id}", dependencies=[Depends(require_token)])
def delete_inflow(inf_id: int, db: Session = Depends(get_db)):
    i = db.get(InflowRow, inf_id)
    if i is None:
        raise HTTPException(404, f"unknown inflow {inf_id}")
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
        "display_name": s.display_name,
    }


@router.patch("/settings", dependencies=[Depends(require_token)])
def patch_settings(body: SettingsPatch, db: Session = Depends(get_db)):
    s = get_settings(db)
    data = body.model_dump(exclude_unset=True)  # явный null очищает поле (#14)
    _reject_nulls(data, {"base_currency", "cushion", "horizon_days"})
    if data.get("base_currency"):
        new_base = data["base_currency"].upper()
        if new_base != s.base_currency:
            try:
                rebase_currency(db, s.base_currency, new_base)  # пересчёт курсов в новую базу
            except ValueError as e:
                raise HTTPException(400, str(e))
            s.base_currency = new_base
    if data.get("cushion") is not None:
        s.cushion = dec(data["cushion"])
    if data.get("horizon_days") is not None:
        s.horizon_days = data["horizon_days"]  # диапазон 7..730 проверяет схема (#11)
    if "manual_burn_weekly" in data:
        v = data["manual_burn_weekly"]
        s.manual_burn_weekly = dec(v) if v is not None else None  # null → авто-burn
    if "display_name" in data:
        name = (data["display_name"] or "").strip()
        s.display_name = name or None
    db.commit()
    return {"ok": True}


@router.get("/rates", dependencies=[Depends(require_token)])
def list_rates(db: Session = Depends(get_db)):
    return rates_overview(db)


@router.post("/fx", status_code=201, dependencies=[Depends(require_token)])
def add_fx(body: FxIn, db: Session = Depends(get_db)):
    rate_date = body.rate_date or date.today()
    cur = body.currency.strip().upper()
    if not cur:  # пробельная валюта = призрачная строка в /rates (#15)
        raise HTTPException(422, "currency must not be blank")
    # upsert: ручной курс заменяет курс того же дня (в т.ч. авто-фетч)
    for old in db.scalars(select(FxRate).where(FxRate.rate_date == rate_date, FxRate.currency == cur)).all():
        db.delete(old)
    db.add(FxRate(rate_date=rate_date, currency=cur, rate_to_base=dec(body.rate_to_base)))
    db.commit()
    return {"ok": True}


@router.post("/fx/refresh", dependencies=[Depends(require_token)])
def refresh_fx(request: Request, currency: str | None = None):
    # currency — опц. валюта, для которой нужен курс прямо сейчас (новая базовая, ещё не
    # «используемая»). Фронт дёргает это перед сменой базы, чтобы не просить курс вручную.
    from .fx import fetch_and_store
    extra = {currency.strip().upper()} if currency and currency.strip() else None
    return {"written": fetch_and_store(request.app, extra=extra)}


# ---------- forecast / summary ----------

@router.get("/forecast", dependencies=[Depends(require_token)])
def forecast(
    db: Session = Depends(get_db),
    horizon: int | None = Query(None, ge=7, le=730),
):
    # дашборд-дропдаун периода передаёт горизонт; без параметра — настройка по умолчанию
    result, settings, _ = forecast_from_db(db, horizon_days=horizon)
    return {
        "cushion": float(settings.cushion),
        "scenarios": {
            name: [[d.isoformat(), float(total)] for d, total in sc.points]
            for name, sc in result.scenarios.items()
        },
    }


@router.get("/summary", dependencies=[Depends(require_token)])
def summary(
    db: Session = Depends(get_db),
    horizon: int | None = Query(None, ge=7, le=730),
):
    # Дашборд-дропдаун периода передаёт горизонт И сюда — иначе карточки (запас/min/gap)
    # считаются на фикс. 180д и противоречат графику /forecast?horizon (#1/#22).
    result, settings, extras = forecast_from_db(db, horizon_days=horizon)
    used_horizon = horizon if horizon is not None else settings.horizon_days
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
        "horizon_days": used_horizon,
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
