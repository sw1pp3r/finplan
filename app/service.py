"""Сборка входов forecast-движка из БД."""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .course import Cost, Tariff, compute_course
from .db import (
    Account, CourseConfigRow, CourseCost, CourseTariff, FxRate, InflowRow, ObligationRow,
    SettingsRow, SnapshotRow, Wish,
)
from .forecast import (
    SCENARIO_WEIGHTS, Inflow, Obligation, Snap, _derive_burn, _occurrences, build_forecast,
)
from .fx import _used_currencies

STALE_AFTER_DAYS = 10
# нормализация повтора в месячный эквивалент (52 недели / 12 месяцев)
MONTHLY_FACTOR = {"weekly": Decimal(52) / Decimal(12), "monthly": Decimal("1"), "yearly": Decimal(1) / Decimal(12)}


def upsert_snapshot(db: Session, taken_at: date, items: list) -> int:
    """items: [(account_id, Decimal)]. Повторная запись тем же днём заменяет строку счёта."""
    for account_id, amount in items:
        existing = db.scalars(
            select(SnapshotRow).where(
                SnapshotRow.taken_at == taken_at, SnapshotRow.account_id == account_id
            )
        ).all()
        for row in existing:
            db.delete(row)
        db.add(SnapshotRow(taken_at=taken_at, account_id=account_id, amount=amount))
    db.commit()
    return len(items)


def get_settings(db: Session) -> SettingsRow:
    s = db.get(SettingsRow, 1)
    if s is None:  # создаём singleton; при гонке параллельных запросов ловим дубль
        s = SettingsRow(id=1)
        db.add(s)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            s = db.get(SettingsRow, 1)
    return s


def rebase_currency(db: Session, old_base: str, new_base: str) -> None:
    """Смена базовой валюты: пересчитывает хранимые курсы в новую базу (без сети).
    Новая база становится неявной 1; старая база и прочие валюты получают курс к новой,
    исходя из последних известных курсов. Бросает ValueError, если для новой базы нет
    известного курса — иначе нечем выразить старую базу в новой. Не коммитит (коммитит вызывающий)."""
    old_base, new_base = old_base.upper(), new_base.upper()
    if new_base == old_base:
        return
    latest: dict = {}
    latest_date: dict = {}
    for r in db.scalars(select(FxRate).order_by(FxRate.rate_date.asc(), FxRate.id.asc())).all():
        latest[r.currency] = Decimal(r.rate_to_base)  # позднее перезаписывает раннее
        latest_date[r.currency] = r.rate_date         # ...вместе со своей датой
    r_new = latest.get(new_base)
    if r_new is None or r_new == 0:
        raise ValueError(f"нет курса для {new_base} — добавьте его перед сменой базы")
    today = date.today()
    for row in db.scalars(select(FxRate)).all():
        db.delete(row)
    db.flush()
    # Несём вперёд исходную дату курса (не today!), иначе теряется сигнал устаревания
    # на дашборде «курсы от {дата}» (#9). Дата старой базы = когда мы последний раз знали new_base.
    db.add(FxRate(rate_date=latest_date.get(new_base, today), currency=old_base,
                  rate_to_base=Decimal("1") / r_new))
    for cur, r_old in latest.items():
        if cur in (new_base, old_base):
            continue
        db.add(FxRate(rate_date=latest_date.get(cur, today), currency=cur,
                      rate_to_base=r_old / r_new))


def get_rates(db: Session, base_currency: str):
    """Последний известный курс по каждой валюте + дата самого свежего курса."""
    rates: dict = {base_currency: Decimal("1")}
    rates_date = None
    # тот же детерминированный тай-брейк (rate_date, id), что и rates_overview/rebase (#8)
    rows = db.scalars(select(FxRate).order_by(FxRate.rate_date.asc(), FxRate.id.asc())).all()
    for row in rows:  # более поздние перезаписывают ранние
        rates[row.currency] = Decimal(row.rate_to_base)
        if rates_date is None or row.rate_date > rates_date:
            rates_date = row.rate_date
    return rates, rates_date


def snapshots_history(db: Session):
    """История снимков: тотал по каждой дате, приведённый к базовой валюте (по возрастанию даты)."""
    settings = get_settings(db)
    rates, _ = get_rates(db, settings.base_currency)
    accounts = {a.id: a for a in db.scalars(select(Account)).all()}
    by_date: dict = {}
    for s in db.scalars(select(SnapshotRow)).all():
        acc = accounts.get(s.account_id)
        if acc is None:
            continue
        by_date[s.taken_at] = by_date.get(s.taken_at, Decimal("0")) + Decimal(s.amount) * rates.get(acc.currency, Decimal("0"))
    items = [{"date": d.isoformat(), "total": float(t)} for d, t in sorted(by_date.items())]
    return {"base_currency": settings.base_currency, "items": items}


def rates_overview(db: Session):
    """Обзор курсов для UI: последний курс по каждой валюте + какие используются без курса."""
    settings = get_settings(db)
    base = settings.base_currency
    latest: dict = {}
    for r in db.scalars(select(FxRate).order_by(FxRate.rate_date.asc(), FxRate.id.asc())).all():
        latest[r.currency] = r  # более поздняя дата перезаписывает раннюю
    used = _used_currencies(db)

    rates = []
    for cur in sorted(set(latest) | used | {base}):
        if cur == base:
            rates.append({"currency": cur, "rate_to_base": 1.0, "rate_date": None,
                          "used": cur in used, "is_base": True})
        elif cur in latest:
            r = latest[cur]
            rates.append({"currency": cur, "rate_to_base": float(r.rate_to_base),
                          "rate_date": r.rate_date.isoformat(), "used": cur in used, "is_base": False})
        else:
            rates.append({"currency": cur, "rate_to_base": None, "rate_date": None,
                          "used": cur in used, "is_base": False})
    missing = sorted(c for c in used if c != base and c not in latest)
    return {"base_currency": base, "rates": rates, "missing": missing}


def income_summary(db: Session):
    """Факты доходов (received inflows): список + суммы по направлениям и месяцам в базовой валюте."""
    settings = get_settings(db)
    rates, _ = get_rates(db, settings.base_currency)
    rows = db.scalars(
        select(InflowRow).where(InflowRow.status == "received")
        .order_by(InflowRow.expected_date.desc(), InflowRow.id.desc())
    ).all()

    items, by_direction, by_month = [], {}, {}
    for r in rows:
        rate = rates.get(r.currency, Decimal("0"))
        base = Decimal(r.amount) * rate
        direction = r.direction or "без направления"
        month = r.expected_date.strftime("%Y-%m")
        by_direction[direction] = by_direction.get(direction, Decimal("0")) + base
        by_month[month] = by_month.get(month, Decimal("0")) + base
        items.append({
            "id": r.id, "date": r.expected_date.isoformat(), "name": r.name,
            "counterparty": r.counterparty, "direction": r.direction,
            "amount": float(r.amount), "currency": r.currency, "amount_base": float(base),
        })
    # пайплайн: ожидаемые поступления по вероятностям + по месяцам + взвешенно (базовый сценарий).
    # Регулярные (recurrence != once) разворачиваются по горизонту, как в прогнозе; разовые — раз.
    today = date.today()
    horizon_end = today + timedelta(days=settings.horizon_days)
    by_prob = {"confirmed": Decimal("0"), "likely": Decimal("0"), "possible": Decimal("0")}
    exp_by_month: dict = {}
    for r in db.scalars(select(InflowRow).where(InflowRow.status == "expected")).all():
        base = Decimal(r.amount) * rates.get(r.currency, Decimal("0"))
        rec = r.recurrence or "once"
        occs = [r.expected_date] if rec == "once" else list(
            _occurrences(r.expected_date, rec, r.recurrence_end, today, horizon_end))
        for occ in occs:
            if r.probability in by_prob:
                by_prob[r.probability] += base
            month = occ.strftime("%Y-%m")
            exp_by_month[month] = exp_by_month.get(month, Decimal("0")) + base
    weights = SCENARIO_WEIGHTS["base"]
    weighted = sum((by_prob[p] * weights[p] for p in by_prob), Decimal("0"))
    expected = {
        "by_probability": {k: float(v) for k, v in by_prob.items()},
        "by_month": {k: float(v) for k, v in exp_by_month.items()},
        "total": float(sum(by_prob.values(), Decimal("0"))),
        "weighted": float(weighted),
    }

    return {
        "base_currency": settings.base_currency,
        "items": items,
        "by_direction": {k: float(v) for k, v in by_direction.items()},
        "by_month": {k: float(v) for k, v in by_month.items()},
        "total": float(sum(by_direction.values(), Decimal("0"))),
        "expected": expected,
    }


def wishes_summary(db: Session):
    """Активные хотелки: список + суммы по приоритетам в базовой валюте."""
    settings = get_settings(db)
    rates, _ = get_rates(db, settings.base_currency)
    rows = db.scalars(
        select(Wish).where(Wish.status == "active").order_by(Wish.id.desc())
    ).all()
    order = {"high": 0, "medium": 1, "low": 2}
    # ручной порядок (sort_order) — главный; приоритет и id — добивка для равных/изначальных.
    # coalesce None→0: мигрированная wishes.sort_order бывает NULL, иначе сорт роняет 500 (#20)
    rows.sort(key=lambda w: (w.sort_order if w.sort_order is not None else 0,
                             order.get(w.priority, 1), -w.id))

    items, by_priority = [], {}
    for w in rows:
        base = Decimal(w.amount) * rates.get(w.currency, Decimal("0"))
        by_priority[w.priority] = by_priority.get(w.priority, Decimal("0")) + base
        items.append({
            "id": w.id, "name": w.name, "amount": float(w.amount), "currency": w.currency,
            "amount_base": float(base), "priority": w.priority,
            "target_date": w.target_date.isoformat() if w.target_date else None,
            "category": w.category, "note": w.note,
            "image_url": w.image_url, "image_source": w.image_source, "card_size": w.card_size,
            "sort_order": w.sort_order,
        })
    return {
        "base_currency": settings.base_currency,
        "items": items,
        "by_priority": {k: float(v) for k, v in by_priority.items()},
        "total": float(sum(by_priority.values(), Decimal("0"))),
    }


def expenses_summary(db: Session, precomputed=None):
    """Месячные расходы: планируемые обязательства, нормализованные в месяц, по категориям,
    + burn в месяц, + сколько нужно зарабатывать в месяц (breakeven).
    precomputed=(result, settings) переиспользует уже посчитанный прогноз (#10)."""
    if precomputed is not None:
        result, settings = precomputed
        rates, _ = get_rates(db, settings.base_currency)
        burn_weekly = result.burn_weekly
        burn_source = result.burn_source
    else:
        settings = get_settings(db)
        rates, _ = get_rates(db, settings.base_currency)
        rows = db.scalars(select(ObligationRow)).all()
        burn_weekly, burn_source = _burn_from_db(db, settings, rates, rows)
    if precomputed is not None:
        rows = db.scalars(select(ObligationRow)).all()

    by_category: dict = {}
    one_off_total, one_off_count = Decimal("0"), 0
    for o in rows:
        if o.status != "planned":
            continue
        base = o.outstanding_amount * rates.get(o.currency, Decimal("0"))
        if o.recurrence == "once":
            one_off_total += base
            one_off_count += 1
            continue
        monthly = base * MONTHLY_FACTOR.get(o.recurrence, Decimal("1"))
        cat = o.category or "Без категории"
        by_category[cat] = by_category.get(cat, Decimal("0")) + monthly

    monthly_obligations = sum(by_category.values(), Decimal("0"))
    burn_monthly = burn_weekly * Decimal(52) / Decimal(12)
    # Когда burn ВЫВЕДЕН из снимков, он уже вобрал реальную трату по регулярным
    # обязательствам — складывать его с monthly_obligations = двойной счёт breakeven
    # (#3/#7). Берём бóльшую из величин: и не занижаем, и не дублируем. При manual/none
    # burn (нет истории) обязательства в нём не сидят → прежняя сумма.
    if burn_source == "derived":
        required = max(monthly_obligations, burn_monthly)
    else:
        required = monthly_obligations + burn_monthly
    return {
        "base_currency": settings.base_currency,
        "by_category": {k: float(v) for k, v in by_category.items()},
        "monthly_obligations": float(monthly_obligations),
        "burn_monthly": float(burn_monthly),
        "required_monthly_income": float(required),
        "one_off_total": float(one_off_total),
        "one_off_count": one_off_count,
    }


def _burn_from_db(
    db: Session,
    settings: SettingsRow,
    rates: dict,
    obligation_rows: list[ObligationRow],
) -> tuple[Decimal, str]:
    """Compute only burn rate for summaries that do not need full forecast points."""
    accounts = {a.id: a for a in db.scalars(select(Account)).all()}
    snapshots = db.scalars(select(SnapshotRow)).all()
    snap_dates = sorted({s.taken_at for s in snapshots})
    if len(snap_dates) >= 4:
        snap_totals = {
            d: sum(
                (
                    Decimal(s.amount) * rates.get(accounts[s.account_id].currency, Decimal("0"))
                    for s in snapshots
                    if s.taken_at == d and s.account_id in accounts
                ),
                Decimal("0"),
            )
            for d in snap_dates
        }
        obligations = [
            Obligation(name=o.name,
                       amount=o.outstanding_amount,
                       currency=o.currency,
                       due_date=o.due_date, recurrence=o.recurrence,
                       recurrence_end=o.recurrence_end, status=o.status)
            for o in obligation_rows
        ]
        inflows = [
            Inflow(name=i.name, amount=Decimal(i.amount), currency=i.currency,
                   expected_date=i.expected_date, probability=i.probability, status=i.status,
                   recurrence=i.recurrence or "once", recurrence_end=i.recurrence_end)
            for i in db.scalars(select(InflowRow)).all()
        ]
        return _derive_burn(snap_totals, obligations, inflows, rates), "derived"
    if settings.manual_burn_weekly is not None:
        return Decimal(settings.manual_burn_weekly), "manual"
    return Decimal("0"), "none"


def get_course_config(db: Session) -> CourseConfigRow:
    c = db.get(CourseConfigRow, 1)
    if c is None:  # singleton; при гонке параллельных запросов ловим дубль
        c = CourseConfigRow(id=1)
        db.add(c)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            c = db.get(CourseConfigRow, 1)
    return c


def course_summary(db: Session):
    """Декомпозиция курса: тарифы × ученики − расходы → прибыль/мес,
    и как она ложится на breakeven (сколько нужно зарабатывать в месяц). Прогноз не трогаем."""
    settings = get_settings(db)
    rates, _ = get_rates(db, settings.base_currency)
    cfg = get_course_config(db)
    rows = db.scalars(
        select(CourseTariff).order_by(CourseTariff.sort_order, CourseTariff.id)
    ).all()
    cost_rows = db.scalars(
        select(CourseCost).order_by(CourseCost.sort_order, CourseCost.id)
    ).all()

    res = compute_course(
        tariffs=[Tariff(name=r.name, price=Decimal(r.price), currency=r.currency, students=r.students)
                 for r in rows],
        cohort_months=cfg.cohort_months,
        costs=[Cost(name=c.name, amount=Decimal(c.amount), currency=c.currency, kind=c.kind)
               for c in cost_rows],
        rates=rates,
    )
    # реальные расходы для сравнения: месячная планка, разовые предстоящие, дефицит до подушки.
    # Считаем прогноз ОДИН раз и переиспользуем для expenses и gap (#10 — было два полных билда).
    forecast, fc_settings, _ = forecast_from_db(db)
    exp = expenses_summary(db, precomputed=(forecast, fc_settings))
    required = exp["required_monthly_income"]

    tariffs = [{
        "id": r.id, "name": r.name, "price": float(r.price), "currency": r.currency,
        "students": r.students,
        "gross_base": float(Decimal(r.price) * rates.get(r.currency, Decimal("0")) * r.students),
    } for r in rows]
    costs = [{
        "id": c.id, "name": c.name, "amount": float(c.amount), "currency": c.currency,
        "kind": c.kind,
        "monthly_base": float(Decimal(c.amount) * rates.get(c.currency, Decimal("0"))
                              * (res.students_total if c.kind == "per_student" else 1)
                              / (max(1, cfg.cohort_months) if c.kind == "per_student" else 1)),
    } for c in cost_rows]
    # валюты без курса (тарифы + расходы) — считаются как 0, репортим как на дашборде
    cur_used = {r.currency for r in rows} | {c.currency for c in cost_rows}
    missing_rates = sorted(c for c in cur_used if c not in rates)

    return {
        "base_currency": settings.base_currency,
        "cohort_months": cfg.cohort_months,
        "students_total": res.students_total,
        "gross_per_cohort": float(res.gross_per_cohort),
        "gross_monthly": float(res.gross_monthly),
        "fixed_monthly": float(res.fixed_monthly),
        "variable_monthly": float(res.variable_monthly),
        "cost_monthly": float(res.cost_monthly),
        "net_monthly": float(res.net_monthly),
        "net_per_cohort": float(res.net_per_cohort),
        "required_monthly_income": required,
        "net_vs_required": float(res.net_monthly) - required,
        "one_off_total": exp["one_off_total"],
        "one_off_count": exp["one_off_count"],
        "gap_amount": float(forecast.gap_amount),
        "tariffs": tariffs,
        "costs": costs,
        "missing_rates": missing_rates,
    }


def service_summary_payload(db: Session, service_id: int):
    """Юнит-экономика одного сервиса + сравнение с breakeven. Прогноз не трогаем."""
    from .db import Service, ServiceCost, ServiceTariff, ServiceTariffUsage
    from .services_econ import SvcCost, SvcTariff, compute_service

    svc = db.get(Service, service_id)
    if svc is None:
        return None
    settings = get_settings(db)
    rates, _ = get_rates(db, settings.base_currency)

    cost_rows = db.scalars(select(ServiceCost).where(ServiceCost.service_id == service_id)
                           .order_by(ServiceCost.sort_order, ServiceCost.id)).all()
    tariff_rows = db.scalars(select(ServiceTariff).where(ServiceTariff.service_id == service_id)
                             .order_by(ServiceTariff.sort_order, ServiceTariff.id)).all()
    tariff_ids = [t.id for t in tariff_rows]
    usage_rows = db.scalars(select(ServiceTariffUsage)
                            .where(ServiceTariffUsage.tariff_id.in_(tariff_ids))).all() if tariff_ids else []
    usage_by_tariff: dict[int, dict[int, Decimal]] = {}
    for u in usage_rows:
        usage_by_tariff.setdefault(u.tariff_id, {})[u.cost_id] = Decimal(u.units_per_client_month)

    res = compute_service(
        tariffs=[SvcTariff(t.name, Decimal(t.price), t.currency, t.clients, t.is_byo,
                           usage_by_tariff.get(t.id, {})) for t in tariff_rows],
        costs=[SvcCost(c.id, c.name, Decimal(c.amount), c.currency, c.kind, c.unit_size)
               for c in cost_rows],
        rates=rates,
    )

    forecast, fc_settings, _ = forecast_from_db(db)
    exp = expenses_summary(db, precomputed=(forecast, fc_settings))
    required = exp["required_monthly_income"]

    cur_used = {t.currency for t in tariff_rows} | {c.currency for c in cost_rows}
    missing_rates = sorted(c for c in cur_used if c not in rates)

    tariffs = []
    for row, bt in zip(tariff_rows, res.by_tariff):
        tariffs.append({
            "id": row.id, "name": row.name, "price": float(row.price),
            "currency": row.currency, "clients": row.clients, "is_byo": row.is_byo,
            "usage": {cid: float(u) for cid, u in usage_by_tariff.get(row.id, {}).items()},
            "mrr_base": float(bt["mrr_base"]), "var_cost_base": float(bt["var_cost_base"]),
            "net_per_client": float(bt["net_per_client"]),
        })
    costs = [{
        "id": c.id, "name": c.name, "amount": float(c.amount), "currency": c.currency,
        "kind": c.kind, "unit_label": c.unit_label, "unit_size": c.unit_size,
    } for c in cost_rows]

    return {
        "service": {"id": svc.id, "name": svc.name, "note": svc.note},
        "base_currency": settings.base_currency,
        "mrr": float(res.mrr),
        "fixed_monthly": float(res.fixed_monthly),
        "per_client_monthly": float(res.per_client_monthly),
        "per_unit_monthly": float(res.per_unit_monthly),
        "cogs_monthly": float(res.cogs_monthly),
        "net_monthly": float(res.net_monthly),
        "margin_pct": float(res.margin_pct) if res.margin_pct is not None else None,
        "clients_total": res.clients_total,
        "required_monthly_income": required,
        "net_vs_required": float(res.net_monthly) - required,
        "missing_rates": missing_rates,
        "tariffs": tariffs,
        "costs": costs,
    }


def forecast_from_db(db: Session, today: date | None = None, horizon_days: int | None = None):
    today = today or date.today()
    settings = get_settings(db)
    rates, rates_date = get_rates(db, settings.base_currency)

    accounts = {a.id: a for a in db.scalars(select(Account)).all()}

    snapshots = [
        Snap(taken_at=s.taken_at, account=accounts[s.account_id].name,
             currency=accounts[s.account_id].currency, amount=Decimal(s.amount))
        for s in db.scalars(select(SnapshotRow)).all()
        if s.account_id in accounts
    ]
    obligations = [
        Obligation(name=o.name,
                   amount=o.outstanding_amount,
                   currency=o.currency,
                   due_date=o.due_date, recurrence=o.recurrence,
                   recurrence_end=o.recurrence_end, status=o.status)
        for o in db.scalars(select(ObligationRow)).all()
    ]
    inflows = [
        Inflow(name=i.name, amount=Decimal(i.amount), currency=i.currency,
               expected_date=i.expected_date, probability=i.probability, status=i.status,
               recurrence=i.recurrence or "once", recurrence_end=i.recurrence_end)
        for i in db.scalars(select(InflowRow)).all()
    ]

    # валюты без курса: не роняем прогноз, считаем по нулю и репортим
    used = {s.currency for s in snapshots} | {o.currency for o in obligations} | {i.currency for i in inflows}
    missing_rates = sorted(c for c in used if c not in rates)
    for c in missing_rates:
        rates[c] = Decimal("0")

    result = build_forecast(
        today=today,
        horizon_days=horizon_days if horizon_days is not None else settings.horizon_days,
        rates=rates,
        snapshots=snapshots,
        obligations=obligations,
        inflows=inflows,
        cushion=Decimal(settings.cushion),
        manual_burn_weekly=Decimal(settings.manual_burn_weekly) if settings.manual_burn_weekly is not None else None,
    )

    stale = (
        result.last_snapshot_date is None
        or (today - result.last_snapshot_date).days > STALE_AFTER_DAYS
    )
    return result, settings, {"missing_rates": missing_rates, "rates_date": rates_date, "snapshot_stale": stale}
