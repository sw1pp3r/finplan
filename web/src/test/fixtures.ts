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

const twUsage = {
  low: { ig: 284, tt: 459, data: 1.39684, llm: 0.185, ytSearch: 4, ytGeneral: 207, ytLegacy: 607 },
  base: { ig: 2766, tt: 4382, data: 13.43824, llm: 0.925, ytSearch: 30, ytGeneral: 2242, ytLegacy: 5242 },
  stress: { ig: 4590, tt: 5870, data: 19.6648, llm: 2.9, ytSearch: 60, ytGeneral: 2490, ytLegacy: 8490 },
}

function twScenario(key: "low" | "base" | "stress", label: string) {
  const data = twUsage[key]
  const credits = data.ig + data.tt
  const provider = data.data + data.llm
  const fixed = 20
  const variable = 100
  const revenue = 990
  const contribution = revenue - variable - provider * 10
  const operatingProfit = contribution - fixed
  const packCount = Math.ceil((credits * 10) / 25_000)
  return {
    key,
    label,
    drivers: {
      instagram_accounts: 30, instagram_refreshes_per_month: 30,
      instagram_credits_per_refresh: 4, instagram_results_per_refresh: 13,
      manual_instagram_full_collections: 0, instagram_radar_runs: 0,
      instagram_credits_per_radar_run: 15, instagram_transcripts: 0,
      instagram_published_videos: 0,
      tiktok_accounts: 30, tiktok_refreshes_per_month: 30,
      tiktok_credits_per_refresh: 3, manual_tiktok_full_collections: 0,
      tiktok_discovery_runs: 0, tiktok_credits_per_discovery_run: 39,
      tiktok_transcripts: 0, tiktok_published_videos: 0,
      youtube_channels: 10, youtube_refreshes_per_month: 30,
      manual_youtube_full_collections: 0, youtube_radar_queries: 4,
      youtube_published_videos: 5, outcome_checks_per_video: 4,
      llm_calls: 100, llm_input_tokens_per_call: 2000, llm_output_tokens_per_call: 500,
      llm_annotated_videos: 100, llm_similarity_videos: 0,
      llm_profile_rebuilds: 0, llm_idea_candidates: 0, llm_manual_calls: 0,
    },
    usage: {
      instagram: {
        requests: data.ig, credits: data.ig, refresh_credits: data.ig, radar_credits: 0,
        transcript_credits: 0, outcome_credits: 0, unsupported_radar_runs: 0,
        cost_usd: data.ig * 0.00188,
      },
      tiktok: {
        requests: data.tt, credits: data.tt, refresh_credits: data.tt,
        discovery_credits: 0, transcript_credits: 0, outcome_credits: 0,
        cost_usd: data.tt * 0.00188,
      },
      apify: { results: 0, actor_runs: 0, cost_usd: 0 },
      llm: {
        provider: "openrouter/google-gemini-2.5-flash", calls: 100,
        base_calls: 100, billed_calls: 100,
        breakdown: { annotations: 100, similarity_batches: 0, profile: 0, ideas: 0, manual: 0 },
        input_tokens: 200000, output_tokens: 50000,
        inference_cost_usd: data.llm, platform_fee_usd: 0, cost_usd: data.llm,
      },
      youtube: { search_calls: data.ytSearch, general_quota_units: data.ytGeneral, internal_legacy_meter_units: data.ytLegacy, daily_general_limit: 10000, daily_search_limit: 100, cost_usd: null },
      scrapecreators_credits: credits,
      allowance: { limit_usd: 10, demand_usd: data.data, used_usd: Math.min(data.data, 10), remaining_usd: Math.max(0, 10 - data.data), overage_usd: Math.max(0, data.data - 10), max_whole_credits: 5319 },
      provider_cost_usd: provider,
    },
    economics: {
      mrr: revenue,
      revenue_monthly_base: revenue,
      generic_variable_monthly_base: variable,
      payment_fees_monthly_base: 0,
      fixed_monthly_base: fixed,
      provider_data_monthly_base: data.data * 10,
      provider_llm_monthly_base: data.llm * 10,
      provider_monthly_base: provider * 10,
      contribution_monthly_base: contribution,
      cogs_monthly: revenue - operatingProfit,
      cogs_per_client: (revenue - operatingProfit) / 10,
      net_monthly: operatingProfit,
      margin_pct: operatingProfit / revenue,
      gross_margin_pct: contribution / revenue,
      operating_profit_base: operatingProfit,
      by_tariff: [
        {
          id: 1, name: "Managed", is_byo: false, clients: 10, price_base: 99,
          provider_cogs_usd: provider, provider_cogs_base: provider,
          provider_data_per_client_base: data.data, provider_llm_per_client_base: data.llm,
          generic_variable_per_client_base: 10, fixed_allocation_per_client_base: 2,
          payment_fee_per_client_base: 0,
          cogs_per_client_base: 12 + provider, gross_margin_per_client_base: 87 - provider,
          contribution_per_client_base: 89 - provider, contribution_margin_pct: (89 - provider) / 99,
          break_even_clients: 1, net_per_client: 87 - provider,
          cac_payback_months: null, ltv_contribution_base: null, ltv_cac_ratio: null,
          unit_profit_per_client_base: 87 - provider, unit_margin_pct: (87 - provider) / 99,
        },
        {
          id: 2, name: "BYO keys", is_byo: true, clients: 0, price_base: 49,
          provider_cogs_usd: 0, provider_cogs_base: 0,
          provider_data_per_client_base: 0, provider_llm_per_client_base: 0,
          generic_variable_per_client_base: 10, fixed_allocation_per_client_base: 2,
          payment_fee_per_client_base: 0,
          cogs_per_client_base: 12, gross_margin_per_client_base: 37,
          contribution_per_client_base: 39, contribution_margin_pct: 39 / 49,
          break_even_clients: 1, net_per_client: 37,
          cac_payback_months: null, ltv_contribution_base: null, ltv_cac_ratio: null,
          unit_profit_per_client_base: 37, unit_margin_pct: 37 / 49,
        },
      ],
    },
    capacity: {
      starting_balance_credits: 0,
      monthly_demand_credits: credits * 10,
      shortfall_credits: credits * 10,
      pack_credits: 25_000,
      pack_price_usd: 47,
      packs_to_buy: packCount,
      next_topup_cash_usd: packCount * 47,
      ending_balance_credits: packCount * 25_000 - credits * 10,
      pack_implied_price_per_1000: 1.88,
      allocation_price_per_1000: 1.88,
      rate_mismatch: false,
    },
  }
}

const twLow = twScenario("low", "Low")
const twBase = twScenario("base", "Base")
const twStress = twScenario("stress", "Stress")

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
    { id: 1, name: "Аренда", amount: 1800, paid_amount: 0, remaining_amount: 1800, currency: "USD", due_date: iso(5), recurrence: "monthly", recurrence_end: null, status: "planned", category: "Жильё", note: null },
    { id: 2, name: "API", amount: 900, paid_amount: 0, remaining_amount: 900, currency: "USD", due_date: iso(12), recurrence: "monthly", recurrence_end: null, status: "planned", category: "Инфраструктура", note: null },
    { id: 3, name: "Конференция", amount: 1500, paid_amount: 600, remaining_amount: 900, currency: "USD", due_date: iso(45), recurrence: "once", recurrence_end: null, status: "planned", category: "Поездки", note: null },
    { id: 4, name: "Аренда Москва", amount: 90000, paid_amount: 0, remaining_amount: 90000, currency: "RUB", due_date: iso(5), recurrence: "monthly", recurrence_end: null, status: "planned", category: "Жильё", note: null },
  ],
  "/wishes": {
    base_currency: "USD",
    total: 39000,
    items: [
      { id: 1, name: "MacBook Pro M4 Max", amount: 2500, currency: "USD", amount_base: 2500, priority: "high", target_date: iso(60), category: "Техника", note: null, image_url: null, image_source: null, card_size: "large", sort_order: 1, status: "active", completed_at: null },
      { id: 2, name: "Камера Sony A7 IV", amount: 2200, currency: "USD", amount_base: 2200, priority: "medium", target_date: iso(90), category: "Техника", note: null, image_url: null, image_source: null, card_size: "tall", sort_order: 2, status: "active", completed_at: null },
      { id: 3, name: "Велосипед", amount: 450000, currency: "KZT", amount_base: 900, priority: "low", target_date: iso(120), category: "Спорт", note: null, image_url: null, image_source: null, card_size: null, sort_order: 3, status: "active", completed_at: null },
    ],
    completed_items: [
      { id: 4, name: "Рабочее кресло", amount: 900, currency: "USD", amount_base: 900, priority: "medium", target_date: null, category: "Дом", note: null, image_url: null, image_source: null, card_size: "square", sort_order: 4, status: "completed", completed_at: "2026-06-20" },
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
    { id: 1, name: "TrendWatcher", note: "monitoring + reports", preset_key: "trendwatcher", preset_version: 2 },
  ],
  "/services/1/summary": {
    service: { id: 1, name: "TrendWatcher", note: "monitoring + reports", preset_key: "trendwatcher", preset_version: 2 },
    base_currency: "USD",
    mrr: 990,
    fixed_monthly: 20,
    per_client_monthly: 100,
    per_unit_monthly: 0,
    provider_monthly: 143.6324,
    cogs_monthly: 263.6324,
    net_monthly: 726.3676,
    margin_pct: 0.7337046,
    clients_total: 10,
    required_monthly_income: 5400,
    net_vs_required: -4673.6324,
    missing_rates: [],
    tariffs: [
      {
        id: 1,
        name: "Managed",
        price: 99,
        currency: "USD",
        clients: 10,
        is_byo: false,
        usage: {},
        mrr_base: 990,
        var_cost_base: 100,
        net_per_client: 72.63676,
        provider_cogs_per_client: 14.36324,
        break_even_clients: 1,
      },
      {
        id: 2, name: "BYO keys", price: 49, currency: "USD", clients: 0,
        is_byo: true, usage: {}, mrr_base: 0, var_cost_base: 0,
        net_per_client: 37, provider_cogs_per_client: 0, break_even_clients: 1,
      },
    ],
    costs: [
      { id: 1, name: "Hosting", amount: 20, currency: "USD", kind: "fixed", unit_label: null, unit_size: 1 },
      { id: 2, name: "Support", amount: 10, currency: "USD", kind: "per_client", unit_label: null, unit_size: 1 },
    ],
    trendwatcher: {
      config: {
        active_scenario: "base", instagram_source: "scrapecreators",
        provider_allowance_usd: 10, scrapecreators_price_per_1000: 1.88,
        scrapecreators_pack_price_usd: 47, scrapecreators_pack_credits: 25000,
        scrapecreators_credit_balance: 0,
        apify_instagram_price_per_1000: 2.6, apify_actor_start_usd: 0.001,
        llm_provider: "openrouter/google-gemini-2.5-flash",
        llm_input_usd_per_million: 0.3, llm_output_usd_per_million: 2.5,
        llm_retry_overhead_pct: 0, llm_platform_fee_pct: 0,
        payment_fee_pct: 0, payment_fee_fixed_usd: 0,
        monthly_churn_pct: 0, cac_per_client_usd: 0,
        youtube_daily_general_units: 10000, youtube_daily_search_calls: 100,
      },
      pricing_basis: {
        scrapecreators: "verified", apify: "editable assumption",
        llm: "model-specific", youtube: "non-monetary quota", commercial: "editable assumptions",
      },
      pricing_sources: {
        scrapecreators: {
          status: "verified", label: "Freelance $1.88 / 1,000 credits",
          url: "https://scrapecreators.com/#pricing", checked_on: "2026-07-23",
        },
        apify: {
          status: "assumption", label: "Редактируемая ставка выбранного actor/tier",
          url: "https://apify.com/apify/instagram-reel-scraper/pricing", checked_on: "2026-07-23",
        },
        llm: {
          status: "verified", label: "Gemini 2.5 Flash Standard token rates",
          url: "https://ai.google.dev/gemini-api/docs/pricing", checked_on: "2026-07-23",
        },
        youtube: {
          status: "verified", label: "Немонетарные API quota limits",
          url: "https://developers.google.com/youtube/v3/getting-started", checked_on: "2026-07-23",
        },
        commercial: {
          status: "assumption", label: "Пользовательские payment fee, churn и CAC",
          url: null, checked_on: null,
        },
      },
      scenarios: [twLow, twBase, twStress],
      active: twBase,
    },
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
