"""Пресеты сервисов: готовые наборы строк COGS + тарифов-заготовок.

Цифры TrendWatcher — плейсхолдеры до появления docs/superpowers/specs/*product-saas-spec*
в репо 40-client-work/04-azamat-trandwatcher (обновить оттуда, когда появится).
"""
from decimal import Decimal

from .db import Service, ServiceCost, ServiceTariff, ServiceTariffUsage

# cost: (name, amount, currency, kind, unit_label, unit_size)
# tariff: (name, price, currency, clients, is_byo, usage {cost-name: units/клиента/мес})
PRESETS = {
    "trendwatcher": {
        "name": "TrendWatcher",
        "note": "юнит-экономика; цифры-плейсхолдеры до product-saas-spec",
        "costs": [
            ("Apify (скрейпинг)", Decimal("3.80"), "USD", "per_unit", "роликов", 1000),
            ("LLM-метр", Decimal("1.00"), "USD", "per_unit", "вызовов", 1000),
            ("YouTube-квота (лимит, не деньги)", Decimal("0.01"), "USD", "fixed", None, 1),
            ("Хостинг", Decimal("20"), "USD", "fixed", None, 1),
        ],
        "tariffs": [
            ("Managed", Decimal("99"), "USD", 0, False,
             {"Apify (скрейпинг)": Decimal("5000"), "LLM-метр": Decimal("2000")}),
            ("BYO keys", Decimal("49"), "USD", 0, True,
             {"Apify (скрейпинг)": Decimal("0"), "LLM-метр": Decimal("0")}),
        ],
    },
}


def apply_preset(db, preset_key: str) -> Service:
    p = PRESETS[preset_key]
    svc = Service(name=p["name"], note=p["note"])
    db.add(svc)
    db.flush()
    cost_ids = {}
    for i, (name, amount, cur, kind, unit_label, unit_size) in enumerate(p["costs"]):
        c = ServiceCost(service_id=svc.id, name=name, amount=amount, currency=cur,
                        kind=kind, unit_label=unit_label, unit_size=unit_size, sort_order=i)
        db.add(c)
        db.flush()
        cost_ids[name] = c.id
    for i, (name, price, cur, clients, is_byo, usage) in enumerate(p["tariffs"]):
        t = ServiceTariff(service_id=svc.id, name=name, price=price, currency=cur,
                          clients=clients, is_byo=is_byo, sort_order=i)
        db.add(t)
        db.flush()
        for cost_name, units in usage.items():
            db.add(ServiceTariffUsage(tariff_id=t.id, cost_id=cost_ids[cost_name],
                                      units_per_client_month=units))
    return svc
