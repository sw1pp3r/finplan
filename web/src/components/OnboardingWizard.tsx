import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRight,
  Check,
  ChevronDown,
  LineChart,
  Plus,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react"
import {
  api,
  type Account,
  type Inflow,
  type Obligation,
  type Rates,
  type Settings,
  type SnapshotPrefill,
  type Summary,
} from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { todayIso } from "@/lib/format"
import { reportActionError } from "@/lib/actionFeedback"
import {
  readOnboardingDraft,
  isOnboardingReplay,
  trackOnboardingEvent,
  writeOnboardingDraft,
  type OnboardingOutcome,
} from "@/lib/onboarding"
import { FinplanMark } from "@/components/FinplanMark"

const CUR_PRESET = ["USD", "KZT", "AED", "RUB", "EUR"] as const
const CUR_SYM: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  USDT: "₮",
  GBP: "£",
  KZT: "₸",
  AED: "AED",
}
const PREVIEW_RATE: Record<string, number> = {
  USD: 1,
  USDT: 1,
  EUR: 1.08,
  RUB: 0.0105,
  GBP: 1.27,
  KZT: 0.0019,
  AED: 0.272,
}

type AccountRow = {
  key: number
  serverId?: number
  name: string
  currency: string
  balance: number
}

type FlowRow = {
  key: number
  serverId?: number
  name: string
  amount: number
  currency: string
}

type OnboardingDraft = {
  version: 3
  phase: "wizard"
  step: 1 | 2 | 3 | 4
  startedAt: number
  base: string
  accounts: AccountRow[]
  income: FlowRow[]
  expenses: FlowRow[]
  detailedAccounts: boolean
  detailedIncome: boolean
  detailedExpenses: boolean
}

let nextKey = 1
const rowKey = () => nextKey++
const symbol = (currency: string) => CUR_SYM[currency] ?? currency
const groupNum = (n: number) =>
  Math.round(n).toLocaleString("ru-RU").replace(/\u00A0/g, "\u202F")
const parseNum = (value: string) => parseInt(value.replace(/[^\d]/g, ""), 10) || 0

function defaultCurrency(): string {
  if (typeof navigator === "undefined") return "USD"
  const locale = navigator.language.toUpperCase()
  if (locale.includes("KZ")) return "KZT"
  if (locale.includes("AE")) return "AED"
  if (locale.includes("RU")) return "RUB"
  if (/-(DE|FR|ES|IT|NL|PT|AT|BE|FI|IE|GR)\b/.test(locale)) return "EUR"
  return "USD"
}

function deadlineLabel(yearMonth: string): string {
  const date = new Date(`${yearMonth.slice(0, 7)}-01T12:00:00`)
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(date)
    .replace(/^1\s+/, "")
    .replace(/\s*г\.$/, "")
}

function initialAccount(currency: string): AccountRow {
  return { key: rowKey(), name: "Основной баланс", currency, balance: 0 }
}

function initialFlow(currency: string, kind: "income" | "expense"): FlowRow {
  return {
    key: rowKey(),
    name: kind === "income" ? "Регулярный доход" : "Ежемесячные расходы",
    amount: 0,
    currency,
  }
}

function buttonClass(kind: "primary" | "secondary" | "quiet") {
  const base =
    "touch-target inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 " +
    "text-sm font-medium transition-[filter,color,background-color,border-color] focus-visible:outline-none " +
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
  if (kind === "primary") {
    return `${base} border border-primary bg-primary text-primary-foreground shadow-sm hover:brightness-105`
  }
  if (kind === "secondary") {
    return `${base} border border-border bg-card text-foreground hover:border-ink-3 hover:bg-card-2`
  }
  return `${base} border border-transparent bg-transparent text-ink-3 hover:text-foreground`
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground " +
  "placeholder:text-ink-3 transition-colors focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-accent-soft"

function CurrencySelect({
  value,
  onChange,
  label,
  className = "",
}: {
  value: string
  onChange: (value: string) => void
  label: string
  className?: string
}) {
  const values = [...CUR_PRESET]
  if (!values.includes(value as (typeof CUR_PRESET)[number])) values.push(value as never)
  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          if (event.target.value === "__custom") {
            const custom = window.prompt("Код валюты, например GBP или PLN:", "")?.trim().toUpperCase()
            if (custom) onChange(custom)
            return
          }
          onChange(event.target.value)
        }}
        className={`${inputClass} cursor-pointer appearance-none pr-8 font-medium`}
      >
        {values.map((code) => <option key={code} value={code}>{code}</option>)}
        <option value="__custom">+ своя валюта</option>
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3"
      />
    </div>
  )
}

function MoneyField({
  value,
  currency,
  onChange,
  label,
  large = false,
}: {
  value: number
  currency: string
  onChange: (value: number) => void
  label: string
  large?: boolean
}) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-medium text-ink-3 ${
          large ? "text-lg" : "text-sm"
        }`}
      >
        {symbol(currency)}
      </span>
      <input
        aria-label={label}
        inputMode="numeric"
        value={groupNum(value)}
        onChange={(event) => onChange(parseNum(event.target.value))}
        className={
          large
            ? "h-16 w-full rounded-xl border border-border bg-card pl-12 pr-4 text-[26px] font-semibold tracking-[-0.03em] tnum " +
              "focus:border-primary focus:outline-none focus:ring-[4px] focus:ring-accent-soft"
            : `${inputClass} pl-9 font-medium tnum`
        }
      />
    </div>
  )
}

function DetailButton({
  expanded,
  onClick,
  children,
}: {
  expanded: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm font-medium text-ink-2 transition-colors hover:text-foreground"
    >
      <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
      {children}
    </button>
  )
}

function Progress({ step }: { step: number }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <div className="flex flex-1 gap-1.5" aria-hidden="true">
        {[1, 2, 3].map((item) => (
          <i
            key={item}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              item < step ? "bg-primary/55" : item === step ? "bg-primary" : "bg-border"
            }`}
          />
        ))}
      </div>
      <span className="whitespace-nowrap text-xs font-medium text-ink-3">
        {step <= 3 ? `${step} из 3` : "Готово"}
      </span>
    </div>
  )
}

type PreviewData = {
  balance: number
  income: number
  expenses: number
  free: number
  months: number | null
  until: string | null
  base: string
}

function LivePreview({ data, compact = false }: { data: PreviewData; compact?: boolean }) {
  const format = (value: number) =>
    `${value < 0 ? "−" : ""}${symbol(data.base)}${groupNum(Math.abs(value))}`
  const hasBalance = data.balance > 0
  const shrinking = data.free < 0
  const title = !hasBalance
    ? "Нужен стартовый баланс"
    : shrinking && data.months != null
      ? `Запаса примерно на ${Math.max(1, Math.round(data.months))} мес.`
      : "Доходы покрывают расходы"
  const note = !hasBalance
    ? "Введите первую сумму — прогноз оживёт сразу."
    : shrinking && data.until
      ? `При таком ритме деньги закончатся около ${data.until}.`
      : data.income === 0 && data.expenses === 0
        ? "Добавьте доходы и расходы, чтобы увидеть денежный ритм."
        : `Свободный поток: ${format(data.free)} в месяц.`

  if (compact) {
    return (
      <section
        aria-label="Предварительный прогноз"
        className="mb-5 rounded-xl bg-card-2 px-4 py-3 ring-1 ring-foreground/10 lg:hidden"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{note}</p>
          </div>
          <LineChart className={`mt-0.5 size-5 shrink-0 ${shrinking ? "text-warn" : "text-pos"}`} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line-2 pt-3">
          {[
            ["Сейчас", format(data.balance)],
            ["Приходит", format(data.income)],
            ["Свободно", format(data.free)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <div className="truncate text-[10px] text-ink-3">{label}</div>
              <div className="mt-0.5 truncate text-xs font-semibold tnum">{value}</div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <aside
      aria-label="Живой предварительный прогноз"
      className="sticky top-6 hidden rounded-2xl bg-card p-5 shadow-[0_10px_32px_-24px_rgba(15,23,42,.55)] ring-1 ring-foreground/10 lg:block"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-ink-3">Предварительный прогноз</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-card-2 px-2 py-1 text-[11px] font-medium text-ink-2">
          <i className={`size-1.5 rounded-full ${shrinking ? "bg-warn" : "bg-pos"}`} />
          обновляется сразу
        </span>
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-[-0.025em]">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{note}</p>

      <div className="mt-5 overflow-hidden rounded-xl bg-card-2 px-3 pb-2 pt-4">
        <svg viewBox="0 0 280 82" className="block w-full" role="img" aria-label={title}>
          <path
            d={shrinking ? "M6 15 C60 24 95 28 142 42 C188 53 226 61 274 70" : "M6 58 C60 54 95 48 142 45 C188 38 226 31 274 25"}
            fill="none"
            stroke={shrinking ? "var(--amber)" : "var(--green)"}
            strokeLinecap="round"
            strokeWidth="2.5"
          />
          <path d="M6 73H274" stroke="var(--border)" strokeDasharray="4 5" />
          <circle cx="274" cy={shrinking ? "70" : "25"} r="4" fill={shrinking ? "var(--amber)" : "var(--green)"} />
        </svg>
      </div>

      <dl className="mt-5 grid gap-3">
        {[
          ["Денег сейчас", format(data.balance)],
          ["Приходит в месяц", format(data.income)],
          ["Обязательные расходы", format(data.expenses)],
          ["Свободный поток", `${data.free >= 0 ? "+" : ""}${format(data.free)}`],
        ].map(([label, value], index) => (
          <div
            key={label}
            className={`flex items-baseline justify-between gap-4 ${index ? "border-t border-line-2 pt-3" : ""}`}
          >
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className={`text-sm font-semibold tnum ${label === "Свободный поток" ? (shrinking ? "text-warn" : "text-pos") : ""}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-[11px] leading-relaxed text-ink-3">
        На этом экране расчёт ориентировочный. После сохранения finplan применит реальные курсы и полный движок прогноза.
      </p>
    </aside>
  )
}

export default function OnboardingWizard({
  onDone,
}: {
  onDone: (outcome: OnboardingOutcome) => void
}) {
  const [usableDraft] = useState<OnboardingDraft | null>(() => {
    const restored = readOnboardingDraft<OnboardingDraft>()
    return restored?.version === 3 ? restored : null
  })
  const [replay] = useState(isOnboardingReplay)
  const fallbackCurrency = usableDraft?.base ?? defaultCurrency()
  const mainRef = useRef<HTMLElement>(null)

  const [phase, setPhase] = useState<"welcome" | "wizard">(usableDraft ? "wizard" : "welcome")
  const [step, setStep] = useState<1 | 2 | 3 | 4>(usableDraft?.step ?? 1)
  const [startedAt, setStartedAt] = useState(usableDraft?.startedAt ?? Date.now())
  const [base, setBase] = useState(fallbackCurrency)
  const [accounts, setAccounts] = useState<AccountRow[]>(
    usableDraft?.accounts?.length ? usableDraft.accounts : [initialAccount(fallbackCurrency)],
  )
  const [income, setIncome] = useState<FlowRow[]>(
    usableDraft?.income?.length ? usableDraft.income : [initialFlow(fallbackCurrency, "income")],
  )
  const [expenses, setExpenses] = useState<FlowRow[]>(
    usableDraft?.expenses?.length ? usableDraft.expenses : [initialFlow(fallbackCurrency, "expense")],
  )
  const [detailedAccounts, setDetailedAccounts] = useState(usableDraft?.detailedAccounts ?? false)
  const [detailedIncome, setDetailedIncome] = useState(usableDraft?.detailedIncome ?? false)
  const [detailedExpenses, setDetailedExpenses] = useState(usableDraft?.detailedExpenses ?? false)
  const [saving, setSaving] = useState(false)
  const [hydrating, setHydrating] = useState(replay && !usableDraft)
  const [hasExistingData, setHasExistingData] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [serverSummary, setServerSummary] = useState<Summary | null>(null)

  useEffect(() => {
    if (!usableDraft) return
    trackOnboardingEvent("resumed", { step: usableDraft.step })
  }, [usableDraft])

  useEffect(() => {
    if (!replay || usableDraft) return
    let alive = true
    Promise.all([
      api.get<Settings>("/settings"),
      api.get<Account[]>("/accounts"),
      api.get<SnapshotPrefill>("/snapshots/prefill"),
      api.get<Inflow[]>("/inflows"),
      api.get<Obligation[]>("/obligations"),
    ])
      .then(([settings, existingAccounts, prefill, existingIncome, existingExpenses]) => {
        if (!alive) return
        const balances = new Map(prefill.items.map((item) => [item.account_id, item.amount]))
        const accountRows = existingAccounts.map((account) => ({
          key: rowKey(),
          serverId: account.id,
          name: account.name,
          currency: account.currency,
          balance: balances.get(account.id) ?? 0,
        }))
        const incomeRows = existingIncome
          .filter((row) => row.recurrence === "monthly" && row.status !== "lost")
          .map((row) => ({
            key: rowKey(),
            serverId: row.id,
            name: row.name,
            amount: row.amount,
            currency: row.currency,
          }))
        const expenseRows = existingExpenses
          .filter((row) => row.recurrence === "monthly" && row.status === "planned")
          .map((row) => ({
            key: rowKey(),
            serverId: row.id,
            name: row.name,
            amount: row.remaining_amount || row.amount,
            currency: row.currency,
          }))
        setBase(settings.base_currency)
        setAccounts(accountRows.length ? accountRows : [initialAccount(settings.base_currency)])
        setIncome(incomeRows.length ? incomeRows : [initialFlow(settings.base_currency, "income")])
        setExpenses(expenseRows.length ? expenseRows : [initialFlow(settings.base_currency, "expense")])
        setDetailedAccounts(accountRows.length > 1)
        setDetailedIncome(incomeRows.length > 1)
        setDetailedExpenses(expenseRows.length > 1)
        setHasExistingData(accountRows.length > 0 || incomeRows.length > 0 || expenseRows.length > 0)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setHydrating(false)
      })
    return () => {
      alive = false
    }
  }, [replay, usableDraft])

  useEffect(() => {
    if (phase !== "wizard") return
    const draft: OnboardingDraft = {
      version: 3,
      phase: "wizard",
      step,
      startedAt,
      base,
      accounts,
      income,
      expenses,
      detailedAccounts,
      detailedIncome,
      detailedExpenses,
    }
    writeOnboardingDraft(draft)
  }, [
    accounts,
    base,
    detailedAccounts,
    detailedExpenses,
    detailedIncome,
    expenses,
    income,
    phase,
    startedAt,
    step,
  ])

  const toBase = useCallback(
    (amount: number, currency: string) =>
      (amount * (PREVIEW_RATE[currency] ?? 1)) / (PREVIEW_RATE[base] ?? 1),
    [base],
  )
  const balanceTotal = useMemo(
    () => accounts.reduce((sum, row) => sum + toBase(row.balance, row.currency), 0),
    [accounts, toBase],
  )
  const incomeTotal = useMemo(
    () => income.reduce((sum, row) => sum + toBase(row.amount, row.currency), 0),
    [income, toBase],
  )
  const expenseTotal = useMemo(
    () => expenses.reduce((sum, row) => sum + toBase(row.amount, row.currency), 0),
    [expenses, toBase],
  )
  const free = incomeTotal - expenseTotal
  const localMonths = balanceTotal > 0 && free < 0 ? balanceTotal / Math.abs(free) : null
  const localUntil = useMemo(() => {
    if (localMonths == null) return null
    const date = new Date()
    date.setMonth(date.getMonth() + Math.max(0, Math.floor(localMonths)))
    return deadlineLabel(date.toISOString().slice(0, 7))
  }, [localMonths])
  const preview: PreviewData = {
    balance: balanceTotal,
    income: incomeTotal,
    expenses: expenseTotal,
    free,
    months: localMonths,
    until: localUntil,
    base,
  }

  function scrollToTop() {
    const main = mainRef.current
    if (!main) return
    if (typeof main.scrollTo === "function") main.scrollTo({ top: 0, behavior: "auto" })
    else main.scrollTop = 0
  }

  function start() {
    const now = Date.now()
    setStartedAt(now)
    setPhase("wizard")
    setStep(1)
    trackOnboardingEvent("started")
    scrollToTop()
  }

  function changeBase(next: string) {
    const old = base
    setBase(next)
    setAccounts((rows) => rows.map((row) => row.currency === old ? { ...row, currency: next } : row))
    setIncome((rows) => rows.map((row) => row.currency === old ? { ...row, currency: next } : row))
    setExpenses((rows) => rows.map((row) => row.currency === old ? { ...row, currency: next } : row))
  }

  async function saveBaseCurrency() {
    try {
      const rates = await api.get<Rates>("/rates")
      const known = base === rates.base_currency
        || rates.rates.some((row) => row.currency === base && row.rate_to_base != null)
      if (!known) {
        await api.post(`/fx/refresh?currency=${encodeURIComponent(base)}`, {}, { feedback: false })
      }
      await api.patch("/settings", { base_currency: base }, { feedback: false })
    } catch {
      reportActionError(`Не удалось обновить базовую валюту ${base}. Суммы всё равно будут сохранены.`)
    }
  }

  async function saveAccounts() {
    await saveBaseCurrency()
    const nextRows = [...accounts]
    const snapshotItems: { account_id: number; amount: number }[] = []
    for (let index = 0; index < nextRows.length; index += 1) {
      const row = nextRows[index]
      if (!row.name.trim() || (row.balance <= 0 && !row.serverId)) continue
      let serverId = row.serverId
      const payload = { name: row.name.trim(), currency: row.currency, type: "bank" }
      if (serverId) {
        try {
          await api.patch(`/accounts/${serverId}`, payload)
        } catch {
          serverId = undefined
        }
      }
      if (!serverId) {
        const created = await api.post<{ id: number }>("/accounts", payload)
        serverId = created.id
      }
      nextRows[index] = { ...row, serverId }
      snapshotItems.push({ account_id: serverId, amount: row.balance })
    }
    setAccounts(nextRows)
    if (snapshotItems.length) {
      await api.post("/snapshots", { taken_at: todayIso(), items: snapshotItems })
    }
    void refreshCurrencies()
  }

  async function saveFlows(kind: "income" | "expense") {
    const rows = kind === "income" ? income : expenses
    const nextRows = [...rows]
    for (let index = 0; index < nextRows.length; index += 1) {
      const row = nextRows[index]
      if (!row.name.trim() || row.amount <= 0) continue
      let serverId = row.serverId
      const path = kind === "income" ? "/inflows" : "/obligations"
      const payload = kind === "income"
        ? {
            name: row.name.trim(),
            amount: row.amount,
            currency: row.currency,
            expected_date: todayIso(),
            probability: "confirmed",
            recurrence: "monthly",
            recurrence_end: null,
            counterparty: row.name.trim(),
          }
        : {
            name: row.name.trim(),
            amount: row.amount,
            currency: row.currency,
            due_date: todayIso(),
            recurrence: "monthly",
            recurrence_end: null,
            category: null,
            status: "planned",
          }
      if (serverId) {
        try {
          await api.patch(`${path}/${serverId}`, payload)
        } catch {
          serverId = undefined
        }
      }
      if (!serverId) {
        const created = await api.post<{ id: number }>(path, payload)
        serverId = created.id
      }
      nextRows[index] = { ...row, serverId }
    }
    if (kind === "income") setIncome(nextRows)
    else setExpenses(nextRows)
    void refreshCurrencies()
  }

  async function loadSummary() {
    try {
      setServerSummary(await api.get<Summary>("/summary"))
    } catch {
      setServerSummary(null)
    }
  }

  async function advance({ persist }: { persist: boolean }) {
    setSaveError("")
    setSaving(true)
    try {
      if (persist) {
        if (step === 1) await saveAccounts()
        if (step === 2) await saveFlows("income")
        if (step === 3) await saveFlows("expense")
      }
      trackOnboardingEvent("step_completed", { step, skipped: !persist })
      if (step === 1 && persist) trackOnboardingEvent("first_balance_entered")
      if (step === 3) {
        await loadSummary()
        trackOnboardingEvent("first_forecast_seen", {
          time_ms: Math.max(0, Date.now() - startedAt),
          complete_inputs: balanceTotal > 0 && incomeTotal > 0 && expenseTotal > 0,
        })
        setStep(4)
      } else {
        setStep((step + 1) as 2 | 3)
      }
      scrollToTop()
    } catch {
      setSaveError("Не удалось сохранить данные. Проверьте соединение и попробуйте ещё раз.")
    } finally {
      setSaving(false)
    }
  }

  function back() {
    setSaveError("")
    if (step === 1) {
      setPhase("welcome")
      scrollToTop()
      return
    }
    setStep((step - 1) as 1 | 2 | 3)
    scrollToTop()
  }

  function finish(outcome: "completed" | "skipped") {
    trackOnboardingEvent(outcome, {
      step,
      time_ms: Math.max(0, Date.now() - startedAt),
      first_forecast: balanceTotal > 0,
    })
    onDone(outcome)
  }

  const canPersist = step === 1
    ? balanceTotal > 0
    : step === 2
      ? incomeTotal > 0
      : expenseTotal > 0

  return (
    <div className="grid min-h-svh grid-cols-1 bg-background text-foreground md:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-svh flex-col border-r border-border bg-bg-soft px-4 py-5 md:flex">
        <div className="flex items-center gap-2.5 px-1 pb-6">
          <FinplanMark className="size-8 shrink-0 drop-shadow-sm" />
          <span className="text-base font-semibold tracking-[-0.02em]">finplan</span>
        </div>
        <div className="space-y-1">
          {[
            [WalletCards, "Деньги сейчас"],
            [TrendingUp, "Доходы в месяц"],
            [TrendingDown, "Расходы в месяц"],
          ].map(([Icon, label], index) => {
            const item = index + 1
            const active = phase === "wizard" && item === Math.min(step, 3)
            const done = phase === "wizard" && item < step
            const StepIcon = Icon as typeof WalletCards
            return (
              <div
                key={label as string}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm ${
                  active ? "bg-card font-medium shadow-sm ring-1 ring-foreground/10" : "text-ink-2"
                }`}
              >
                <span className={`grid size-7 place-items-center rounded-md ${done ? "bg-pos-soft text-pos" : active ? "bg-accent-soft text-primary" : "bg-card-2"}`}>
                  {done ? <Check className="size-4" /> : <StepIcon className="size-4" />}
                </span>
                {label as string}
              </div>
            )
          })}
        </div>
        <div className="mt-auto rounded-xl bg-card p-3.5 ring-1 ring-foreground/10">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <ShieldCheck className="size-4 text-pos" />
            Приватная настройка
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            Никаких подключений к банкам. Вы вводите только три ориентировочные суммы.
          </p>
        </div>
      </aside>

      <main ref={mainRef} className="flex h-svh flex-col overflow-y-auto">
        <div className="flex min-h-14 items-center justify-end px-5 md:px-8">
          <button
            onClick={() => finish("skipped")}
            className="touch-target rounded-lg px-2 text-xs font-medium text-ink-3 transition-colors hover:text-foreground"
          >
            Пропустить настройку
          </button>
        </div>

        <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col px-5 pb-10 pt-2 md:px-10 md:pb-14 md:pt-6">
          {phase === "welcome" ? (
            <Welcome
              onStart={start}
              loading={hydrating}
              hasExistingData={hasExistingData}
              onDemo={() => {
                trackOnboardingEvent("demo_opened")
                onDone("demo")
              }}
            />
          ) : step === 4 ? (
            <Finish
              data={preview}
              summary={serverSummary}
              onBack={() => {
                setStep(3)
                scrollToTop()
              }}
              onComplete={() => finish("completed")}
              onSkip={() => finish("skipped")}
            />
          ) : (
            <section className="mx-auto w-full max-w-[960px]">
              <Progress step={step} />
              <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0">
                  <StepHeader step={step} />
                  <LivePreview data={preview} compact />

                  <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
                    {step === 1 && (
                      <BalanceStep
                        base={base}
                        accounts={accounts}
                        detailed={detailedAccounts}
                        onBaseChange={changeBase}
                        onDetailedChange={() => {
                          setDetailedAccounts((value) => !value)
                          trackOnboardingEvent("detail_toggled", { step: 1 })
                        }}
                        onChange={setAccounts}
                      />
                    )}
                    {step === 2 && (
                      <FlowStep
                        kind="income"
                        base={base}
                        rows={income}
                        detailed={detailedIncome}
                        onDetailedChange={() => {
                          setDetailedIncome((value) => !value)
                          trackOnboardingEvent("detail_toggled", { step: 2 })
                        }}
                        onChange={setIncome}
                      />
                    )}
                    {step === 3 && (
                      <FlowStep
                        kind="expense"
                        base={base}
                        rows={expenses}
                        detailed={detailedExpenses}
                        onDetailedChange={() => {
                          setDetailedExpenses((value) => !value)
                          trackOnboardingEvent("detail_toggled", { step: 3 })
                        }}
                        onChange={setExpenses}
                      />
                    )}
                  </div>

                  {saveError && (
                    <div role="alert" className="mt-4 rounded-lg bg-neg-soft px-4 py-3 text-sm text-neg ring-1 ring-neg/20">
                      {saveError}
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <button onClick={back} className={buttonClass("secondary")} disabled={saving}>
                      Назад
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => advance({ persist: false })}
                      className={buttonClass("quiet")}
                      disabled={saving}
                    >
                      Пока не знаю
                    </button>
                    <button
                      onClick={() => advance({ persist: true })}
                      className={buttonClass("primary")}
                      disabled={saving || !canPersist}
                    >
                      {saving ? "Сохраняю…" : step === 3 ? "Показать прогноз" : "Далее"}
                      {!saving && <ArrowRight className="size-4" />}
                    </button>
                  </div>
                  {!canPersist && (
                    <p className="mt-2 text-right text-xs text-ink-3">
                      Введите сумму или выберите «Пока не знаю».
                    </p>
                  )}
                </div>
                <LivePreview data={preview} />
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function StepHeader({ step }: { step: 1 | 2 | 3 }) {
  const content = {
    1: {
      title: "Сколько денег сейчас?",
      text: "Примерная сумма на всех счетах — этого достаточно для первой точки прогноза.",
    },
    2: {
      title: "Сколько обычно приходит в месяц?",
      text: "Возьмите реалистичный средний месяц. Источники и разовые поступления можно уточнить позже.",
    },
    3: {
      title: "Сколько обязательно уходит в месяц?",
      text: "Аренда, быт, подписки, налоги и другие расходы, которые сложно отменить.",
    },
  }[step]
  return (
    <header className="mb-5">
      <h1 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] text-balance sm:text-[34px]">
        {content.title}
      </h1>
      <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">{content.text}</p>
    </header>
  )
}

function BalanceStep({
  base,
  accounts,
  detailed,
  onBaseChange,
  onDetailedChange,
  onChange,
}: {
  base: string
  accounts: AccountRow[]
  detailed: boolean
  onBaseChange: (value: string) => void
  onDetailedChange: () => void
  onChange: (rows: AccountRow[]) => void
}) {
  if (!detailed) {
    const row = accounts[0]
    return (
      <>
        <label className="mb-2 block text-sm font-medium" htmlFor="onboarding-balance">Общий доступный баланс</label>
        <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-2">
          <MoneyField
            value={row.balance}
            currency={base}
            label="Текущий баланс"
            large
            onChange={(balance) => onChange([{ ...row, balance, currency: base }])}
          />
          <CurrencySelect value={base} onChange={onBaseChange} label="Базовая валюта" className="[&>select]:h-16" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Можно округлить. Детальную сверку по счетам сделаете уже внутри раздела «Баланс».
        </p>
        <DetailButton expanded={false} onClick={onDetailedChange}>Разбить сумму по счетам</DetailButton>
      </>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Счета и остатки</h2>
          <p className="mt-1 text-xs text-ink-3">Каждая строка станет отдельным счётом в finplan.</p>
        </div>
        <CurrencySelect value={base} onChange={onBaseChange} label="Базовая валюта" className="w-24 shrink-0" />
      </div>
      <div className="mt-5 space-y-3">
        {accounts.map((row, index) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_36px] gap-2 rounded-xl bg-card-2 p-3 sm:grid-cols-[minmax(0,1fr)_100px_150px_36px]">
            <input
              aria-label={`Название счёта ${index + 1}`}
              value={row.name}
              onChange={(event) => onChange(accounts.map((item) => item.key === row.key ? { ...item, name: event.target.value } : item))}
              placeholder="Название счёта"
              className={inputClass}
            />
            <CurrencySelect
              value={row.currency}
              onChange={(currency) => onChange(accounts.map((item) => item.key === row.key ? { ...item, currency } : item))}
              label={`Валюта счёта ${index + 1}`}
              className="hidden sm:block"
            />
            <div className="hidden sm:block">
              <MoneyField
                value={row.balance}
                currency={row.currency}
                label={`Остаток счёта ${index + 1}`}
                onChange={(balance) => onChange(accounts.map((item) => item.key === row.key ? { ...item, balance } : item))}
              />
            </div>
            <button
              type="button"
              aria-label={`Удалить счёт ${index + 1}`}
              disabled={accounts.length === 1 || Boolean(row.serverId)}
              title={row.serverId ? "Сохранённый счёт можно удалить в разделе «Баланс»" : "Удалить"}
              onClick={() => onChange(accounts.filter((item) => item.key !== row.key))}
              className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-background hover:text-foreground disabled:opacity-30"
            >
              <X className="size-4" />
            </button>
            <div className="col-span-2 grid grid-cols-[100px_minmax(0,1fr)] gap-2 sm:hidden">
              <CurrencySelect
                value={row.currency}
                onChange={(currency) => onChange(accounts.map((item) => item.key === row.key ? { ...item, currency } : item))}
                label={`Валюта счёта ${index + 1}`}
              />
              <MoneyField
                value={row.balance}
                currency={row.currency}
                label={`Остаток счёта ${index + 1}`}
                onChange={(balance) => onChange(accounts.map((item) => item.key === row.key ? { ...item, balance } : item))}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...accounts, initialAccount(base)])}
        className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm font-medium text-primary"
      >
        <Plus className="size-4" />
        Добавить ещё счёт
      </button>
      <DetailButton expanded onClick={onDetailedChange}>Свернуть до общей суммы</DetailButton>
    </>
  )
}

function FlowStep({
  kind,
  base,
  rows,
  detailed,
  onDetailedChange,
  onChange,
}: {
  kind: "income" | "expense"
  base: string
  rows: FlowRow[]
  detailed: boolean
  onDetailedChange: () => void
  onChange: (rows: FlowRow[]) => void
}) {
  const isIncome = kind === "income"
  const first = rows[0]
  if (!detailed) {
    return (
      <>
        <label className="mb-2 block text-sm font-medium">
          {isIncome ? "Обычные поступления за месяц" : "Обязательные расходы за месяц"}
        </label>
        <MoneyField
          value={first.amount}
          currency={base}
          label={isIncome ? "Доходы в месяц" : "Расходы в месяц"}
          large
          onChange={(amount) => onChange([{ ...first, amount, currency: base }])}
        />
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          {isIncome
            ? "Не включайте деньги, в которых пока не уверены. Их можно добавить позже как ожидаемые."
            : "Не нужно вспоминать каждую мелочь — важен устойчивый ежемесячный ритм."}
        </p>
        <DetailButton expanded={false} onClick={onDetailedChange}>
          {isIncome ? "Разбить по источникам" : "Разбить по статьям"}
        </DetailButton>
      </>
    )
  }

  return (
    <>
      <div>
        <h2 className="text-sm font-semibold">{isIncome ? "Источники дохода" : "Статьи расходов"}</h2>
        <p className="mt-1 text-xs text-ink-3">Все строки сохранятся как ежемесячные.</p>
      </div>
      <div className="mt-5 space-y-3">
        {rows.map((row, index) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_36px] gap-2 rounded-xl bg-card-2 p-3 sm:grid-cols-[minmax(0,1fr)_100px_150px_36px]">
            <input
              aria-label={`${isIncome ? "Источник дохода" : "Статья расхода"} ${index + 1}`}
              value={row.name}
              onChange={(event) => onChange(rows.map((item) => item.key === row.key ? { ...item, name: event.target.value } : item))}
              placeholder={isIncome ? "Например, консалтинг" : "Например, аренда"}
              className={inputClass}
            />
            <CurrencySelect
              value={row.currency}
              onChange={(currency) => onChange(rows.map((item) => item.key === row.key ? { ...item, currency } : item))}
              label={`${isIncome ? "Валюта дохода" : "Валюта расхода"} ${index + 1}`}
              className="hidden sm:block"
            />
            <div className="hidden sm:block">
              <MoneyField
                value={row.amount}
                currency={row.currency}
                label={`${isIncome ? "Сумма дохода" : "Сумма расхода"} ${index + 1}`}
                onChange={(amount) => onChange(rows.map((item) => item.key === row.key ? { ...item, amount } : item))}
              />
            </div>
            <button
              type="button"
              aria-label={`Удалить ${isIncome ? "источник" : "статью"} ${index + 1}`}
              disabled={rows.length === 1 || Boolean(row.serverId)}
              onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
              className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-background hover:text-foreground disabled:opacity-30"
            >
              <X className="size-4" />
            </button>
            <div className="col-span-2 grid grid-cols-[100px_minmax(0,1fr)] gap-2 sm:hidden">
              <CurrencySelect
                value={row.currency}
                onChange={(currency) => onChange(rows.map((item) => item.key === row.key ? { ...item, currency } : item))}
                label={`${isIncome ? "Валюта дохода" : "Валюта расхода"} ${index + 1}`}
              />
              <MoneyField
                value={row.amount}
                currency={row.currency}
                label={`${isIncome ? "Сумма дохода" : "Сумма расхода"} ${index + 1}`}
                onChange={(amount) => onChange(rows.map((item) => item.key === row.key ? { ...item, amount } : item))}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, initialFlow(base, kind)])}
        className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm font-medium text-primary"
      >
        <Plus className="size-4" />
        {isIncome ? "Добавить источник" : "Добавить статью"}
      </button>
      <DetailButton expanded onClick={onDetailedChange}>Свернуть до общей суммы</DetailButton>
    </>
  )
}

function Welcome({
  onStart,
  onDemo,
  loading,
  hasExistingData,
}: {
  onStart: () => void
  onDemo: () => void
  loading: boolean
  hasExistingData: boolean
}) {
  return (
    <div className="my-auto grid items-center gap-9 py-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-14">
      <div>
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-primary">
          {hasExistingData ? "Обновить прогноз" : "Первый прогноз"}
          <span className="rounded-full bg-accent-soft px-2 py-1 text-[11px]">≈ 1 минута</span>
        </span>
        <h1 className="mt-4 max-w-[13ch] text-[38px] font-semibold leading-[1.04] tracking-[-0.035em] text-balance sm:text-[48px]">
          {hasExistingData
            ? "Три цифры — и прогноз снова отражает реальность"
            : "Три цифры — и видно, на сколько хватит денег"}
        </h1>
        <p className="mt-5 max-w-[48ch] text-base leading-relaxed text-ink-2">
          {hasExistingData
            ? "Подставили ваши текущие счета и регулярные суммы. Проверьте их — мастер обновит записи без дублей."
            : "Сколько есть сейчас, сколько обычно приходит и сколько обязательно уходит. Детали можно спокойно уточнить после первого прогноза."}
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <button disabled={loading} onClick={onStart} className={`${buttonClass("primary")} h-12 px-5 text-[15px]`}>
            {loading ? "Подставляю данные…" : hasExistingData ? "Обновить мой прогноз" : "Построить мой прогноз"}
            <ArrowRight className="size-4" />
          </button>
          <button onClick={onDemo} className={`${buttonClass("secondary")} h-12 px-5 text-[15px]`}>
            Посмотреть демо
          </button>
        </div>
        <div className="mt-5 flex max-w-[46ch] items-start gap-2.5 text-xs leading-relaxed text-ink-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pos" />
          Никаких банковских подключений. Можно ввести округлённые суммы, пропустить вопрос или выйти в любой момент.
        </div>
      </div>

      <div className="relative">
        <span className="absolute -top-3 left-5 z-10 inline-flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background shadow-sm">
          <i className="size-1.5 rounded-full bg-pos" />
          пример результата
        </span>
        <div className="rounded-2xl bg-card p-5 shadow-[0_20px_54px_-34px_rgba(15,23,42,.55)] ring-1 ring-foreground/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-ink-3">При текущем ритме</p>
              <p className="mt-1 text-[26px] font-semibold tracking-[-0.03em]">Запаса на 14 месяцев</p>
            </div>
            <span className="rounded-full bg-pos-soft px-2.5 py-1 text-[11px] font-semibold text-pos">устойчиво</span>
          </div>
          <p className="mt-2 text-sm text-ink-2">Доходы покрывают расходы, а подушка остаётся выше цели.</p>
          <div className="mt-5 rounded-xl bg-card-2 px-3 pb-2 pt-4">
            <svg viewBox="0 0 300 80" className="block w-full" aria-hidden="true">
              <path d="M6 54 C54 52 93 46 140 43 C190 38 236 29 294 24" fill="none" stroke="var(--green)" strokeLinecap="round" strokeWidth="2.5" />
              <path d="M6 70H294" stroke="var(--border)" strokeDasharray="4 5" />
              <circle cx="294" cy="24" r="4" fill="var(--green)" />
            </svg>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line-2 pt-4">
            {[
              ["Сейчас", "$18 400"],
              ["В месяц", "+$2 100"],
              ["Минимум", "$4 100"],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[10px] text-ink-3">{label}</div>
                <div className="mt-0.5 text-sm font-semibold tnum">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Finish({
  data,
  summary,
  onBack,
  onComplete,
  onSkip,
}: {
  data: PreviewData
  summary: Summary | null
  onBack: () => void
  onComplete: () => void
  onSkip: () => void
}) {
  const format = (value: number) =>
    `${value < 0 ? "−" : ""}${symbol(data.base)}${groupNum(Math.abs(value))}`
  const hasBalance = data.balance > 0
  if (!hasBalance) {
    return (
      <div className="my-auto mx-auto w-full max-w-[620px] py-8 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-card-2 text-ink-2">
          <WalletCards className="size-6" />
        </span>
        <h1 className="mt-5 text-[32px] font-semibold tracking-[-0.03em]">Для прогноза не хватает одной цифры</h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-[15px] leading-relaxed text-ink-2">
          Добавьте примерный текущий баланс. Без стартовой точки finplan не будет притворяться, что знает ваш запас хода.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button onClick={onBack} className={buttonClass("primary")}>Вернуться к суммам</button>
          <button onClick={onSkip} className={buttonClass("secondary")}>Открыть finplan без прогноза</button>
        </div>
      </div>
    )
  }

  const breach = summary?.scenarios.base.cushion_breach_date ?? null
  const breachLabel = breach ? deadlineLabel(breach.slice(0, 7)) : null
  const shrinking = data.free < 0
  const title = breachLabel
    ? `Подушка может закончиться к ${breachLabel}`
    : shrinking && data.until
      ? `При текущем ритме денег хватит примерно до ${data.until}`
      : "Доходы покрывают обязательный ритм"
  const action = shrinking
    ? `Чтобы перестать уменьшать баланс, нужно ещё ${format(Math.abs(data.free))} в месяц.`
    : `После обязательных расходов остаётся ${format(data.free)} в месяц.`

  return (
    <div className="my-auto mx-auto w-full max-w-[760px] py-6">
      <div className="text-center">
        <span className={`mx-auto grid size-14 place-items-center rounded-2xl ${shrinking ? "bg-warn-soft text-warn" : "bg-pos-soft text-pos"}`}>
          <Check className="size-7" strokeWidth={2.2} />
        </span>
        <p className="mt-5 text-xs font-semibold text-primary">Первый прогноз готов</p>
        <h1 className="mx-auto mt-2 max-w-[19ch] text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-balance sm:text-[40px]">
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-[54ch] text-[15px] leading-relaxed text-ink-2">{action}</p>
      </div>

      <div className="mt-8 rounded-2xl bg-card p-5 shadow-[0_20px_54px_-36px_rgba(15,23,42,.55)] ring-1 ring-foreground/10 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            ["Денег сейчас", format(data.balance), "стартовая точка"],
            ["Свободно в месяц", `${data.free >= 0 ? "+" : ""}${format(data.free)}`, shrinking ? "баланс уменьшается" : "после расходов"],
            ["Минимальный доход", format(data.expenses), "для безубыточности"],
          ].map(([label, value, note], index) => (
            <div key={label} className={index ? "border-t border-line-2 pt-5 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0" : ""}>
              <div className="text-xs text-ink-3">{label}</div>
              <div className={`mt-1 text-xl font-semibold tracking-[-0.025em] tnum ${index === 1 ? (shrinking ? "text-warn" : "text-pos") : ""}`}>
                {value}
              </div>
              <div className="mt-1 text-[11px] text-ink-3">{note}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-card-2 px-4 py-3 text-sm leading-relaxed text-ink-2">
        <strong className="font-semibold text-foreground">Дальше — только уточнение.</strong>{" "}
        Разбейте общие суммы по счетам и платежам, добавьте ожидаемые поступления или настройте подушку в удобный момент.
      </div>

      <div className="mt-7 flex flex-col-reverse justify-center gap-3 sm:flex-row">
        <button onClick={onBack} className={buttonClass("secondary")}>Уточнить суммы</button>
        <button onClick={onComplete} className={`${buttonClass("primary")} px-5`}>
          Открыть прогноз
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  )
}
