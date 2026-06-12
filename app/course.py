"""Чистый калькулятор экономики курса: тарифы × ученики − расходы → прибыль/мес.

Песочница для «что если»: не трогает прогноз, только считает декомпозицию и
нормализует к месяцу, чтобы сравнить с breakeven (сколько нужно зарабатывать в месяц).
"""
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Tariff:
    name: str
    price: Decimal
    currency: str
    students: int


@dataclass(frozen=True)
class Cost:
    name: str
    amount: Decimal
    currency: str
    kind: str = "monthly"  # monthly (фикс/мес) | per_student (на ученика за поток)


@dataclass
class CourseResult:
    students_total: int
    gross_per_cohort: Decimal   # выручка за один поток (базовая валюта)
    gross_monthly: Decimal      # выручка/мес = за поток / частоту потоков
    fixed_monthly: Decimal      # фикс-расходы/мес (базовая)
    variable_monthly: Decimal   # на ученика, нормализовано в месяц
    cost_monthly: Decimal       # fixed + variable
    net_monthly: Decimal        # чистая прибыль/мес
    net_per_cohort: Decimal     # чистая прибыль за один поток
    by_tariff: list             # [{name, students, price, currency, gross_base}]


def _to_base(amount: Decimal, currency: str, rates: dict) -> Decimal:
    return amount * rates.get(currency, Decimal("0"))


def compute_course(
    *,
    tariffs: list,
    cohort_months: int,
    costs: list,
    rates: dict,
) -> CourseResult:
    months = Decimal(max(1, cohort_months))

    by_tariff, gross_per_cohort, students_total = [], Decimal("0"), 0
    for t in tariffs:
        gross_base = _to_base(t.price, t.currency, rates) * t.students
        gross_per_cohort += gross_base
        students_total += t.students
        by_tariff.append({
            "name": t.name, "students": t.students, "price": t.price,
            "currency": t.currency, "gross_base": gross_base,
        })

    # фикс-расходы суммируются помесячно; «на ученика» множатся на учеников за поток
    fixed_monthly = sum(
        (_to_base(c.amount, c.currency, rates) for c in costs if c.kind == "monthly"),
        Decimal("0"),
    )
    per_student_base = sum(
        (_to_base(c.amount, c.currency, rates) for c in costs if c.kind == "per_student"),
        Decimal("0"),
    )
    variable_monthly = per_student_base * students_total / months

    gross_monthly = gross_per_cohort / months
    cost_monthly = fixed_monthly + variable_monthly
    net_monthly = gross_monthly - cost_monthly
    net_per_cohort = net_monthly * months

    return CourseResult(
        students_total=students_total,
        gross_per_cohort=gross_per_cohort,
        gross_monthly=gross_monthly,
        fixed_monthly=fixed_monthly,
        variable_monthly=variable_monthly,
        cost_monthly=cost_monthly,
        net_monthly=net_monthly,
        net_per_cohort=net_per_cohort,
        by_tariff=by_tariff,
    )
