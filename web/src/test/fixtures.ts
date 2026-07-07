// Канонические ответы API для smoke-тестов (формы соответствуют web/src/lib/api.ts).
const today = "2026-06-14"
const iso = (d: number) => {
  const dt = new Date("2026-06-14T00:00:00")
  dt.setDate(dt.getDate() + d)
  return dt.toISOString().slice(0, 10)
}

function forecastSeries(n: number, start: number, slope: number) {
  return Array.from({ length: n + 1 }, (_, i) => [iso(i), start + slope * i] as [string, number])
}

export const fixtures: Record<string, unknown> = {
  "/summary": {
    t0: 18400,
    t0_by_currency: { USD: 16000, USDT: 2400 },
    burn_weekly: 700,
    burn_source: "derived",
    gap_amount: 0,
    gap_deadline: null,
    last_snapshot_date: today,
    snapshot_stale: false,
    missing_rates: [],
    rates_date: today,
    base_currency: "USD",
    cushion: 4000,
    horizon_days: 180,
    scenarios: {
      pessimistic: { min_total: -9000, min_date: iso(170), cushion_breach_date: iso(120), breakdown: { t0: 18400, burn: 1, obligations: 1, inflows: 1 } },
      base: { min_total: 7000, min_date: iso(150), cushion_breach_date: null, breakdown: { t0: 18400, burn: 1, obligations: 1, inflows: 1 } },
      optimistic: { min_total: 18000, min_date: iso(10), cushion_breach_date: null, breakdown: { t0: 18400, burn: 1, obligations: 1, inflows: 1 } },
    },
  },
  "/forecast": {
    cushion: 4000,
    scenarios: {
      base: forecastSeries(180, 18400, -40),
      optimistic: forecastSeries(180, 18400, 30),
      pessimistic: forecastSeries(180, 18400, -160),
    },
  },
  "/accounts": [
    { id: 1, name: "Wise", currency: "USD", type: "bank", sort_order: 1 },
    { id: 2, name: "USDT · TRC-20", currency: "USDT", type: "crypto", sort_order: 2 },
  ],
  "/snapshots/last": {
    taken_at: today,
    items: [
      { account_id: 1, account: "Wise", currency: "USD", amount: 9200 },
      { account_id: 2, account: "USDT · TRC-20", currency: "USDT", amount: 6800 },
    ],
  },
  "/snapshots/history": { base_currency: "USD", items: [{ date: today, total: 18400 }] },
  "/snapshots/prefill": {
    items: [{ account_id: 1, account: "Wise", currency: "USD", amount: 9200, taken_at: today }],
  },
  "/income": {
    base_currency: "USD",
    total: 5580,
    items: [
      { id: 1, date: iso(-32), name: "Acme Corp", counterparty: "Acme Corp", direction: "проекты", amount: 4000, currency: "USD", amount_base: 4000 },
      { id: 2, date: iso(-40), name: "Консультация", counterparty: "Стартап X", direction: "консалтинг", amount: 1000, currency: "USD", amount_base: 1000 },
    ],
    by_direction: { проекты: 4000, консалтинг: 1000 },
    by_month: { "2026-05": 5000, "2026-06": 4420 },
    expected: {
      by_probability: { confirmed: 4420, likely: 3800, possible: 3400 },
      by_month: { "2026-06": 4420, "2026-07": 3800 },
      total: 11620,
      weighted: 7400,
    },
  },
  "/inflows": [
    { id: 1, name: "Acme Corp · инвойс", amount: 3800, currency: "USD", expected_date: iso(7), probability: "confirmed", recurrence: "once", recurrence_end: null, status: "expected", counterparty: "Acme Corp", direction: "проекты", note: null },
    { id: 2, name: "Продукт · MRR", amount: 620, currency: "USD", expected_date: iso(10), probability: "confirmed", recurrence: "monthly", recurrence_end: null, status: "expected", counterparty: "Свой продукт", direction: "продукт", note: null },
    { id: 3, name: "Acme Corp · проект", amount: 4000, currency: "USD", expected_date: iso(-32), probability: "confirmed", recurrence: "once", recurrence_end: null, status: "received", counterparty: "Acme Corp", direction: "проекты", note: null },
    { id: 4, name: "EU клиент", amount: 1000, currency: "EUR", expected_date: iso(15), probability: "likely", recurrence: "once", recurrence_end: null, status: "expected", counterparty: "EU клиент", direction: "проекты", note: null },
  ],
  "/expenses": {
    base_currency: "USD",
    by_category: { Жильё: 1800, Инфраструктура: 1120, Еда: 700, Подписки: 180, Прочее: 300 },
    monthly_obligations: 4100,
    burn_monthly: 1300,
    required_monthly_income: 5400,
    one_off_total: 2700,
    one_off_count: 2,
  },
  "/obligations": [
    { id: 1, name: "Аренда", amount: 1800, currency: "USD", due_date: iso(5), recurrence: "monthly", recurrence_end: null, status: "planned", category: "Жильё", note: null },
    { id: 2, name: "API", amount: 900, currency: "USD", due_date: iso(12), recurrence: "monthly", recurrence_end: null, status: "planned", category: "Инфраструктура", note: null },
    { id: 3, name: "Конференция", amount: 1500, currency: "USD", due_date: iso(45), recurrence: "once", recurrence_end: null, status: "planned", category: "Поездки", note: null },
    { id: 4, name: "Аренда Москва", amount: 90000, currency: "RUB", due_date: iso(5), recurrence: "monthly", recurrence_end: null, status: "planned", category: "Жильё", note: null },
  ],
  "/wishes": {
    base_currency: "USD",
    total: 39000,
    items: [
      { id: 1, name: "MacBook Pro M4 Max", amount: 2500, currency: "USD", amount_base: 2500, priority: "high", target_date: iso(60), category: "Техника", note: null, image_url: null, image_source: null, card_size: "large", sort_order: 1 },
      { id: 2, name: "Камера Sony A7 IV", amount: 2200, currency: "USD", amount_base: 2200, priority: "medium", target_date: iso(90), category: "Техника", note: null, image_url: null, image_source: null, card_size: "tall", sort_order: 2 },
      { id: 3, name: "Велосипед", amount: 450000, currency: "KZT", amount_base: 900, priority: "low", target_date: iso(120), category: "Спорт", note: null, image_url: null, image_source: null, card_size: null, sort_order: 3 },
    ],
    by_priority: { high: 32500, medium: 5600, low: 900 },
  },
  "/rates": {
    base_currency: "USD",
    rates: [
      { currency: "USD", rate_to_base: 1, rate_date: today, used: true, is_base: true },
      { currency: "USDT", rate_to_base: 1, rate_date: today, used: true, is_base: false },
      { currency: "RUB", rate_to_base: 0.0105263, rate_date: today, used: true, is_base: false },
      { currency: "EUR", rate_to_base: 1.08, rate_date: today, used: false, is_base: false },
    ],
    missing: [],
  },
  "/categories": [
    { id: 1, name: "Жильё" },
    { id: 2, name: "Инфраструктура" },
  ],
  "/directions": [
    { id: 1, name: "проекты" },
    { id: 2, name: "консалтинг" },
  ],
  "/course": {
    base_currency: "USD",
    cohort_months: 2,
    students_total: 30,
    gross_per_cohort: 28600,
    gross_monthly: 14300,
    fixed_monthly: 800,
    variable_monthly: 450,
    cost_monthly: 1250,
    net_monthly: 13050,
    net_per_cohort: 26100,
    required_monthly_income: 5400,
    net_vs_required: 7650,
    one_off_total: 2700,
    one_off_count: 2,
    gap_amount: 0,
    tariffs: [
      { id: 1, name: "Базовый", price: 500, currency: "USD", students: 20, gross_base: 10000 },
      { id: 2, name: "Про", price: 1200, currency: "USD", students: 8, gross_base: 9600 },
    ],
    costs: [
      { id: 1, name: "Реклама", amount: 500, currency: "USD", kind: "monthly", monthly_base: 500 },
      { id: 2, name: "Проверка работ", amount: 30, currency: "USD", kind: "per_student", monthly_base: 450 },
    ],
    missing_rates: [],
  },
  "/services": [
    { id: 1, name: "TrendWatcher", note: "monitoring + reports" },
  ],
  "/services/1/summary": {
    service: { id: 1, name: "TrendWatcher", note: "monitoring + reports" },
    base_currency: "USD",
    mrr: 790,
    fixed_monthly: 120,
    per_client_monthly: 50,
    per_unit_monthly: 38,
    cogs_monthly: 208,
    net_monthly: 582,
    margin_pct: 0.7367,
    clients_total: 10,
    required_monthly_income: 5400,
    net_vs_required: -4818,
    missing_rates: [],
    tariffs: [
      {
        id: 1,
        name: "Managed",
        price: 79,
        currency: "USD",
        clients: 10,
        is_byo: false,
        usage: { "3": 1000 },
        mrr_base: 790,
        var_cost_base: 88,
        net_per_client: 58.2,
      },
    ],
    costs: [
      { id: 1, name: "Hosting", amount: 120, currency: "USD", kind: "fixed", unit_label: null, unit_size: 1 },
      { id: 2, name: "Support", amount: 5, currency: "USD", kind: "per_client", unit_label: null, unit_size: 1 },
      { id: 3, name: "Apify", amount: 3.8, currency: "USD", kind: "per_unit", unit_label: "роликов", unit_size: 1000 },
    ],
  },
  "/settings": {
    base_currency: "USD",
    cushion: 4000,
    horizon_days: 180,
    manual_burn_weekly: null,
    display_name: "Тест Профиль",
  },
}

export function fixtureFor(path: string): unknown {
  const clean = path.split("?")[0]
  if (clean in fixtures) return fixtures[clean]
  // динамические/неизвестные пути: безопасный дефолт
  return {}
}
