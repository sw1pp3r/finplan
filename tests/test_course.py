from decimal import Decimal as D

from app.course import Cost, Tariff, compute_course

RATES = {"USD": D("1"), "KZT": D("0.002")}


def cc(**kw):
    defaults = dict(
        tariffs=[],
        cohort_months=1,
        costs=[],
        rates=RATES,
    )
    defaults.update(kw)
    return compute_course(**defaults)


def test_single_tariff_monthly_cohort_no_costs():
    r = cc(tariffs=[Tariff("Базовый", D("500"), "USD", 10)])
    assert r.students_total == 10
    assert r.gross_per_cohort == D("5000")
    assert r.gross_monthly == D("5000")
    assert r.net_monthly == D("5000")


def test_cohort_every_two_months_normalizes_monthly():
    r = cc(tariffs=[Tariff("Поток", D("1000"), "USD", 6)], cohort_months=2)
    assert r.gross_per_cohort == D("6000")
    assert r.gross_monthly == D("3000")  # 6000 за 2 месяца
    assert r.net_monthly == D("3000")


def test_fixed_and_per_student_costs_subtract():
    r = cc(
        tariffs=[Tariff("Про", D("1000"), "USD", 4)],
        costs=[
            Cost("Реклама", D("500"), "USD", "monthly"),
            Cost("Проверка работ", D("50"), "USD", "per_student"),
        ],
    )
    assert r.gross_monthly == D("4000")
    assert r.fixed_monthly == D("500")
    assert r.variable_monthly == D("200")  # 50 × 4 ученика / 1 мес
    assert r.cost_monthly == D("700")
    assert r.net_monthly == D("3300")


def test_multiple_monthly_costs_sum():
    r = cc(
        tariffs=[Tariff("Базовый", D("1000"), "USD", 3)],
        costs=[
            Cost("Реклама", D("300"), "USD", "monthly"),
            Cost("Площадка", D("100"), "USD", "monthly"),
            Cost("Ассистент", D("200"), "USD", "monthly"),
        ],
    )
    assert r.fixed_monthly == D("600")
    assert r.net_monthly == D("2400")  # 3000 − 600


def test_tariff_currency_converted_to_base():
    r = cc(tariffs=[Tariff("KZT-тариф", D("200000"), "KZT", 5)])
    assert r.gross_per_cohort == D("2000")  # 200000 × 0.002 × 5
    assert r.net_monthly == D("2000")


def test_cost_converted_from_its_currency():
    r = cc(
        tariffs=[Tariff("Базовый", D("1000"), "USD", 2)],
        costs=[Cost("Реклама", D("100000"), "KZT", "monthly")],
    )
    assert r.fixed_monthly == D("200")  # 100000 × 0.002
    assert r.net_monthly == D("1800")  # 2000 − 200


def test_multiple_tariffs_sum_and_breakdown():
    r = cc(tariffs=[
        Tariff("Базовый", D("500"), "USD", 10),
        Tariff("VIP", D("1500"), "USD", 3),
    ])
    assert r.students_total == 13
    assert r.gross_per_cohort == D("9500")
    assert r.net_monthly == D("9500")
    assert r.by_tariff == [
        {"name": "Базовый", "students": 10, "price": D("500"), "currency": "USD", "gross_base": D("5000")},
        {"name": "VIP", "students": 3, "price": D("1500"), "currency": "USD", "gross_base": D("4500")},
    ]


def test_empty_tariffs_with_fixed_cost_is_negative():
    r = cc(tariffs=[], costs=[Cost("Реклама", D("500"), "USD", "monthly")])
    assert r.students_total == 0
    assert r.gross_monthly == D("0")
    assert r.net_monthly == D("-500")


def test_net_per_cohort_consistent_with_monthly():
    r = cc(
        tariffs=[Tariff("Поток", D("1000"), "USD", 5)],
        cohort_months=3,
        costs=[
            Cost("Реклама", D("200"), "USD", "monthly"),
            Cost("Поддержка", D("100"), "USD", "per_student"),
        ],
    )
    # за поток: выручка 5000, расходы = fixed 200×3 + var 100×5 = 600+500 = 1100
    assert r.net_per_cohort == D("3900")
    assert r.net_monthly == D("1300")  # 3900 / 3
