"""Чистый forecast-движок: ТЗ §5. Без БД, без I/O — вход данными, выход результатом."""
import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal


@dataclass(frozen=True)
class Snap:
    taken_at: date
    account: str
    currency: str
    amount: Decimal


@dataclass(frozen=True)
class Obligation:
    name: str
    amount: Decimal
    currency: str
    due_date: date
    recurrence: str = "once"  # once | monthly | yearly
    recurrence_end: date | None = None
    status: str = "planned"  # planned | paid | cancelled


@dataclass(frozen=True)
class Inflow:
    name: str
    amount: Decimal
    currency: str
    expected_date: date
    probability: str = "confirmed"  # confirmed | likely | possible
    status: str = "expected"  # expected | received | lost
    recurrence: str = "once"  # once | weekly | monthly | yearly
    recurrence_end: date | None = None


@dataclass
class ScenarioResult:
    points: list  # [(date, Decimal total)]
    min_total: Decimal
    min_date: date
    cushion_breach_date: date | None
    breakdown: dict  # {t0, burn, obligations, inflows} к дате минимума (база): t0 − burn − obligations + inflows = min_total


@dataclass
class ForecastResult:
    t0: Decimal
    t0_by_currency: dict
    burn_weekly: Decimal
    burn_source: str  # derived | manual | none
    scenarios: dict  # pessimistic | base | optimistic -> ScenarioResult
    gap_amount: Decimal
    gap_deadline: date | None
    last_snapshot_date: date | None


SCENARIO_WEIGHTS = {
    "pessimistic": {"confirmed": Decimal("1"), "likely": Decimal("0"), "possible": Decimal("0")},
    "base": {"confirmed": Decimal("1"), "likely": Decimal("0.7"), "possible": Decimal("0.3")},
    "optimistic": {"confirmed": Decimal("1"), "likely": Decimal("1"), "possible": Decimal("1")},
}

GAP_BUFFER_DAYS = 14


def _add_months(d: date, n: int) -> date:
    y = d.year + (d.month - 1 + n) // 12
    m = (d.month - 1 + n) % 12 + 1
    last_day = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last_day))


def next_period(d: date, recurrence: str) -> date:
    """Следующее наступление через один период (клэмп конца месяца для monthly/yearly)."""
    if recurrence == "weekly":
        return d + timedelta(days=7)
    if recurrence == "monthly":
        return _add_months(d, 1)
    if recurrence == "yearly":
        return _add_months(d, 12)
    return d


def _to_base(amount: Decimal, currency: str, rates: dict) -> Decimal:
    # валюта без курса = 0 (документированный контракт), движок не роняем KeyError (#5)
    return amount * rates.get(currency, Decimal("0"))


def _median(values: list) -> Decimal:
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


def _scheduled_count(ob, d1: date, d2: date) -> int:
    """Сколько раз обязательство наступает строго в окне (d1, d2] (без клэмпа на сегодня)."""
    occ = ob.due_date
    if ob.recurrence == "once":
        return 1 if d1 < occ <= d2 else 0
    month_step = {"monthly": 1, "yearly": 12}.get(ob.recurrence)
    n, cnt = 0, 0
    while occ <= d2:
        if ob.recurrence_end is not None and occ > ob.recurrence_end:
            break
        if d1 < occ:
            cnt += 1
        n += 1
        if ob.recurrence == "weekly":
            occ = ob.due_date + timedelta(days=7 * n)
        else:
            occ = _add_months(ob.due_date, month_step * n)
    return cnt


def _derive_burn(snap_totals: dict, obligations: list, inflows: list, rates: dict) -> Decimal:
    """Медиана недельных дельт между соседними снимками с поправкой на one-off факты.
    Из дельты вычитаются НЕ только оплаченные one-off (paid), но и запланированные
    обязательства, наступившие в окне снимков — иначе их трата сидит и в derived burn,
    и ещё раз на кривой/в breakeven (двойной счёт #2/#3/#7). Поправка симметрична paid."""
    dates = sorted(snap_totals)
    pairs = []
    for d1, d2 in zip(dates, dates[1:]):
        paid = sum(
            (_to_base(o.amount, o.currency, rates) for o in obligations
             if o.status == "paid" and d1 < o.due_date <= d2),
            Decimal("0"),
        )
        planned = sum(
            (_to_base(o.amount, o.currency, rates) * _scheduled_count(o, d1, d2)
             for o in obligations if o.status == "planned"),
            Decimal("0"),
        )
        received = sum(
            (_to_base(i.amount, i.currency, rates) for i in inflows
             if i.status == "received" and d1 < i.expected_date <= d2),
            Decimal("0"),
        )
        days = (d2 - d1).days
        burn = (snap_totals[d1] - snap_totals[d2] - paid - planned + received) * 7 / days
        pairs.append(burn)
    return _median(pairs)


def _occurrences(start: date, recurrence: str, recurrence_end: date | None,
                 today: date, horizon_end: date):
    """Развёртка recurrence от start в окне [today, horizon_end].
    Для once просрочка клэмпится на сегодня. Для регулярных серий полностью
    просроченные периоды НЕ складываются стопкой на сегодня (#4): только текущий
    (последний наступивший ≤ today) период клэмпится на сегодня один раз, более
    ранние отбрасываются. Будущие наступления остаются на своих датах.
    Общая логика для обязательств и регулярных поступлений."""
    if recurrence == "once":
        if start <= horizon_end and (recurrence_end is None or start <= recurrence_end):
            yield max(start, today)
        return
    month_step = {"monthly": 1, "yearly": 12}.get(recurrence)
    occ, n = start, 0
    overdue_pending = False  # был хотя бы один период строго до сегодня
    emitted_today = False
    while occ <= horizon_end:
        if recurrence_end is not None and occ > recurrence_end:
            break
        if occ < today:
            overdue_pending = True  # помним только сам факт; не выдаём каждый
        else:
            if overdue_pending and not emitted_today and occ > today:
                yield today  # текущий просроченный период → сегодня (единожды)
                emitted_today = True
            yield occ
            if occ == today:
                emitted_today = True
        n += 1
        if recurrence == "weekly":
            occ = start + timedelta(days=7 * n)
        else:
            occ = _add_months(start, month_step * n)
    if overdue_pending and not emitted_today:
        yield today  # вся серия просрочена в пределах окна → один платёж сегодня


def _obligation_occurrences(ob: Obligation, today: date, horizon_end: date):
    """Развёртка recurrence; просроченные planned ложатся на сегодня."""
    if ob.status != "planned":
        return
    yield from _occurrences(ob.due_date, ob.recurrence, ob.recurrence_end, today, horizon_end)


def build_forecast(
    *,
    today: date,
    horizon_days: int,
    rates: dict,
    snapshots: list,
    obligations: list,
    inflows: list,
    cushion: Decimal,
    manual_burn_weekly: Decimal | None = None,
) -> ForecastResult:
    horizon_end = today + timedelta(days=horizon_days)

    # --- T0: последний снимок ---
    snap_dates = sorted({s.taken_at for s in snapshots})
    last_date = snap_dates[-1] if snap_dates else None
    t0_by_currency: dict = {}
    if last_date is not None:
        for s in snapshots:
            if s.taken_at == last_date:
                t0_by_currency[s.currency] = t0_by_currency.get(s.currency, Decimal("0")) + s.amount
    t0 = sum((_to_base(a, c, rates) for c, a in t0_by_currency.items()), Decimal("0"))

    # --- burn rate ---
    if len(snap_dates) >= 4:
        snap_totals = {
            d: sum((_to_base(s.amount, s.currency, rates) for s in snapshots if s.taken_at == d), Decimal("0"))
            for d in snap_dates
        }
        burn_weekly = _derive_burn(snap_totals, obligations, inflows, rates)
        burn_source = "derived"
    elif manual_burn_weekly is not None:
        burn_weekly, burn_source = manual_burn_weekly, "manual"
    else:
        burn_weekly, burn_source = Decimal("0"), "none"

    # --- события на кривой ---
    obligation_events = []  # (date, amount_base) — одинаковы для всех сценариев
    for ob in obligations:
        for occ in _obligation_occurrences(ob, today, horizon_end):
            obligation_events.append((occ, _to_base(ob.amount, ob.currency, rates)))

    scenarios = {}
    for name, weights in SCENARIO_WEIGHTS.items():
        events: dict = {}
        for d, amt in obligation_events:
            events[d] = events.get(d, Decimal("0")) - amt
        for inf in inflows:
            if inf.status != "expected":
                continue
            w = weights[inf.probability]
            if w == 0:
                continue
            amt = _to_base(inf.amount, inf.currency, rates) * w
            for occ in _occurrences(inf.expected_date, inf.recurrence, inf.recurrence_end, today, horizon_end):
                events[occ] = events.get(occ, Decimal("0")) + amt

        points = []
        cum = Decimal("0")
        min_total, min_date, breach = None, None, None
        for i in range(horizon_days + 1):
            d = today + timedelta(days=i)
            cum += events.get(d, Decimal("0"))
            total = t0 - burn_weekly * i / 7 + cum
            points.append((d, total))
            if min_total is None or total < min_total:
                min_total, min_date = total, d
            if breach is None and total < cushion:
                breach = d

        # разбивка минимума на компоненты (для «чека» в UI): t0 − burn − obligations + inflows
        days_to_min = (min_date - today).days
        burn_to_min = burn_weekly * Decimal(days_to_min) / 7
        obl_to_min = sum((amt for d, amt in obligation_events if d <= min_date), Decimal("0"))
        inf_to_min = Decimal("0")
        for inf in inflows:
            if inf.status != "expected":
                continue
            w = weights[inf.probability]
            if w == 0:
                continue
            amt = _to_base(inf.amount, inf.currency, rates) * w
            for occ in _occurrences(inf.expected_date, inf.recurrence, inf.recurrence_end, today, horizon_end):
                if occ <= min_date:
                    inf_to_min += amt

        scenarios[name] = ScenarioResult(
            points=points, min_total=min_total, min_date=min_date, cushion_breach_date=breach,
            breakdown={"t0": t0, "burn": burn_to_min, "obligations": obl_to_min, "inflows": inf_to_min},
        )

    # --- gap по базовому сценарию ---
    base = scenarios["base"]
    gap_amount = max(Decimal("0"), cushion - base.min_total)
    gap_deadline = None
    if gap_amount > 0:
        gap_deadline = max(today, base.min_date - timedelta(days=GAP_BUFFER_DAYS))

    return ForecastResult(
        t0=t0,
        t0_by_currency=t0_by_currency,
        burn_weekly=burn_weekly,
        burn_source=burn_source,
        scenarios=scenarios,
        gap_amount=gap_amount,
        gap_deadline=gap_deadline,
        last_snapshot_date=last_date,
    )
