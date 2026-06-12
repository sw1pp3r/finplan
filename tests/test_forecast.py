from datetime import date, timedelta
from decimal import Decimal as D

from app.forecast import Snap, Obligation, Inflow, build_forecast, next_period

TODAY = date(2026, 6, 7)
RATES = {"USD": D("1"), "HKD": D("0.128"), "KZT": D("0.002")}


def fc(**kw):
    defaults = dict(
        today=TODAY,
        horizon_days=90,
        rates=RATES,
        snapshots=[],
        obligations=[],
        inflows=[],
        cushion=D("0"),
        manual_burn_weekly=None,
    )
    defaults.update(kw)
    return build_forecast(**defaults)


def usd_snap(taken_at, amount, account="Bank"):
    return Snap(taken_at=taken_at, account=account, currency="USD", amount=D(amount))


def points_map(result, scenario):
    return dict(result.scenarios[scenario].points)


# ---------- T0 ----------

def test_t0_converts_latest_snapshot_to_base_currency():
    snaps = [
        # старый снимок — игнорируется для T0
        usd_snap(date(2026, 5, 1), "999999"),
        Snap(date(2026, 6, 1), "HSBC", "HKD", D("100000")),
        Snap(date(2026, 6, 1), "IBKR", "USD", D("5000")),
    ]
    r = fc(snapshots=snaps)
    assert r.t0 == D("100000") * D("0.128") + D("5000")  # 17800
    assert r.t0_by_currency == {"HKD": D("100000"), "USD": D("5000")}
    assert r.last_snapshot_date == date(2026, 6, 1)


# ---------- burn rate ----------

def test_burn_derived_as_median_of_weekly_deltas():
    snaps = [
        usd_snap(date(2026, 5, 3), "20000"),
        usd_snap(date(2026, 5, 10), "19500"),
        usd_snap(date(2026, 5, 17), "19000"),
        usd_snap(date(2026, 5, 24), "18500"),
        usd_snap(date(2026, 5, 31), "18000"),
    ]
    r = fc(snapshots=snaps)
    assert r.burn_weekly == D("500")
    assert r.burn_source == "derived"


def test_burn_excludes_paid_oneoff_from_delta():
    snaps = [
        usd_snap(date(2026, 5, 3), "20000"),
        usd_snap(date(2026, 5, 10), "19500"),
        usd_snap(date(2026, 5, 17), "19000"),
        # между 17 и 24 мая оплачено one-off 2000 → дельта 2500, но burn остаётся 500
        usd_snap(date(2026, 5, 24), "16500"),
    ]
    paid = Obligation("Школа", D("2000"), "USD", date(2026, 5, 20), status="paid")
    r = fc(snapshots=snaps, obligations=[paid])
    assert r.burn_weekly == D("500")


def test_burn_includes_received_inflow_adjustment():
    snaps = [
        usd_snap(date(2026, 5, 3), "20000"),
        usd_snap(date(2026, 5, 10), "19500"),
        usd_snap(date(2026, 5, 17), "19000"),
        # между 17 и 24 получено 3000 → дельта +2500, burn всё равно 500
        usd_snap(date(2026, 5, 24), "21500"),
    ]
    recv = Inflow("Инвойс", D("3000"), "USD", date(2026, 5, 20), status="received")
    r = fc(snapshots=snaps, inflows=[recv])
    assert r.burn_weekly == D("500")


def test_burn_falls_back_to_manual_when_fewer_than_4_snapshot_dates():
    snaps = [
        usd_snap(date(2026, 5, 17), "19000"),
        usd_snap(date(2026, 5, 24), "18500"),
        usd_snap(date(2026, 5, 31), "18000"),
    ]
    r = fc(snapshots=snaps, manual_burn_weekly=D("700"))
    assert r.burn_weekly == D("700")
    assert r.burn_source == "manual"


def test_burn_zero_when_no_history_and_no_manual():
    r = fc(snapshots=[usd_snap(date(2026, 6, 1), "10000")])
    assert r.burn_weekly == D("0")
    assert r.burn_source == "none"


# ---------- кривая: обязательства ----------

def test_obligation_subtracted_on_due_date():
    snaps = [usd_snap(TODAY, "10000")]
    ob = Obligation("Билеты", D("3000"), "USD", TODAY + timedelta(days=10))
    r = fc(snapshots=snaps, obligations=[ob])
    pts = points_map(r, "base")
    assert pts[TODAY + timedelta(days=9)] == D("10000")
    assert pts[TODAY + timedelta(days=10)] == D("7000")


def test_paid_and_cancelled_obligations_not_on_curve():
    snaps = [usd_snap(TODAY, "10000")]
    obs = [
        Obligation("Уже оплачено", D("3000"), "USD", TODAY + timedelta(days=5), status="paid"),
        Obligation("Отменено", D("2000"), "USD", TODAY + timedelta(days=5), status="cancelled"),
    ]
    r = fc(snapshots=snaps, obligations=obs)
    assert points_map(r, "base")[TODAY + timedelta(days=20)] == D("10000")


def test_overdue_planned_obligation_applies_today():
    snaps = [usd_snap(TODAY, "10000")]
    ob = Obligation("Просрочка", D("1000"), "USD", TODAY - timedelta(days=3))
    r = fc(snapshots=snaps, obligations=[ob])
    assert points_map(r, "base")[TODAY] == D("9000")


def test_monthly_recurrence_expands_with_month_end_clamp():
    snaps = [usd_snap(TODAY, "10000")]
    # 31 июля → 31 августа → 30 сентября (клэмп к концу месяца)
    ob = Obligation("Аренда", D("1000"), "USD", date(2026, 7, 31), recurrence="monthly")
    r = fc(snapshots=snaps, horizon_days=120, obligations=[ob])  # горизонт до 2026-10-05
    pts = points_map(r, "base")
    assert pts[date(2026, 7, 30)] == D("10000")
    assert pts[date(2026, 7, 31)] == D("9000")
    assert pts[date(2026, 8, 31)] == D("8000")
    assert pts[date(2026, 9, 30)] == D("7000")
    assert pts[date(2026, 10, 4)] == D("7000")  # следующая (31.10) за горизонтом


def test_weekly_recurrence_expands_every_seven_days():
    snaps = [usd_snap(TODAY, "10000")]
    # 14.06 → 21.06 → 28.06 → 05.07, шаг 7 дней
    ob = Obligation("Психолог", D("100"), "USD", date(2026, 6, 14), recurrence="weekly")
    r = fc(snapshots=snaps, horizon_days=30, obligations=[ob])  # горизонт до 2026-07-07
    pts = points_map(r, "base")
    assert pts[date(2026, 6, 13)] == D("10000")
    assert pts[date(2026, 6, 14)] == D("9900")
    assert pts[date(2026, 6, 21)] == D("9800")
    assert pts[date(2026, 6, 28)] == D("9700")
    assert pts[date(2026, 7, 5)] == D("9600")


def test_scenario_breakdown_reconstructs_minimum():
    snaps = [usd_snap(TODAY, "10000")]
    ob = Obligation("Расход", D("3000"), "USD", TODAY + timedelta(days=5))
    inf = Inflow("Приход", D("1000"), "USD", TODAY + timedelta(days=3), probability="confirmed")
    r = fc(snapshots=snaps, horizon_days=30, obligations=[ob], inflows=[inf])
    b = r.scenarios["base"].breakdown
    assert b["t0"] == D("10000")
    assert b["obligations"] == D("3000")  # расход ≤ даты минимума
    assert b["inflows"] == D("1000")      # confirmed ×1
    # компоненты восстанавливают минимум: t0 − burn − расходы + приходы
    assert b["t0"] - b["burn"] - b["obligations"] + b["inflows"] == r.scenarios["base"].min_total


def test_next_period_steps_with_month_clamp():
    assert next_period(date(2026, 6, 18), "weekly") == date(2026, 6, 25)
    assert next_period(date(2026, 6, 18), "monthly") == date(2026, 7, 18)
    assert next_period(date(2026, 1, 31), "monthly") == date(2026, 2, 28)  # клэмп
    assert next_period(date(2026, 6, 18), "yearly") == date(2027, 6, 18)


# ---------- кривая: поступления и сценарии ----------

def test_inflow_probability_weights_per_scenario():
    snaps = [usd_snap(TODAY, "10000")]
    inf = Inflow("Клиент", D("1000"), "USD", TODAY + timedelta(days=5), probability="likely")
    r = fc(snapshots=snaps, inflows=[inf])
    end = TODAY + timedelta(days=30)
    assert points_map(r, "pessimistic")[end] == D("10000")
    assert points_map(r, "base")[end] == D("10700")
    assert points_map(r, "optimistic")[end] == D("11000")


def test_received_and_lost_inflows_not_on_curve():
    snaps = [usd_snap(TODAY, "10000")]
    infs = [
        Inflow("Получено", D("5000"), "USD", TODAY + timedelta(days=5), status="received"),
        Inflow("Потеряно", D("4000"), "USD", TODAY + timedelta(days=5), status="lost"),
    ]
    r = fc(snapshots=snaps, inflows=infs)
    assert points_map(r, "base")[TODAY + timedelta(days=10)] == D("10000")


# ---------- min point, cushion, gap ----------

def test_min_point_and_cushion_breach():
    snaps = [usd_snap(TODAY, "5000")]
    ob = Obligation("Платёж", D("4000"), "USD", TODAY + timedelta(days=10))
    inf = Inflow("Инвойс", D("6000"), "USD", TODAY + timedelta(days=30))
    r = fc(snapshots=snaps, obligations=[ob], inflows=[inf], cushion=D("2000"))
    s = r.scenarios["base"]
    assert s.min_total == D("1000")
    assert s.min_date == TODAY + timedelta(days=10)
    assert s.cushion_breach_date == TODAY + timedelta(days=10)


def test_no_breach_when_curve_stays_above_cushion():
    snaps = [usd_snap(TODAY, "10000")]
    r = fc(snapshots=snaps, cushion=D("2000"))
    assert r.scenarios["base"].cushion_breach_date is None
    assert r.gap_amount == D("0")
    assert r.gap_deadline is None


def test_gap_amount_and_deadline_two_weeks_before_min():
    snaps = [usd_snap(TODAY, "5000")]
    ob = Obligation("Платёж", D("4000"), "USD", TODAY + timedelta(days=60))
    r = fc(snapshots=snaps, obligations=[ob], cushion=D("2000"))
    assert r.gap_amount == D("1000")  # 2000 - min(1000)
    assert r.gap_deadline == TODAY + timedelta(days=46)  # min_date - 14


# ---------- спайк (план 011): «что если купить все хотелки» ----------

def test_whatif_folding_wishes_as_obligations_lowers_minimum():
    """Спайк-доказательство feasibility: синтезируем из хотелок разовые Obligation
    (due_date = target_date или сегодня) и повторно зовём build_forecast — минимум
    строго ниже baseline. Движок менять не нужно: build_forecast уже принимает список
    obligations. См. docs/improve/011-spike-notes.md."""
    snaps = [usd_snap(date(2026, 6, 1), "20000")]
    baseline = fc(snapshots=snaps)

    wishes = [
        {"amount": "5000", "currency": "USD", "target_date": TODAY + timedelta(days=30)},
        {"amount": "3000", "currency": "USD", "target_date": None},  # без даты → сегодня
    ]
    wish_obs = [
        Obligation(name="wish", amount=D(w["amount"]), currency=w["currency"],
                   due_date=w["target_date"] or TODAY, recurrence="once", status="planned")
        for w in wishes
    ]
    whatif = fc(snapshots=snaps, obligations=wish_obs)

    assert whatif.scenarios["base"].min_total < baseline.scenarios["base"].min_total
    # минимум падает ровно на сумму хотелок в горизонте (20000 − 5000 − 3000)
    assert whatif.scenarios["base"].min_total == D("12000")
