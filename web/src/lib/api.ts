import { mutationErrorMessage, reportActionError } from "@/lib/actionFeedback"

export type ScenarioMeta = {
  min_total: number | null
  min_date: string | null
  cushion_breach_date: string | null
  breakdown: { t0: number; burn: number; obligations: number; inflows: number }
}

export type Summary = {
  t0: number
  t0_by_currency: Record<string, number>
  burn_weekly: number
  burn_source: "derived" | "manual" | "none"
  gap_amount: number
  gap_deadline: string | null
  last_snapshot_date: string | null
  snapshot_stale: boolean
  missing_rates: string[]
  rates_date: string | null
  base_currency: string
  cushion: number
  horizon_days: number
  scenarios: Record<"pessimistic" | "base" | "optimistic", ScenarioMeta>
}

export type Forecast = {
  cushion: number
  scenarios: Record<"pessimistic" | "base" | "optimistic", [string, number][]>
}

export type Account = {
  id: number
  name: string
  currency: string
  type: string
  sort_order: number
}

export type Obligation = {
  id: number
  name: string
  amount: number
  paid_amount: number
  remaining_amount: number
  currency: string
  due_date: string
  recurrence: "once" | "weekly" | "monthly" | "yearly"
  recurrence_end: string | null
  status: "planned" | "paid" | "cancelled"
  category: string | null
  note: string | null
}

export type Ref = { id: number; name: string }

export type WishItem = {
  id: number
  name: string
  amount: number
  currency: string
  amount_base: number
  priority: "high" | "medium" | "low"
  target_date: string | null
  category: string | null
  note: string | null
  image_url: string | null
  image_source: string | null
  card_size: string | null
  sort_order: number
  status: "active" | "completed" | "bought" | "dropped"
  completed_at: string | null
}

export type Wishes = {
  base_currency: string
  total: number
  items: WishItem[]
  completed_items: WishItem[]
  by_priority: Record<string, number>
}

export type Inflow = {
  id: number
  name: string
  amount: number
  currency: string
  expected_date: string
  probability: "confirmed" | "likely" | "possible"
  recurrence: "once" | "weekly" | "monthly" | "yearly"
  recurrence_end: string | null
  status: "expected" | "received" | "lost"
  counterparty: string | null
  direction: string | null
  note: string | null
}

export type Income = {
  base_currency: string
  total: number
  items: {
    id: number
    date: string
    name: string
    counterparty: string | null
    direction: string | null
    amount: number
    currency: string
    amount_base: number
  }[]
  by_direction: Record<string, number>
  by_month: Record<string, number>
  expected: {
    by_probability: Record<"confirmed" | "likely" | "possible", number>
    by_month: Record<string, number>
    total: number
    weighted: number
  }
}

export type Expenses = {
  base_currency: string
  by_category: Record<string, number>
  monthly_obligations: number
  burn_monthly: number
  required_monthly_income: number
  one_off_total: number
  one_off_count: number
}

export type CourseTariff = {
  id: number
  name: string
  price: number
  currency: string
  students: number
  gross_base: number
}

export type CourseCost = {
  id: number
  name: string
  amount: number
  currency: string
  kind: "monthly" | "per_student"
  monthly_base: number
}

export type Course = {
  base_currency: string
  cohort_months: number
  students_total: number
  gross_per_cohort: number
  gross_monthly: number
  fixed_monthly: number
  variable_monthly: number
  cost_monthly: number
  net_monthly: number
  net_per_cohort: number
  required_monthly_income: number
  net_vs_required: number
  one_off_total: number
  one_off_count: number
  gap_amount: number
  tariffs: CourseTariff[]
  costs: CourseCost[]
  missing_rates: string[]
}

export type ServiceListItem = {
  id: number
  name: string
  note: string | null
  preset_key: string | null
  preset_version: number | null
}

export type ServiceTariffRow = {
  id: number
  name: string
  price: number
  currency: string
  clients: number
  is_byo: boolean
  usage: Record<string, number> // cost_id -> юнитов/клиента/мес
  mrr_base: number
  var_cost_base: number
  net_per_client: number
  provider_cogs_per_client: number
  break_even_clients: number | null
}

export type ServiceCostRow = {
  id: number
  name: string
  amount: number
  currency: string
  kind: "fixed" | "per_client" | "per_unit"
  unit_label: string | null
  unit_size: number
}

export type ServiceSummary = {
  service: {
    id: number
    name: string
    note: string | null
    preset_key: string | null
    preset_version: number | null
  }
  base_currency: string
  mrr: number
  fixed_monthly: number
  per_client_monthly: number
  per_unit_monthly: number
  provider_monthly: number
  cogs_monthly: number
  net_monthly: number
  margin_pct: number | null
  clients_total: number
  required_monthly_income: number
  net_vs_required: number
  missing_rates: string[]
  tariffs: ServiceTariffRow[]
  costs: ServiceCostRow[]
  trendwatcher: TrendWatcherModel | null
}

export type TrendWatcherConfig = {
  active_scenario: "low" | "base" | "stress"
  instagram_source: "scrapecreators" | "apify"
  provider_allowance_usd: number
  scrapecreators_price_per_1000: number
  scrapecreators_pack_price_usd: number
  scrapecreators_pack_credits: number
  scrapecreators_credit_balance: number
  apify_instagram_price_per_1000: number
  apify_actor_start_usd: number
  llm_provider: string
  llm_input_usd_per_million: number
  llm_output_usd_per_million: number
  llm_retry_overhead_pct: number
  llm_platform_fee_pct: number
  payment_fee_pct: number
  payment_fee_fixed_usd: number
  monthly_churn_pct: number
  cac_per_client_usd: number
  youtube_daily_general_units: number
  youtube_daily_search_calls: number
}

export type TrendWatcherScenario = {
  key: "low" | "base" | "stress"
  label: string
  drivers: Record<string, number>
  usage: {
    instagram: {
      requests: number
      credits: number
      refresh_credits: number
      radar_credits: number
      transcript_credits: number
      outcome_credits: number
      unsupported_radar_runs: number
      cost_usd: number
    }
    tiktok: {
      requests: number
      credits: number
      refresh_credits: number
      discovery_credits: number
      transcript_credits: number
      outcome_credits: number
      cost_usd: number
    }
    apify: { results: number; actor_runs: number; cost_usd: number }
    llm: {
      provider: string
      calls: number
      base_calls: number
      billed_calls: number
      breakdown: {
        annotations: number
        similarity_batches: number
        profile: number
        ideas: number
        manual: number
      }
      input_tokens: number
      output_tokens: number
      inference_cost_usd: number
      platform_fee_usd: number
      cost_usd: number
    }
    youtube: {
      search_calls: number
      general_quota_units: number
      internal_legacy_meter_units: number
      daily_general_limit: number
      daily_search_limit: number
      cost_usd: null
    }
    scrapecreators_credits: number
    allowance: {
      limit_usd: number
      demand_usd: number
      used_usd: number
      remaining_usd: number
      overage_usd: number
      max_whole_credits: number
    }
    provider_cost_usd: number
  }
  economics: {
    mrr: number
    revenue_monthly_base: number
    generic_variable_monthly_base: number
    payment_fees_monthly_base: number
    fixed_monthly_base: number
    provider_data_monthly_base: number
    provider_llm_monthly_base: number
    provider_monthly_base: number
    contribution_monthly_base: number
    cogs_monthly: number
    cogs_per_client: number
    net_monthly: number
    margin_pct: number | null
    gross_margin_pct: number | null
    operating_profit_base: number
    by_tariff: {
      id: number
      name: string
      is_byo: boolean
      clients: number
      price_base: number
      provider_cogs_usd: number
      provider_cogs_base: number
      provider_data_per_client_base: number
      provider_llm_per_client_base: number
      generic_variable_per_client_base: number
      payment_fee_per_client_base: number
      fixed_allocation_per_client_base: number | null
      cogs_per_client_base: number
      gross_margin_per_client_base: number
      contribution_per_client_base: number
      contribution_margin_pct: number | null
      break_even_clients: number | null
      cac_payback_months: number | null
      ltv_contribution_base: number | null
      ltv_cac_ratio: number | null
      net_per_client: number
      unit_profit_per_client_base: number | null
      unit_margin_pct: number | null
    }[]
  }
  capacity: {
    starting_balance_credits: number
    monthly_demand_credits: number
    shortfall_credits: number
    pack_credits: number
    pack_price_usd: number
    packs_to_buy: number
    next_topup_cash_usd: number
    ending_balance_credits: number
    pack_implied_price_per_1000: number
    allocation_price_per_1000: number
    rate_mismatch: boolean
  }
}

export type TrendWatcherModel = {
  config: TrendWatcherConfig
  pricing_basis: Record<"scrapecreators" | "apify" | "llm" | "youtube" | "commercial", string>
  pricing_sources: Record<
    "scrapecreators" | "apify" | "llm" | "youtube" | "commercial",
    {
      status: "verified" | "assumption"
      label: string
      url: string | null
      checked_on: string | null
    }
  >
  scenarios: TrendWatcherScenario[]
  active: TrendWatcherScenario
}

export type TrendWatcherDraftPayload = {
  scenario_key: TrendWatcherScenario["key"]
  config: Partial<TrendWatcherConfig>
  drivers: Record<string, number>
}

export type LastSnapshot = {
  taken_at: string | null
  items: { account_id: number; account: string; currency: string; amount: number }[]
}

export type SnapshotHistory = {
  base_currency: string
  items: { date: string; total: number }[]
}

export type SnapshotPrefill = {
  items: { account_id: number; account: string; currency: string; amount: number; taken_at: string }[]
}

export type Settings = {
  base_currency: string
  cushion: number
  horizon_days: number
  manual_burn_weekly: number | null
  display_name: string | null
}

export type RateRow = {
  currency: string
  rate_to_base: number | null
  rate_date: string | null
  used: boolean
  is_base: boolean
}

export type Rates = {
  base_currency: string
  rates: RateRow[]
  missing: string[]
}

// Демо-режим: флаг в localStorage. Когда включён — запросы шлют X-Demo: 1 И ?demo=1,
// и бэкенд отдаёт фейк из отдельной in-memory БД (показ на расшаренном экране).
// Квери-параметр дублирует заголовок: некоторые прокси/CDN (напр. Railway) режут
// кастомные заголовки → без дубля демо-данные не доезжали.
const DEMO_KEY = "finplan-demo"
export const isDemo = () =>
  typeof localStorage !== "undefined" && localStorage.getItem(DEMO_KEY) === "1"
export const setDemo = (on: boolean) => localStorage.setItem(DEMO_KEY, on ? "1" : "0")

const withDemo = (path: string) =>
  isDemo() ? path + (path.includes("?") ? "&" : "?") + "demo=1" : path

type RequestOptions = { feedback?: boolean }

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (isDemo()) headers["X-Demo"] = "1"
  let res: Response
  try {
    res = await fetch(`/api${withDemo(path)}`, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    if (method !== "GET" && options.feedback !== false) reportActionError(mutationErrorMessage(method))
    throw error
  }
  if (!res.ok) {
    const responseText = await res.text()
    if (method !== "GET" && options.feedback !== false) reportActionError(mutationErrorMessage(method, res.status))
    throw new Error(`${method} ${path}: ${res.status} ${responseText}`)
  }
  return res.json()
}

async function uploadFile<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {}
  if (isDemo()) headers["X-Demo"] = "1"  // Content-Type не ставим — браузер сам с boundary
  let res: Response
  try {
    res = await fetch(`/api${withDemo(path)}`, {
      method: "POST",
      headers: Object.keys(headers).length ? headers : undefined,
      body: form,
    })
  } catch (error) {
    reportActionError("Не удалось загрузить файл. Проверьте соединение и попробуйте ещё раз.")
    throw error
  }
  if (!res.ok) {
    const responseText = await res.text()
    reportActionError(res.status === 422
      ? "Не удалось загрузить файл: проверьте его формат и размер."
      : "Не удалось загрузить файл. Проверьте соединение и попробуйте ещё раз.")
    throw new Error(`POST ${path}: ${res.status} ${responseText}`)
  }
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown, options?: RequestOptions) => request<T>("POST", path, body, options),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) => request<T>("PATCH", path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options),
  upload: <T>(path: string, form: FormData) => uploadFile<T>(path, form),
}
