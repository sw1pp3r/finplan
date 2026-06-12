"""Демо-датасет для режима показа: правдоподобный фейк, без реальных финансов.

Один источник правды — используется и из create_app (in-memory демо-БД для X-Demo),
и из scripts/seed_demo.py (запись в demo.db для локальной разработки).
Лежит в app/ (а не в scripts/), потому что scripts/ исключён из прод-образа.
"""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from .db import (
    Account, CourseConfigRow, CourseCost, CourseTariff, FxRate, InflowRow, ObligationRow,
    SettingsRow, SnapshotRow, Wish,
)


def seed_demo_data(db: Session) -> None:
    """Наполняет сессию демо-данными. Идемпотентно: если счета уже есть — выходит."""
    if db.query(Account).count():
        return
    today = date.today()

    hsbc = Account(name="HSBC HK", currency="HKD", type="bank", sort_order=1)
    kaspi = Account(name="Kaspi", currency="KZT", type="bank", sort_order=2)
    ibkr = Account(name="IBKR", currency="USD", type="broker", sort_order=3)
    cash = Account(name="Cash", currency="HKD", type="cash", sort_order=4)
    db.add_all([hsbc, kaspi, ibkr, cash])
    db.flush()

    db.add_all([
        FxRate(rate_date=today, currency="HKD", rate_to_base=Decimal("0.1282")),
        FxRate(rate_date=today, currency="KZT", rate_to_base=Decimal("0.00196")),
        FxRate(rate_date=today, currency="EUR", rate_to_base=Decimal("1.08")),
    ])

    # 5 недельных снимков: лёгкое снижение ≈ $700/нед
    balances = [
        (28, 152000, 1450000, 16800, 9000),
        (21, 149500, 1410000, 16800, 7500),
        (14, 146000, 1395000, 16900, 6800),
        (7, 143500, 1360000, 16950, 5200),
        (0, 141000, 1330000, 17000, 4400),
    ]
    for days_ago, hkd, kzt, usd, cash_hkd in balances:
        d = today - timedelta(days=days_ago)
        db.add_all([
            SnapshotRow(taken_at=d, account_id=hsbc.id, amount=Decimal(hkd)),
            SnapshotRow(taken_at=d, account_id=kaspi.id, amount=Decimal(kzt)),
            SnapshotRow(taken_at=d, account_id=ibkr.id, amount=Decimal(usd)),
            SnapshotRow(taken_at=d, account_id=cash.id, amount=Decimal(cash_hkd)),
        ])

    # обязательства: recurring с категориями (наполняют разбивку по категориям на Расходах) + разовые
    db.add_all([
        ObligationRow(name="Аренда", amount=Decimal("18000"), currency="HKD",
                      due_date=today.replace(day=1) + timedelta(days=32), recurrence="monthly",
                      category="Жильё"),
        ObligationRow(name="Продукты", amount=Decimal("1800"), currency="HKD",
                      due_date=today + timedelta(days=3), recurrence="weekly", category="Еда"),
        ObligationRow(name="Спортзал", amount=Decimal("750"), currency="HKD",
                      due_date=today + timedelta(days=10), recurrence="monthly", category="Здоровье"),
        ObligationRow(name="Подписки (Claude, Spotify…)", amount=Decimal("80"), currency="USD",
                      due_date=today + timedelta(days=6), recurrence="monthly", category="Подписки"),
        ObligationRow(name="Страховка, год", amount=Decimal("2400"), currency="USD",
                      due_date=today + timedelta(days=95), recurrence="yearly", category="Страховки"),
        # разовые
        ObligationRow(name="Школа, семестр", amount=Decimal("4000"), currency="USD",
                      due_date=today + timedelta(days=20), category="Образование"),
        ObligationRow(name="Билеты HKG–ALA", amount=Decimal("1200"), currency="USD",
                      due_date=today + timedelta(days=45), category="Путешествия"),
        ObligationRow(name="Налог ИП", amount=Decimal("600000"), currency="KZT",
                      due_date=today + timedelta(days=70), category="Налоги"),
    ])
    # ожидаемые поступления (пайплайн на Доходах + кривая сценариев)
    db.add_all([
        InflowRow(name="Инвойс: клиент A", amount=Decimal("8000"), currency="USD",
                  expected_date=today + timedelta(days=12), probability="confirmed",
                  counterparty="Client A", direction="Консалтинг"),
        InflowRow(name="Курс: поток июль", amount=Decimal("5000"), currency="USD",
                  expected_date=today + timedelta(days=40), probability="likely",
                  counterparty="Курс", direction="Консалтинг"),
        InflowRow(name="Новый клиент (переговоры)", amount=Decimal("9000"), currency="USD",
                  expected_date=today + timedelta(days=75), probability="possible",
                  counterparty="Client B", direction="Фриланс"),
    ])
    # полученные факты — лента «Получено» + сводки по направлениям/месяцам.
    # Датированы РАНЬШЕ самого старого снимка (>28 дней назад), чтобы не раздуть расчётный burn.
    db.add_all([
        InflowRow(name="Client B, спринт", amount=Decimal("3000"), currency="USD",
                  expected_date=today - timedelta(days=30), status="received",
                  counterparty="Client B", direction="Фриланс"),
        InflowRow(name="Client A, обучение", amount=Decimal("40000"), currency="HKD",
                  expected_date=today - timedelta(days=33), status="received",
                  counterparty="Client A", direction="Консалтинг"),
        InflowRow(name="Консультация", amount=Decimal("1500"), currency="USD",
                  expected_date=today - timedelta(days=38), status="received",
                  counterparty="Client C", direction="Фриланс"),
        InflowRow(name="Курс: поток май", amount=Decimal("4500"), currency="USD",
                  expected_date=today - timedelta(days=45), status="received",
                  counterparty="Курс", direction="Консалтинг"),
    ])
    # покупки (вкладка Покупки) — не входят в прогноз
    db.add_all([
        # codex-картинки (сгенерены под эти мечты)
        Wish(name="MacBook Pro M4", amount=Decimal("2500"), currency="USD", priority="high",
             target_date=today + timedelta(days=30), category="Техника",
             image_url="/wishes/macbook-pro.webp", image_source="codex"),
        Wish(name="Отпуск в Японии", amount=Decimal("4000"), currency="USD", priority="medium",
             target_date=today + timedelta(days=120), category="Путешествия",
             image_url="/wishes/japan-trip.webp", image_source="codex"),
        Wish(name="Велосипед", amount=Decimal("450000"), currency="KZT", priority="low",
             target_date=today + timedelta(days=60), category="Спорт",
             image_url="/wishes/bicycle.webp", image_source="codex"),
        # keyword-фолбэки (картинка подбирается по категории/названию из bundled-набора)
        Wish(name="Своя квартира у моря", amount=Decimal("180000"), currency="USD", priority="high",
             target_date=today + timedelta(days=900), category="Жильё"),
        Wish(name="Путешествие по Европе", amount=Decimal("6000"), currency="EUR", priority="medium",
             target_date=today + timedelta(days=200), category="Путешествия"),
        Wish(name="Камера Sony A7", amount=Decimal("2200"), currency="USD", priority="medium",
             target_date=today + timedelta(days=90), category="Техника"),
        # без картинки — рисуется типографический градиент (третий путь рендера)
        Wish(name="Научиться играть на пианино", amount=Decimal("1500"), currency="USD", priority="low",
             target_date=today + timedelta(days=300), category="Хобби"),
        Wish(name="Запас «спокойного года»", amount=Decimal("40000"), currency="USD", priority="high",
             target_date=today + timedelta(days=540), category="Подушка"),
    ])

    # курс (песочница декомпозиции): тарифы + расходы строками + параметры потока
    db.add_all([
        CourseTariff(name="Базовый", price=Decimal("500"), currency="USD", students=20, sort_order=1),
        CourseTariff(name="Про", price=Decimal("1200"), currency="USD", students=8, sort_order=2),
        CourseTariff(name="VIP (с менторством)", price=Decimal("3000"), currency="USD", students=2, sort_order=3),
    ])
    db.add_all([
        CourseCost(name="Реклама", amount=Decimal("500"), currency="USD", kind="monthly", sort_order=1),
        CourseCost(name="Площадка + сервисы", amount=Decimal("300"), currency="USD", kind="monthly", sort_order=2),
        CourseCost(name="Проверка работ", amount=Decimal("30"), currency="USD", kind="per_student", sort_order=3),
    ])
    cfg = db.get(CourseConfigRow, 1)
    if cfg is not None:
        cfg.cohort_months = 2

    s = db.get(SettingsRow, 1)
    if s is not None:
        s.cushion = Decimal("10000")
    db.commit()
