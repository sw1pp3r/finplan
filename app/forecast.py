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
    return amount * rates[currency]


def _median(values: list) -> Decimal:
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


def _derive_burn(snap_totals: dict, obligations: list, inflows: list, rates: dict) -> Decimal:
    """Медиана недельных дельт между соседними снимками с поправкой на one-off факты."""
    dates = sorted(snap_totals)
    pairs = []
    for d1, d2 in zip(dates, dates[1:]):
        paid = sum(
            (_to_base(o.amount, o.currency, rates) for o in obligations
             if o.status == "paid" and d1 < o.due_date <= d2),
            Decimal("0"),
        )
        received = sum(
            (_to_base(i.amount, i.currency, rates) for i in inflows
             if i.status == "received" and d1 < i.expected_date <= d2),
            Decimal("0"),
        )
        days = (d2 - d1).days
        burn = (snap_totals[d1] - snap_totals[d2] - paid + received) * 7 / days
        pairs.append(burn)
    return _median(pairs)


def _obligation_occurrences(ob: Obligation, today: date, horizon_end: date):
    """Развёртка recurrence; просроченные planned ложатся на сегодня."""
    if ob.status != "planned":
        return
    month_step = {"monthly": 1, "yearly": 12}.get(ob.recurrence)  # None для once/weekly
    occ, n = ob.due_date, 0
    while occ <= horizon_end:
        if ob.recurrence_end is not None and occ > ob.recurrence_end:
            break
        yield max(occ, today)
        if ob.recurrence == "once":
            break
        n += 1
        if ob.recurrence == "weekly":
            occ = ob.due_date + timedelta(days=7 * n)
        else:
            occ = _add_months(ob.due_date, month_step * n)


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
            d = max(inf.expected_date, today)
            if d > horizon_end:
                continue
            events[d] = events.get(d, Decimal("0")) + _to_base(inf.amount, inf.currency, rates) * w

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
            d = max(inf.expected_date, today)
            if d <= min_date and d <= horizon_end:
                inf_to_min += _to_base(inf.amount, inf.currency, rates) * w

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
