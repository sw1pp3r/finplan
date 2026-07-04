"""Чистый калькулятор юнит-экономики сервиса: MRR − COGS → прибыль/мес.

Песочница «что если» по образу course.py: не трогает прогноз. COGS из трёх
видов статей: fixed (фикс/мес), per_client (на клиента/мес), per_unit (цена за
unit_size юнитов × потребление usage[cost_id] юнитов/клиента/мес × клиенты).
"""
from dataclasses import dataclass, field
from decimal import Decimal


@dataclass(frozen=True)
class SvcCost:
    id: int
    name: str
    amount: Decimal
    currency: str
    kind: str = "fixed"  # fixed | per_client | per_unit
    unit_size: int = 1


@dataclass(frozen=True)
class SvcTariff:
    name: str
    price: Decimal
    currency: str
    clients: int
    is_byo: bool = False
    usage: dict = field(default_factory=dict)  # cost_id -> Decimal юнитов/клиента/мес


@dataclass
class ServiceResult:
    mrr: Decimal
    fixed_monthly: Decimal
    per_client_monthly: Decimal
    per_unit_monthly: Decimal
    cogs_monthly: Decimal
    net_monthly: Decimal
    margin_pct: Decimal | None
    clients_total: int
    by_tariff: list  # [{name, clients, price, currency, is_byo, mrr_base, var_cost_base, net_per_client}]


def _to_base(amount: Decimal, currency: str, rates: dict) -> Decimal:
    return amount * rates.get(currency, Decimal("0"))


def compute_service(*, tariffs: list, costs: list, rates: dict) -> ServiceResult:
    zero = Decimal("0")
    per_unit_costs = [c for c in costs if c.kind == "per_unit"]
    per_client_base = sum(
        (_to_base(c.amount, c.currency, rates) for c in costs if c.kind == "per_client"), zero
    )
    fixed_monthly = sum(
        (_to_base(c.amount, c.currency, rates) for c in costs if c.kind == "fixed"), zero
    )

    mrr, clients_total = zero, 0
    per_client_monthly, per_unit_monthly = zero, zero
    by_tariff = []
    for t in tariffs:
        price_base = _to_base(t.price, t.currency, rates)
        t_mrr = price_base * t.clients
        t_per_client = per_client_base * t.clients
        t_per_unit = sum(
            (_to_base(c.amount, c.currency, rates) / max(1, c.unit_size)
             * t.usage.get(c.id, zero) * t.clients
             for c in per_unit_costs),
            zero,
        )
        per_client_var = per_client_base + sum(
            (_to_base(c.amount, c.currency, rates) / max(1, c.unit_size)
             * t.usage.get(c.id, zero)
             for c in per_unit_costs),
            zero,
        )
        mrr += t_mrr
        clients_total += t.clients
        per_client_monthly += t_per_client
        per_unit_monthly += t_per_unit
        var_cost = t_per_client + t_per_unit
        by_tariff.append({
            "name": t.name, "clients": t.clients, "price": t.price,
            "currency": t.currency, "is_byo": t.is_byo,
            "mrr_base": t_mrr, "var_cost_base": var_cost,
            "net_per_client": price_base - per_client_var,
        })

    cogs = fixed_monthly + per_client_monthly + per_unit_monthly
    net = mrr - cogs
    return ServiceResult(
        mrr=mrr, fixed_monthly=fixed_monthly,
        per_client_monthly=per_client_monthly, per_unit_monthly=per_unit_monthly,
        cogs_monthly=cogs, net_monthly=net,
        margin_pct=(net / mrr) if mrr else None,
        clients_total=clients_total, by_tariff=by_tariff,
    )
