"""Модели и фабрика подключения. SQLite по умолчанию, Postgres через DATABASE_URL."""
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    currency: Mapped[str] = mapped_column(String(12))
    type: Mapped[str] = mapped_column(String(10), default="bank")  # bank | cash | broker
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)


class SnapshotRow(Base):
    __tablename__ = "snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    taken_at: Mapped[date] = mapped_column(Date, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))


class ObligationRow(Base):
    __tablename__ = "obligations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(12))
    due_date: Mapped[date] = mapped_column(Date)
    recurrence: Mapped[str] = mapped_column(String(10), default="once")  # once | monthly | yearly
    recurrence_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="planned")  # planned | paid | cancelled
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)  # категория расхода
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)


class InflowRow(Base):
    __tablename__ = "inflows"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(12))
    expected_date: Mapped[date] = mapped_column(Date)
    probability: Mapped[str] = mapped_column(String(10), default="confirmed")  # confirmed | likely | possible
    status: Mapped[str] = mapped_column(String(10), default="expected")  # expected | received | lost
    recurrence: Mapped[str] = mapped_column(String(10), default="once")  # once | weekly | monthly | yearly
    recurrence_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    counterparty: Mapped[str | None] = mapped_column(String(120), nullable=True)  # от кого
    direction: Mapped[str | None] = mapped_column(String(80), nullable=True)  # направление (acme, обучение…)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)


class FxRate(Base):
    __tablename__ = "fx_rates"
    id: Mapped[int] = mapped_column(primary_key=True)
    rate_date: Mapped[date] = mapped_column(Date, index=True)
    currency: Mapped[str] = mapped_column(String(12))
    rate_to_base: Mapped[Decimal] = mapped_column(Numeric(18, 8))


class Wish(Base):
    """Хотелки — желаемые покупки, не влияют на прогноз, пока не promote в расход."""
    __tablename__ = "wishes"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(12))
    priority: Mapped[str] = mapped_column(String(10), default="medium")  # high | medium | low
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | bought | dropped
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_source: Mapped[str | None] = mapped_column(String(40), nullable=True)  # manual | upload | codex
    card_size: Mapped[str | None] = mapped_column(String(12), nullable=True)  # формат плитки на Доске: small|square|tall|wide|large (null/auto → по приоритету)
    sort_order: Mapped[int] = mapped_column(default=0)  # ручной порядок на Доске (меньше = раньше)


class Direction(Base):
    """Справочник направлений дохода (acme, обучение AI-агентам…)."""
    __tablename__ = "directions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class Category(Base):
    """Справочник категорий расхода (Жильё, Налоги…)."""
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class SettingsRow(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    base_currency: Mapped[str] = mapped_column(String(12), default="USD")
    cushion: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    horizon_days: Mapped[int] = mapped_column(default=180)
    manual_burn_weekly: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)  # имя пользователя (профиль)


class CourseTariff(Base):
    """Тариф курса в песочнице-декомпозиции: цена × ожидаемое число учеников за поток."""
    __tablename__ = "course_tariffs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    price: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(12))
    students: Mapped[int] = mapped_column(default=0)
    sort_order: Mapped[int] = mapped_column(default=0)


class CourseCost(Base):
    """Строка расхода курса: фикс/мес или на ученика за поток (kind)."""
    __tablename__ = "course_costs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(12))
    kind: Mapped[str] = mapped_column(String(12), default="monthly")  # monthly | per_student
    sort_order: Mapped[int] = mapped_column(default=0)


class CourseConfigRow(Base):
    """Скаляры песочницы курса (singleton id=1): частота потоков."""
    __tablename__ = "course_config"
    id: Mapped[int] = mapped_column(primary_key=True)
    cohort_months: Mapped[int] = mapped_column(default=2)  # поток раз в N месяцев


class Service(Base):
    """Сервис в песочнице юнит-экономики (TrendWatcher и т.п.). Прогноз не трогает."""
    __tablename__ = "services"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)


class ServiceCost(Base):
    """Статья затрат сервиса: фикс/мес, на клиента/мес или за юнит потребления."""
    __tablename__ = "service_costs"
    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(12))
    kind: Mapped[str] = mapped_column(String(12), default="fixed")  # fixed | per_client | per_unit
    unit_label: Mapped[str | None] = mapped_column(String(40), nullable=True)  # «роликов» (per_unit)
    unit_size: Mapped[int] = mapped_column(default=1)  # цена задана за unit_size юнитов
    sort_order: Mapped[int] = mapped_column(default=0)


class ServiceTariff(Base):
    """Тариф сервиса: цена × число клиентов; BYO — клиент со своими ключами."""
    __tablename__ = "service_tariffs"
    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    price: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(12))
    clients: Mapped[int] = mapped_column(default=0)
    is_byo: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(default=0)


class ServiceTariffUsage(Base):
    """Потребление per_unit-драйвера одним клиентом тарифа, юнитов/мес."""
    __tablename__ = "service_tariff_usage"
    id: Mapped[int] = mapped_column(primary_key=True)
    tariff_id: Mapped[int] = mapped_column(ForeignKey("service_tariffs.id"), index=True)
    cost_id: Mapped[int] = mapped_column(ForeignKey("service_costs.id"), index=True)
    units_per_client_month: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))


def make_engine(url: str):
    if url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        is_memory = url in ("sqlite://", "sqlite:///:memory:") or ":memory:" in url
        if is_memory:
            # StaticPool: одна и та же in-memory база для всех коннектов (тесты)
            return create_engine(url, connect_args=connect_args, poolclass=StaticPool)
        # файловая dev-БД: пул по коннекту на запрос, иначе общий коннект бьётся
        # при конкурентных запросах ("another row available", дашборд шлёт 4 разом)
        return create_engine(url, connect_args=connect_args)
    return create_engine(url, pool_pre_ping=True)


DEFAULT_DIRECTIONS = ["acme", "обучение AI-агентам"]
DEFAULT_CATEGORIES = ["Жильё", "Образование", "Налоги", "Путешествия", "Страховки", "Прочее"]

# колонки валют, расширенные с varchar(3) → varchar(12) (USDT/прочие тикеры не влезали)
_CURRENCY_COLUMNS = {
    "accounts": "currency", "obligations": "currency",
    "inflows": "currency", "fx_rates": "currency", "settings": "base_currency",
}


def _ensure_columns(engine):
    """Лёгкая миграция existing-баз: новые колонки + расширение varchar валют на Postgres."""
    from sqlalchemy import inspect, text

    add_columns = {
        "inflows": {"counterparty": "VARCHAR(120)", "direction": "VARCHAR(80)",
                    "recurrence": "VARCHAR(10) DEFAULT 'once' NOT NULL", "recurrence_end": "DATE"},
        "obligations": {"category": "VARCHAR(80)"},
        "wishes": {"image_url": "VARCHAR(500)", "image_source": "VARCHAR(40)", "card_size": "VARCHAR(12)", "sort_order": "INTEGER DEFAULT 0"},
        "settings": {"display_name": "VARCHAR(120)"},
    }
    insp = inspect(engine)
    is_pg = engine.dialect.name == "postgresql"
    with engine.begin() as conn:
        for table, columns in add_columns.items():
            existing = {c["name"] for c in insp.get_columns(table)}
            for col, ddl in columns.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
        # Паритет fresh↔migrated схемы для NOT NULL-колонок модели (#21): добиваем дефолтами
        # уже просочившиеся NULL и на Postgres доводим колонку до NOT NULL, как в модели.
        # На SQLite sort_order остаётся nullable (ALTER не поддержан) — её страхует
        # coalesce в wishes_summary (#20).
        conn.execute(text("UPDATE wishes SET sort_order = 0 WHERE sort_order IS NULL"))
        conn.execute(text("UPDATE inflows SET recurrence = 'once' WHERE recurrence IS NULL"))
        if is_pg:
            conn.execute(text("ALTER TABLE wishes ALTER COLUMN sort_order SET NOT NULL"))
            conn.execute(text("ALTER TABLE inflows ALTER COLUMN recurrence SET NOT NULL"))
            # SQLite не enforce-ит длину varchar и не умеет ALTER TYPE — расширяем только PG
            for table, col in _CURRENCY_COLUMNS.items():
                conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE VARCHAR(12)"))


def _seed_reference(db):
    existing_dir = {d.name for d in db.scalars(select(Direction)).all()}
    for name in DEFAULT_DIRECTIONS:
        if name not in existing_dir:
            db.add(Direction(name=name))
    existing_cat = {c.name for c in db.scalars(select(Category)).all()}
    for name in DEFAULT_CATEGORIES:
        if name not in existing_cat:
            db.add(Category(name=name))


def init_db(engine, seed: bool = True):
    Base.metadata.create_all(engine)
    _ensure_columns(engine)
    with sessionmaker(bind=engine)() as db:
        if db.scalar(select(SettingsRow).limit(1)) is None:
            db.add(SettingsRow(id=1))
        if db.scalar(select(CourseConfigRow).limit(1)) is None:
            db.add(CourseConfigRow(id=1))
        if seed and db.scalar(select(Direction).limit(1)) is None and db.scalar(select(Category).limit(1)) is None:
            _seed_reference(db)
        db.commit()
