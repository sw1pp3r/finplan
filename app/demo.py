"""Демо-датасет для режима показа: правдоподобный фейк, без реальных финансов.

Персона: **Артём Кравцов — Indie / AI Builder**. Счета в USD/USDT + рублёвая карта
(~$18 400). Доходы рывками: проект Acme, MRR продукта, консалтинг. Расходы — аренда,
API-биллинг, облако, подписки (~$4 100/мес). Прогноз «пилит»; осторожный сценарий
(только подтверждённые поступления) уходит в минус.

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

    wise = Account(name="Wise", currency="USD", type="bank", sort_order=1)
    usdt = Account(name="USDT · TRC-20", currency="USDT", type="crypto", sort_order=2)
    card = Account(name="Карта", currency="RUB", type="bank", sort_order=3)
    db.add_all([wise, usdt, card])
    db.flush()

    db.add_all([
        FxRate(rate_date=today, currency="USDT", rate_to_base=Decimal("1")),
        FxRate(rate_date=today, currency="RUB", rate_to_base=Decimal("0.0105263")),
        FxRate(rate_date=today, currency="EUR", rate_to_base=Decimal("1.08")),
    ])

    # 5 недельных снимков: повседневный burn ≈ $300/нед (USDT/карта стабильны, тратит с Wise).
    # totals (USD-база): 19 600 → 18 400, ровно −$300/нед.
    balances = [
        (28, 10400, 6800, 228000),
        (21, 10100, 6800, 228000),
        (14, 9800, 6800, 228000),
        (7, 9500, 6800, 228000),
        (0, 9200, 6800, 228000),
    ]
    for days_ago, w, u, r in balances:
        d = today - timedelta(days=days_ago)
        db.add_all([
            SnapshotRow(taken_at=d, account_id=wise.id, amount=Decimal(w)),
            SnapshotRow(taken_at=d, account_id=usdt.id, amount=Decimal(u)),
            SnapshotRow(taken_at=d, account_id=card.id, amount=Decimal(r)),
        ])

    # Обязательства: фиксированные ежемесячные (~$4 100/мес) + годовые + разовые.
    db.add_all([
        ObligationRow(name="Аренда", amount=Decimal("1800"), currency="USD",
                      due_date=today + timedelta(days=5), recurrence="monthly", category="Жильё"),
        ObligationRow(name="API · Anthropic / OpenAI", amount=Decimal("900"), currency="USD",
                      due_date=today + timedelta(days=12), recurrence="monthly", category="Инфраструктура"),
        ObligationRow(name="Продукты", amount=Decimal("700"), currency="USD",
                      due_date=today + timedelta(days=3), recurrence="monthly", category="Еда"),
        ObligationRow(name="Прочее", amount=Decimal("300"), currency="USD",
                      due_date=today + timedelta(days=9), recurrence="monthly", category="Прочее"),
        ObligationRow(name="VPS и облако", amount=Decimal("220"), currency="USD",
                      due_date=today + timedelta(days=8), recurrence="monthly", category="Инфраструктура"),
        ObligationRow(name="Подписки (Claude, Cursor…)", amount=Decimal("180"), currency="USD",
                      due_date=today + timedelta(days=6), recurrence="monthly", category="Подписки"),
        ObligationRow(name="Страховка, год", amount=Decimal("1200"), currency="USD",
                      due_date=today + timedelta(days=60), recurrence="yearly", category="Страховки"),
        # разовое
        ObligationRow(name="Билеты на конференцию (SF)", amount=Decimal("1500"), currency="USD",
                      due_date=today + timedelta(days=45), category="Поездки"),
    ])

    # Ожидаемые поступления (пайплайн на Доходах + кривая сценариев).
    # confirmed → попадают в осторожный; likely/possible — только в базовый/оптимистичный.
    db.add_all([
        InflowRow(name="Acme Corp · инвойс", amount=Decimal("3800"), currency="USD",
                  expected_date=today + timedelta(days=7), probability="confirmed",
                  counterparty="Acme Corp", direction="проекты"),
        InflowRow(name="Продукт · MRR", amount=Decimal("620"), currency="USD",
                  expected_date=today + timedelta(days=10), probability="confirmed",
                  recurrence="monthly", counterparty="Свой продукт", direction="продукт"),
        InflowRow(name="Acme Corp · ретейнер", amount=Decimal("3800"), currency="USD",
                  expected_date=today + timedelta(days=37), probability="likely",
                  recurrence="monthly", counterparty="Acme Corp", direction="проекты"),
        InflowRow(name="Консалтинг", amount=Decimal("1000"), currency="USD",
                  expected_date=today + timedelta(days=20), probability="possible",
                  recurrence="monthly", counterparty="Разные клиенты", direction="консалтинг"),
        InflowRow(name="Nimbus · новый проект", amount=Decimal("2400"), currency="USD",
                  expected_date=today + timedelta(days=50), probability="possible",
                  counterparty="Nimbus", direction="проекты"),
    ])
    # Полученные факты — лента «Получено» + сводки по направлениям/месяцам.
    # Датированы РАНЬШЕ самого старого снимка (>28 дней назад), чтобы не раздуть burn.
    db.add_all([
        InflowRow(name="Acme Corp · проект (закрыт)", amount=Decimal("4000"), currency="USD",
                  expected_date=today - timedelta(days=32), status="received",
                  counterparty="Acme Corp", direction="проекты"),
        InflowRow(name="Консультация", amount=Decimal("1000"), currency="USD",
                  expected_date=today - timedelta(days=40), status="received",
                  counterparty="Стартап X", direction="консалтинг"),
        InflowRow(name="Продукт · MRR (май)", amount=Decimal("580"), currency="USD",
                  expected_date=today - timedelta(days=34), status="received",
                  counterparty="Свой продукт", direction="продукт"),
    ])

    # Мечты (вкладка Мечты) — не входят в прогноз. Разные card_size для Доски.
    db.add_all([
        Wish(name="MacBook Pro M4 Max", amount=Decimal("2500"), currency="USD", priority="high",
             target_date=today + timedelta(days=60), category="Техника", card_size="large"),
        Wish(name="Поездка на конференцию", amount=Decimal("1800"), currency="USD", priority="medium",
             target_date=today + timedelta(days=120), category="Поездки", card_size="wide"),
        Wish(name="Камера Sony A7 IV", amount=Decimal("2200"), currency="USD", priority="medium",
             target_date=today + timedelta(days=90), category="Техника", card_size="tall"),
        Wish(name="Монитор 5K", amount=Decimal("1600"), currency="USD", priority="low",
             target_date=today + timedelta(days=45), category="Техника", card_size="small"),
        Wish(name="Запас «спокойного года»", amount=Decimal("30000"), currency="USD", priority="high",
             target_date=today + timedelta(days=540), category="Подушка", card_size="square"),
    ])

    # Курс (песочница декомпозиции): тарифы + расходы строками + параметры потока.
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
        s.cushion = Decimal("4000")
        s.display_name = "Артём"  # демо-персона (AI Builder)
    db.commit()
