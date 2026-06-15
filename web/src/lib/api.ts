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
}

export type Wishes = {
  base_currency: string
  total: number
  items: WishItem[]
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

// Демо-режим: флаг в localStorage. Когда включён — все запросы шлют X-Demo: 1,
// и бэкенд отдаёт фейк из отдельной in-memory БД (показ на расшаренном экране).
const DEMO_KEY = "finplan-demo"
export const isDemo = () =>
  typeof localStorage !== "undefined" && localStorage.getItem(DEMO_KEY) === "1"
export const setDemo = (on: boolean) => localStorage.setItem(DEMO_KEY, on ? "1" : "0")

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (isDemo()) headers["X-Demo"] = "1"
  const res = await fetch(`/api${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function uploadFile<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {}
  if (isDemo()) headers["X-Demo"] = "1"  // Content-Type не ставим — браузер сам с boundary
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: Object.keys(headers).length ? headers : undefined,
    body: form,
  })
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => uploadFile<T>(path, form),
}
