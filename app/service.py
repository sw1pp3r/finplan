"""Сборка входов forecast-движка из БД."""
from datetime import date, timedelta
from decimal import ROUND_CEILING, Decimal

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
    """Активные хотелки + отдельная датированная история исполненного."""
    settings = get_settings(db)
    rates, _ = get_rates(db, settings.base_currency)
    rows = db.scalars(
        select(Wish).where(Wish.status == "active").order_by(Wish.id.desc())
    ).all()
    completed_rows = db.scalars(
        select(Wish)
        .where(Wish.status == "completed")
        .order_by(Wish.completed_at.desc(), Wish.id.desc())
    ).all()
    order = {"high": 0, "medium": 1, "low": 2}
    # ручной порядок (sort_order) — главный; приоритет и id — добивка для равных/изначальных.
    # coalesce None→0: мигрированная wishes.sort_order бывает NULL, иначе сорт роняет 500 (#20)
    rows.sort(key=lambda w: (w.sort_order if w.sort_order is not None else 0,
                             order.get(w.priority, 1), -w.id))

    def payload(w: Wish):
        base = Decimal(w.amount) * rates.get(w.currency, Decimal("0"))
        return {
            "id": w.id, "name": w.name, "amount": float(w.amount), "currency": w.currency,
            "amount_base": float(base), "priority": w.priority,
            "target_date": w.target_date.isoformat() if w.target_date else None,
            "category": w.category, "note": w.note,
            "image_url": w.image_url, "image_source": w.image_source, "card_size": w.card_size,
            "sort_order": w.sort_order,
            "status": w.status,
            "completed_at": w.completed_at.isoformat() if w.completed_at else None,
        }

    items, by_priority = [], {}
    for w in rows:
        item = payload(w)
        base = Decimal(w.amount) * rates.get(w.currency, Decimal("0"))
        by_priority[w.priority] = by_priority.get(w.priority, Decimal("0")) + base
        items.append(item)
    return {
        "base_currency": settings.base_currency,
        "items": items,
        "completed_items": [payload(w) for w in completed_rows],
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


_TW_DRIVER_FIELDS = (
    "instagram_accounts", "instagram_refreshes_per_month", "instagram_credits_per_refresh",
    "instagram_results_per_refresh", "manual_instagram_full_collections",
    "instagram_radar_runs", "instagram_credits_per_radar_run", "instagram_transcripts",
    "instagram_published_videos", "tiktok_accounts", "tiktok_refreshes_per_month",
    "tiktok_credits_per_refresh", "manual_tiktok_full_collections",
    "tiktok_discovery_runs", "tiktok_credits_per_discovery_run", "tiktok_transcripts",
    "tiktok_published_videos", "youtube_channels", "youtube_refreshes_per_month",
    "manual_youtube_full_collections", "youtube_radar_queries", "youtube_published_videos",
    "outcome_checks_per_video", "llm_calls", "llm_input_tokens_per_call",
    "llm_output_tokens_per_call", "llm_annotated_videos", "llm_similarity_videos",
    "llm_profile_rebuilds", "llm_idea_candidates", "llm_manual_calls",
)


def _trendwatcher_payload(config, scenario_rows, tariff_rows, generic_result, rates: dict):
    from .trendwatcher_econ import (
        TrendWatcherAssumptions, TrendWatcherDrivers,
        compute_credit_topup, compute_trendwatcher,
    )

    assumptions = TrendWatcherAssumptions(
        instagram_source=config.instagram_source,
        scrapecreators_price_per_1000=Decimal(config.scrapecreators_price_per_1000),
        apify_instagram_price_per_1000=Decimal(config.apify_instagram_price_per_1000),
        apify_actor_start_usd=Decimal(config.apify_actor_start_usd),
        provider_allowance_usd=Decimal(config.provider_allowance_usd),
        llm_provider=config.llm_provider,
        llm_input_usd_per_million=Decimal(config.llm_input_usd_per_million),
        llm_output_usd_per_million=Decimal(config.llm_output_usd_per_million),
        llm_retry_overhead_pct=Decimal(config.llm_retry_overhead_pct),
        llm_platform_fee_pct=Decimal(config.llm_platform_fee_pct),
    )
    usd_rate = rates.get("USD", Decimal("0"))
    managed_clients_total = sum(t.clients for t in tariff_rows if not t.is_byo)
    generic_variable_monthly = (
        generic_result.per_client_monthly + generic_result.per_unit_monthly
    )
    scenarios = []
    for row in scenario_rows:
        driver_values = {field: getattr(row, field) for field in _TW_DRIVER_FIELDS}
        calc = compute_trendwatcher(
            assumptions=assumptions,
            drivers=TrendWatcherDrivers(**driver_values),
        )
        data_per_client_base = calc.data_provider_cost_usd * usd_rate
        llm_per_client_base = calc.llm_cost_usd * usd_rate
        provider_data_monthly_base = sum(
            (Decimal("0") if tariff.is_byo else data_per_client_base * tariff.clients)
            for tariff in tariff_rows
        )
        provider_llm_monthly_base = sum(
            (Decimal("0") if tariff.is_byo else llm_per_client_base * tariff.clients)
            for tariff in tariff_rows
        )
        provider_monthly_base = provider_data_monthly_base + provider_llm_monthly_base
        payment_fee_pct = Decimal(config.payment_fee_pct) / Decimal("100")
        payment_fee_fixed_base = Decimal(config.payment_fee_fixed_usd) * usd_rate
        payment_fees_by_tariff = {
            tariff.id: (
                Decimal(tariff.price) * rates.get(tariff.currency, Decimal("0"))
                * payment_fee_pct + payment_fee_fixed_base
            )
            for tariff in tariff_rows
        }
        payment_fees_monthly_base = sum(
            payment_fees_by_tariff[tariff.id] * tariff.clients
            for tariff in tariff_rows
        )
        contribution_monthly_base = (
            generic_result.mrr - generic_variable_monthly
            - payment_fees_monthly_base - provider_monthly_base
        )
        cogs = (
            generic_result.fixed_monthly + generic_variable_monthly
            + payment_fees_monthly_base + provider_monthly_base
        )
        net = contribution_monthly_base - generic_result.fixed_monthly
        fixed_allocation = generic_result.fixed_monthly / max(1, generic_result.clients_total)
        by_tariff = []
        for tariff, base_tariff in zip(tariff_rows, generic_result.by_tariff):
            price_base = Decimal(tariff.price) * rates.get(tariff.currency, Decimal("0"))
            generic_var_per_client = price_base - base_tariff["net_per_client"]
            provider_data_base = Decimal("0") if tariff.is_byo else data_per_client_base
            provider_llm_base = Decimal("0") if tariff.is_byo else llm_per_client_base
            provider_cogs_base = provider_data_base + provider_llm_base
            payment_fee_base = payment_fees_by_tariff[tariff.id]
            contribution = (
                price_base - generic_var_per_client - payment_fee_base - provider_cogs_base
            )
            break_even = None
            if contribution > 0:
                break_even = int((generic_result.fixed_monthly / contribution).to_integral_value(
                    rounding=ROUND_CEILING
                ))
            cogs_per_client = generic_var_per_client + provider_cogs_base + fixed_allocation
            cogs_per_client += payment_fee_base
            churn_rate = Decimal(config.monthly_churn_pct) / Decimal("100")
            cac_base = Decimal(config.cac_per_client_usd) * usd_rate
            cac_payback = (
                cac_base / contribution if cac_base > 0 and contribution > 0 else None
            )
            ltv_contribution = (
                contribution / churn_rate if churn_rate > 0 and contribution > 0 else None
            )
            ltv_cac = (
                ltv_contribution / cac_base
                if ltv_contribution is not None and cac_base > 0 else None
            )
            by_tariff.append({
                "id": tariff.id,
                "name": tariff.name,
                "is_byo": tariff.is_byo,
                "clients": tariff.clients,
                "price_base": float(price_base),
                "provider_cogs_usd": 0.0 if tariff.is_byo else float(calc.provider_cost_usd),
                "provider_cogs_base": float(provider_cogs_base),
                "provider_data_per_client_base": float(provider_data_base),
                "provider_llm_per_client_base": float(provider_llm_base),
                "generic_variable_per_client_base": float(generic_var_per_client),
                "payment_fee_per_client_base": float(payment_fee_base),
                "fixed_allocation_per_client_base": (
                    float(fixed_allocation) if generic_result.clients_total else None
                ),
                "cogs_per_client_base": float(cogs_per_client),
                "gross_margin_per_client_base": float(price_base - cogs_per_client),
                "contribution_per_client_base": float(contribution),
                "contribution_margin_pct": (
                    float(contribution / price_base) if price_base > 0 else None
                ),
                "unit_profit_per_client_base": (
                    float(contribution - fixed_allocation)
                    if generic_result.clients_total else None
                ),
                "unit_margin_pct": (
                    float((contribution - fixed_allocation) / price_base)
                    if generic_result.clients_total and price_base > 0 else None
                ),
                "break_even_clients": break_even,
                "cac_payback_months": float(cac_payback) if cac_payback is not None else None,
                "ltv_contribution_base": (
                    float(ltv_contribution) if ltv_contribution is not None else None
                ),
                "ltv_cac_ratio": float(ltv_cac) if ltv_cac is not None else None,
                "net_per_client": float(
                    price_base - generic_var_per_client - payment_fee_base - provider_cogs_base
                ),
            })
        topup = compute_credit_topup(
            monthly_demand_credits=calc.scrapecreators_credits * managed_clients_total,
            starting_balance_credits=config.scrapecreators_credit_balance,
            pack_credits=config.scrapecreators_pack_credits,
            pack_price_usd=Decimal(config.scrapecreators_pack_price_usd),
        )
        pack_implied_price_per_1000 = (
            topup.pack_price_usd * Decimal("1000") / Decimal(topup.pack_credits)
        )
        allocation_price_per_1000 = Decimal(config.scrapecreators_price_per_1000)
        scenario_payload = {
            "key": row.key,
            "label": row.label,
            "drivers": driver_values,
            "usage": {
                "instagram": {
                    "requests": calc.instagram_credits,
                    "credits": calc.instagram_credits,
                    "refresh_credits": calc.instagram_refresh_credits,
                    "radar_credits": calc.instagram_radar_credits,
                    "transcript_credits": calc.transcript_credits,
                    "outcome_credits": calc.outcome_credits,
                    "unsupported_radar_runs": calc.unsupported_instagram_radar_runs,
                    "cost_usd": float(calc.instagram_cost_usd + calc.apify_instagram_cost_usd),
                },
                "tiktok": {
                    "requests": calc.tiktok_credits,
                    "credits": calc.tiktok_credits,
                    "refresh_credits": calc.tiktok_refresh_credits,
                    "discovery_credits": calc.tiktok_discovery_credits,
                    "transcript_credits": calc.tiktok_transcript_credits,
                    "outcome_credits": calc.tiktok_outcome_credits,
                    "cost_usd": float(calc.tiktok_cost_usd),
                },
                "apify": {
                    "results": calc.apify_instagram_results,
                    "actor_runs": calc.apify_actor_runs,
                    "cost_usd": float(calc.apify_instagram_cost_usd),
                },
                "llm": {
                    "provider": config.llm_provider,
                    "calls": calc.llm_billed_calls,
                    "base_calls": calc.llm_base_calls,
                    "billed_calls": calc.llm_billed_calls,
                    "breakdown": {
                        "annotations": calc.llm_annotation_calls,
                        "similarity_batches": calc.llm_similarity_calls,
                        "profile": calc.llm_profile_calls,
                        "ideas": calc.llm_idea_calls,
                        "manual": calc.llm_manual_calls,
                    },
                    "input_tokens": calc.llm_input_tokens,
                    "output_tokens": calc.llm_output_tokens,
                    "inference_cost_usd": float(calc.llm_inference_cost_usd),
                    "platform_fee_usd": float(calc.llm_platform_fee_usd),
                    "cost_usd": float(calc.llm_cost_usd),
                },
                "youtube": {
                    "search_calls": calc.youtube_search_calls,
                    "general_quota_units": calc.youtube_general_quota_units,
                    "internal_legacy_meter_units": calc.youtube_internal_meter_units,
                    "daily_general_limit": config.youtube_daily_general_units,
                    "daily_search_limit": config.youtube_daily_search_calls,
                    "cost_usd": None,
                },
                "scrapecreators_credits": calc.scrapecreators_credits,
                "allowance": {
                    "limit_usd": float(config.provider_allowance_usd),
                    "demand_usd": float(calc.allowance_demand_usd),
                    "used_usd": float(calc.allowance_used_usd),
                    "remaining_usd": float(calc.allowance_remaining_usd),
                    "overage_usd": float(calc.allowance_overage_usd),
                    "max_whole_credits": calc.allowance_max_credits,
                },
                "provider_cost_usd": float(calc.provider_cost_usd),
            },
            "capacity": {
                "starting_balance_credits": topup.starting_balance_credits,
                "monthly_demand_credits": topup.monthly_demand_credits,
                "shortfall_credits": topup.shortfall_credits,
                "pack_credits": topup.pack_credits,
                "pack_price_usd": float(topup.pack_price_usd),
                "packs_to_buy": topup.packs_to_buy,
                "next_topup_cash_usd": float(topup.next_topup_cash_usd),
                "ending_balance_credits": topup.ending_balance_credits,
                "pack_implied_price_per_1000": float(pack_implied_price_per_1000),
                "allocation_price_per_1000": float(allocation_price_per_1000),
                "rate_mismatch": (
                    abs(pack_implied_price_per_1000 - allocation_price_per_1000)
                    > Decimal("0.0001")
                ),
            },
            "economics": {
                "mrr": float(generic_result.mrr),
                "revenue_monthly_base": float(generic_result.mrr),
                "generic_variable_monthly_base": float(generic_variable_monthly),
                "payment_fees_monthly_base": float(payment_fees_monthly_base),
                "fixed_monthly_base": float(generic_result.fixed_monthly),
                "provider_data_monthly_base": float(provider_data_monthly_base),
                "provider_llm_monthly_base": float(provider_llm_monthly_base),
                "provider_monthly_base": float(provider_monthly_base),
                "contribution_monthly_base": float(contribution_monthly_base),
                "cogs_monthly": float(cogs),
                "cogs_per_client": float(cogs / max(1, generic_result.clients_total)),
                "net_monthly": float(net),
                "operating_profit_base": float(net),
                "margin_pct": float(net / generic_result.mrr) if generic_result.mrr else None,
                "gross_margin_pct": (
                    float(contribution_monthly_base / generic_result.mrr)
                    if generic_result.mrr else None
                ),
                "by_tariff": by_tariff,
            },
        }
        scenarios.append(scenario_payload)

    active = next((s for s in scenarios if s["key"] == config.active_scenario), scenarios[0])
    return {
        "config": {
            "active_scenario": config.active_scenario,
            "instagram_source": config.instagram_source,
            "provider_allowance_usd": float(config.provider_allowance_usd),
            "scrapecreators_price_per_1000": float(config.scrapecreators_price_per_1000),
            "scrapecreators_pack_price_usd": float(config.scrapecreators_pack_price_usd),
            "scrapecreators_pack_credits": config.scrapecreators_pack_credits,
            "scrapecreators_credit_balance": config.scrapecreators_credit_balance,
            "apify_instagram_price_per_1000": float(config.apify_instagram_price_per_1000),
            "apify_actor_start_usd": float(config.apify_actor_start_usd),
            "llm_provider": config.llm_provider,
            "llm_input_usd_per_million": float(config.llm_input_usd_per_million),
            "llm_output_usd_per_million": float(config.llm_output_usd_per_million),
            "llm_retry_overhead_pct": float(config.llm_retry_overhead_pct),
            "llm_platform_fee_pct": float(config.llm_platform_fee_pct),
            "payment_fee_pct": float(config.payment_fee_pct),
            "payment_fee_fixed_usd": float(config.payment_fee_fixed_usd),
            "monthly_churn_pct": float(config.monthly_churn_pct),
            "cac_per_client_usd": float(config.cac_per_client_usd),
            "youtube_daily_general_units": config.youtube_daily_general_units,
            "youtube_daily_search_calls": config.youtube_daily_search_calls,
        },
        "pricing_basis": {
            "scrapecreators": "verified: Freelance $1.88/1000 requests",
            "apify": "editable assumption: rate depends on actor and subscription tier",
            "llm": "verified Gemini 2.5 Flash token rates; editable workflow/token assumptions",
            "commercial": "payment fees, churn and CAC are explicit editable assumptions",
            "youtube": "non-monetary quota; current app meter also shown for drift visibility",
        },
        "pricing_sources": {
            "scrapecreators": {
                "status": "verified",
                "label": "Freelance $1.88 / 1,000 credits",
                "url": "https://scrapecreators.com/#pricing",
                "checked_on": "2026-07-23",
            },
            "apify": {
                "status": "assumption",
                "label": "Редактируемая ставка выбранного actor/tier",
                "url": "https://apify.com/apify/instagram-reel-scraper/pricing",
                "checked_on": "2026-07-23",
            },
            "llm": {
                "status": "verified",
                "label": "Gemini 2.5 Flash Standard token rates",
                "url": "https://ai.google.dev/gemini-api/docs/pricing",
                "checked_on": "2026-07-23",
            },
            "commercial": {
                "status": "assumption",
                "label": "Пользовательские payment fee, churn и CAC",
                "url": None,
                "checked_on": None,
            },
            "youtube": {
                "status": "verified",
                "label": "Немонетарные API quota limits",
                "url": "https://developers.google.com/youtube/v3/getting-started",
                "checked_on": "2026-07-23",
            },
        },
        "scenarios": scenarios,
        "active": active,
    }


def service_summary_payload(
    db: Session,
    service_id: int,
    *,
    trendwatcher_config_override=None,
    trendwatcher_scenario_overrides: dict[str, object] | None = None,
):
    """Юнит-экономика одного сервиса + сравнение с breakeven. Прогноз не трогаем."""
    from .db import (
        Service, ServiceCost, ServiceTariff, ServiceTariffUsage,
        TrendWatcherConfig, TrendWatcherScenario,
    )
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

    config = (
        trendwatcher_config_override
        if trendwatcher_config_override is not None
        else db.get(TrendWatcherConfig, service_id)
    )
    trendwatcher = None
    if config is not None:
        scenario_rows = db.scalars(select(TrendWatcherScenario).where(
            TrendWatcherScenario.service_id == service_id
        ).order_by(TrendWatcherScenario.sort_order, TrendWatcherScenario.id)).all()
        if trendwatcher_scenario_overrides:
            scenario_rows = [
                trendwatcher_scenario_overrides.get(row.key, row)
                for row in scenario_rows
            ]
        if scenario_rows:
            trendwatcher = _trendwatcher_payload(config, scenario_rows, tariff_rows, res, rates)

    cur_used = {t.currency for t in tariff_rows} | {c.currency for c in cost_rows}
    if trendwatcher is not None:
        cur_used.add("USD")
    missing_rates = sorted(c for c in cur_used if c not in rates)

    tariffs = []
    active_by_tariff = {
        row["id"]: row for row in (
            trendwatcher["active"]["economics"]["by_tariff"] if trendwatcher else []
        )
    }
    for row, bt in zip(tariff_rows, res.by_tariff):
        active_tariff = active_by_tariff.get(row.id)
        tariffs.append({
            "id": row.id, "name": row.name, "price": float(row.price),
            "currency": row.currency, "clients": row.clients, "is_byo": row.is_byo,
            "usage": {cid: float(u) for cid, u in usage_by_tariff.get(row.id, {}).items()},
            "mrr_base": float(bt["mrr_base"]),
            "var_cost_base": (float(bt["var_cost_base"])
                              + (active_tariff["provider_cogs_base"] * row.clients
                                 if active_tariff else 0)),
            "net_per_client": (active_tariff["net_per_client"]
                               if active_tariff else float(bt["net_per_client"])),
            "provider_cogs_per_client": (active_tariff["provider_cogs_base"]
                                         if active_tariff else 0),
            "break_even_clients": (active_tariff["break_even_clients"]
                                   if active_tariff else None),
        })
    costs = [{
        "id": c.id, "name": c.name, "amount": float(c.amount), "currency": c.currency,
        "kind": c.kind, "unit_label": c.unit_label, "unit_size": c.unit_size,
    } for c in cost_rows]

    active_econ = trendwatcher["active"]["economics"] if trendwatcher else None
    provider_monthly = active_econ["provider_monthly_base"] if active_econ else 0.0
    cogs_monthly = active_econ["cogs_monthly"] if active_econ else float(res.cogs_monthly)
    net_monthly = active_econ["net_monthly"] if active_econ else float(res.net_monthly)
    margin_pct = active_econ["margin_pct"] if active_econ else (
        float(res.margin_pct) if res.margin_pct is not None else None
    )

    return {
        "service": {"id": svc.id, "name": svc.name, "note": svc.note,
                    "preset_key": svc.preset_key, "preset_version": svc.preset_version},
        "base_currency": settings.base_currency,
        "mrr": float(res.mrr),
        "fixed_monthly": float(res.fixed_monthly),
        "per_client_monthly": float(res.per_client_monthly),
        "per_unit_monthly": float(res.per_unit_monthly) + provider_monthly,
        "provider_monthly": provider_monthly,
        "cogs_monthly": cogs_monthly,
        "net_monthly": net_monthly,
        "margin_pct": margin_pct,
        "clients_total": res.clients_total,
        "required_monthly_income": required,
        "net_vs_required": net_monthly - required,
        "missing_rates": missing_rates,
        "tariffs": tariffs,
        "costs": costs,
        "trendwatcher": trendwatcher,
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
