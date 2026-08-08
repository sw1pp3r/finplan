/**
 * THESIS: Главный экран показывает финансовый простор и отказывается от danger-dashboard.
 * OWN-WORLD: Строгий Golos Text/zinc, одно зелёное поле обеспеченности, тонкие линии и честные числа.
 * STORY: Сначала — что уже обеспечено, затем свободный ресурс, мечта и ближайшее движение денег.
 * FIRST VIEWPORT: Вердикт и ресурс над подушкой ведут; график доказывает, CTA добавляет поступление.
 * FORM: «Финансовый простор», цельное decision-полотно внутри существующей Operate-системы.
 */
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Sparkles } from "lucide-react"
import {
  Area, ComposedChart, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import {
  api, type Account, type Expenses, type Forecast, type Income,
  type Inflow, type Obligation, type Rates, type Summary, type WishItem, type Wishes,
} from "@/lib/api"
import { incomePerMonth } from "@/lib/aggregates"
import { addDaysIso, ddmm, money, occurrencesInRange, todayIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import { SectionHelp } from "@/components/SectionHelp"
import { OnboardingChecklist } from "@/components/OnboardingChecklist"
import { PageSkeleton } from "@/components/PageSkeleton"
import { Card } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

type Scenario = "base" | "optimistic" | "pessimistic"

const PERIOD_KEY = "finplan-period"
const SCENARIO_KEY = "finplan-scenario"
// «6 месяцев» = 180, в лад с settings.horizon_days по умолчанию (#6) — иначе график
// и карточки стартовали бы на разных окнах по умолчанию.
const PERIODS: { value: number; label: string }[] = [
  { value: 14, label: "2 недели" },
  { value: 31, label: "1 месяц" },
  { value: 92, label: "3 месяца" },
  { value: 180, label: "6 месяцев" },
  { value: 365, label: "1 год" },
]
const PERIOD_HEADLINE: Record<number, string> = {
  14: "Следующие 2 недели закрыты",
  31: "Ближайший месяц закрыт",
  92: "Следующие 3 месяца закрыты",
  180: "Следующие 6 месяцев закрыты",
  365: "Следующий год закрыт",
}
const SCEN_LABEL: Record<Scenario, string> = {
  base: "базовый", optimistic: "оптимистичный", pessimistic: "осторожный",
}

/** Прочитать CSS-переменную темы во время рендера (следует за light/dark). */
function cssVar(name: string): string {
  if (typeof window === "undefined") return ""
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [income, setIncome] = useState<Income | null>(null)
  const [expenses, setExpenses] = useState<Expenses | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rates, setRates] = useState<Rates | null>(null)
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [inflows, setInflows] = useState<Inflow[]>([])
  const [wishes, setWishes] = useState<Wishes | null>(null)
  const [resolvedPeriod, setResolvedPeriod] = useState<number | null>(null)
  const [horizonError, setHorizonError] = useState(false)
  const [horizonRevision, setHorizonRevision] = useState(0)
  const [supportingReady, setSupportingReady] = useState(false)
  const [supportingError, setSupportingError] = useState(false)
  const [supportingRevision, setSupportingRevision] = useState(0)
  const [period, setPeriod] = useState<number>(() => {
    const saved = Number(localStorage.getItem(PERIOD_KEY))
    return PERIODS.some((p) => p.value === saved) ? saved : 180
  })
  const [scenario, setScenario] = useState<Scenario>(() => {
    const saved = localStorage.getItem(SCENARIO_KEY)
    return saved === "optimistic" || saved === "pessimistic" ? saved : "base"
  })
  const [showScenarios, setShowScenarios] = useState(false)
  // Триггер пересчёта цветов графика при смене темы (light/dark).
  const [themeTick, setThemeTick] = useState(0)

  // Первая загрузка панелей, не зависящих от периода.
  useEffect(() => {
    let active = true
    setSupportingReady(false)
    setSupportingError(false)
    void Promise.all([
      api.get<Income>("/income"),
      api.get<Expenses>("/expenses"),
      api.get<Account[]>("/accounts"),
      api.get<Rates>("/rates"),
      api.get<Obligation[]>("/obligations"),
      api.get<Inflow[]>("/inflows"),
      api.get<Wishes>("/wishes"),
    ]).then(([inc, exp, accs, r, obs, infs, wishData]) => {
      if (!active) return
      setIncome(inc)
      setExpenses(exp)
      setAccounts(accs)
      setRates(r)
      setObligations(obs)
      setInflows(infs)
      setWishes(wishData)
      setSupportingReady(true)
    }).catch(() => {
      if (active) setSupportingError(true)
    })
    return () => { active = false }
  }, [supportingRevision])

  // И прогноз (график), и summary (карточки запас/min/gap) считаем на ОДНОМ выбранном
  // периоде — иначе карточки врут на фикс. 180д против графика (#1/#22).
  useEffect(() => {
    let active = true
    setHorizonError(false)
    void Promise.all([
      api.get<Forecast>(`/forecast?horizon=${period}`),
      api.get<Summary>(`/summary?horizon=${period}`),
    ]).then(([nextForecast, nextSummary]) => {
      if (!active) return
      setForecast(nextForecast)
      setSummary(nextSummary)
      setResolvedPeriod(period)
    }).catch(() => {
      if (active) setHorizonError(true)
    })
    return () => { active = false }
  }, [period, horizonRevision])

  // Следим за сменой темы (атрибут .dark на <html>), чтобы пересчитать цвета SVG.
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((t) => t + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])

  const changePeriod = (v: number) => {
    setPeriod(v)
    localStorage.setItem(PERIOD_KEY, String(v))
  }
  const changeScenario = (v: Scenario) => {
    setScenario(v)
    localStorage.setItem(SCENARIO_KEY, v)
  }

  const cur = summary?.base_currency ?? "USD"

  // Курсы к базовой валюте для конвертации обязательств/приходов в ленте.
  const conv = useMemo(() => {
    const toBase = new Map<string, number>()
    if (rates) for (const row of rates.rates) if (row.rate_to_base != null) toBase.set(row.currency, row.rate_to_base)
    return (amount: number, currency: string): number | null => {
      const k = currency === (rates?.base_currency ?? cur) ? 1 : toBase.get(currency)
      return k != null ? amount * k : null
    }
  }, [rates, cur])

  // Данные графика: все три сценария.
  const chartData = useMemo(() => {
    if (!forecast) return []
    const base = forecast.scenarios.base
    return base.map(([date, value], i) => ({
      date,
      base: value,
      optimistic: forecast.scenarios.optimistic[i]?.[1],
      pessimistic: forecast.scenarios.pessimistic[i]?.[1],
    }))
  }, [forecast])

  if (resolvedPeriod !== period) {
    if (horizonError) {
      return (
        <div className="flex flex-col gap-6">
          <SectionHelp route="/" title="Финансовый простор" defaultOpen={false}>
            Здесь видно, какой период уже обеспечен, сколько свободного ресурса остаётся над подушкой и что благодаря этому стало возможным.
          </SectionHelp>
          <div role="alert" className="rounded-xl bg-card px-5 py-6 ring-1 ring-foreground/10 sm:px-7">
            <h2 className="text-lg font-semibold">Не удалось загрузить прогноз</h2>
            <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-ink-2">
              Данные не изменены. Попробуйте загрузить денежную картину ещё раз.
            </p>
            <button
              type="button"
              onClick={() => setHorizonRevision((revision) => revision + 1)}
              className="touch-target mt-4 inline-flex h-9 items-center rounded-[9px] bg-primary px-3.5 text-[13.5px] font-medium text-primary-foreground"
            >
              Повторить
            </button>
          </div>
        </div>
      )
    }
    return <PageSkeleton label="Загружаю денежную картину" />
  }

  if (!summary || !forecast) return <PageSkeleton label="Загружаю денежную картину" />

  // ----- позитивная модель экрана: обеспеченность → свободный ресурс → возможность -----
  const balance = summary.t0
  const incomePerMonthValue = supportingReady && income ? incomePerMonth(income) : null
  const expensesPerMonth = supportingReady ? expenses?.required_monthly_income ?? null : null
  const free = incomePerMonthValue != null && expensesPerMonth != null ? incomePerMonthValue - expensesPerMonth : null

  const hasStartingBalance = summary.last_snapshot_date != null
  const scenarioMeta = summary.scenarios[scenario]
  const minTotal = scenarioMeta.min_total
  const hasFreshSnapshot = hasStartingBalance && !summary.snapshot_stale
  const hasCompleteRates = summary.missing_rates.length === 0
  const dataReady = hasFreshSnapshot && hasCompleteRates && minTotal != null
  const rawHeadroom = minTotal != null ? minTotal - summary.cushion : 0
  const headroom = dataReady ? rawHeadroom : 0
  const horizonCovered = dataReady && scenarioMeta.cushion_breach_date == null && rawHeadroom >= 0
  const periodHeadline = PERIOD_HEADLINE[period] ?? `План на ${PERIODS.find((p) => p.value === period)?.label ?? "период"} обеспечен`
  const heroHeadline = !hasStartingBalance
    ? "Здесь появится ваш финансовый простор"
    : !dataReady
      ? "Картина возможностей уточняется"
    : horizonCovered
      ? periodHeadline
      : "Большая часть горизонта уже обеспечена"
  const heroDetail = !hasStartingBalance
    ? "Добавьте актуальный баланс — finplan покажет обеспеченный период, свободный ресурс и доступные мечты."
    : summary.snapshot_stale
      ? "Обновите остатки на счетах — после этого finplan заново проверит обеспеченный период и свободный ресурс."
      : !hasCompleteRates
        ? `Добавьте курс для ${summary.missing_rates.join(", ")} — после этого свободный ресурс будет посчитан полностью.`
        : minTotal == null
          ? "Прогноз ещё не содержит полной картины горизонта. Попробуйте обновить его чуть позже."
    : horizonCovered
      ? `На всём пути остаётся не меньше ${money(minTotal ?? 0)} ${cur}. Подушка ${money(summary.cushion)} ${cur} сохраняется.`
      : `Чтобы сохранить подушку на всём горизонте, плану нужно ещё ${money(Math.max(0, -rawHeadroom))} ${cur}.`
  const statusText = !hasStartingBalance
    ? "Нужен стартовый баланс"
    : summary.snapshot_stale
      ? "Обновите остатки"
      : !hasCompleteRates
        ? "Нужны все курсы"
        : minTotal == null
          ? "Прогноз уточняется"
          : horizonCovered
            ? "Подушка сохраняется"
            : "План можно усилить"

  // ----- ближайшие 30 дней: позитивное движение без потери фактической точности -----
  const today = todayIso()
  const next30Iso = addDaysIso(today, 30)
  const expectedRows = supportingReady ? inflows
    .filter((i) => i.status === "expected")
    .flatMap((i) => occurrencesInRange(
      i.expected_date, i.recurrence, today, next30Iso, i.recurrence_end,
    ).map((date) => ({ date, name: i.name, amount: conv(i.amount, i.currency) })))
    .filter((r): r is { date: string; name: string; amount: number } => r.amount != null)
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount) : []
  const expectedNext30 = supportingReady
    ? expectedRows.reduce((sum, row) => sum + row.amount, 0)
    : null

  const upcomingOut = supportingReady ? obligations
    .filter((o) => o.status === "planned")
    .flatMap((o) => occurrencesInRange(
      o.due_date, o.recurrence, today, next30Iso, o.recurrence_end,
    ).map((date) => {
      const amt = conv(o.remaining_amount > 0 ? o.remaining_amount : o.amount, o.currency)
      return amt != null ? { date, name: o.name, amount: amt } : null
    }))
    .filter((x): x is { date: string; name: string; amount: number } => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date)) : []
  const upcomingOut30 = upcomingOut
  const outgoingNext30 = supportingReady
    ? upcomingOut30.reduce((sum, row) => sum + row.amount, 0)
    : null
  const plannedDelta = expectedNext30 != null && outgoingNext30 != null
    ? expectedNext30 - outgoingNext30
    : null

  const priorityRank: Record<WishItem["priority"], number> = { high: 0, medium: 1, low: 2 }
  const activeWishes = supportingReady ? [...(wishes?.items ?? [])].sort(
    (a, b) => (priorityRank[a.priority] - priorityRank[b.priority]) || (a.sort_order - b.sort_order),
  ) : []
  const affordableWish = dataReady ? activeWishes.find((wish) => wish.amount_base <= headroom) : undefined
  const nearestWish = [...activeWishes].sort(
    (a, b) => Math.max(0, a.amount_base - headroom) - Math.max(0, b.amount_base - headroom),
  )[0]
  const spotlightWish = affordableWish ?? nearestWish ?? null
  const wishIsAffordable = dataReady && spotlightWish != null && spotlightWish.amount_base <= headroom
  const wishResourceAfter = spotlightWish ? Math.max(0, headroom - spotlightWish.amount_base) : 0

  const primaryAction = !hasStartingBalance
    ? { to: "/balance", label: "Записать баланс" }
    : summary.snapshot_stale
      ? { to: "/balance", label: "Обновить баланс" }
      : summary.missing_rates.length > 0
        ? { to: "/settings", label: "Добавить курс" }
        : { to: "/income", label: horizonCovered ? "Добавить поступление" : "Укрепить план" }

  // ----- цвета графика (читаем токены темы; themeTick форсит пересчёт) -----
  void themeTick
  const colInk = cssVar("--foreground")
  const colGreen = cssVar("--green")
  const colAmber = cssVar("--amber")
  const colRed = cssVar("--red")
  const colAxis = cssVar("--chart-axis")
  const selectedLineColor = scenario === "pessimistic" ? colAmber : colGreen

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHelp route="/" title="Финансовый простор" defaultOpen={false}>
          Здесь видно, какой период уже обеспечен, сколько свободного ресурса остаётся над подушкой и что благодаря этому стало возможным.
        </SectionHelp>
        <Link
          to={primaryAction.to}
          className="touch-target inline-flex h-9 shrink-0 items-center gap-2 rounded-[9px] bg-primary px-3.5 text-[13.5px] font-medium text-primary-foreground transition-[filter] hover:brightness-105"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          {primaryAction.label}
        </Link>
      </div>

      <OnboardingChecklist summary={summary} />

      {summary.snapshot_stale && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm text-warn">
          {summary.last_snapshot_date
            ? <>Обновите остатки: последний снимок — {ddmm(summary.last_snapshot_date)}. Тогда картина возможностей будет точнее.</>
            : <>Добавьте стартовый баланс, чтобы увидеть обеспеченный период и свободный ресурс.</>}
        </div>
      )}
      {summary.missing_rates.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm text-warn">
          Добавьте курс для {summary.missing_rates.join(", ")} — после этого свободный ресурс будет посчитан полностью.
        </div>
      )}

      <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" aria-labelledby="dashboard-space-title">
        <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.55fr)]">
          <div className="px-4 py-5 sm:px-6 sm:py-6">
            <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className={cn(
                "inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-[3px] text-[11.5px] font-semibold",
                !dataReady ? "bg-card-2 text-ink-2" : horizonCovered ? "bg-pos-soft text-pos" : "bg-warn-soft text-warn",
              )}>
                <span className={cn("size-[6px] rounded-full", !dataReady ? "bg-ink-3" : horizonCovered ? "bg-pos" : "bg-warn")} />
                {statusText}
              </span>
              <span className="text-[11.5px] text-ink-3 tabular-nums">
                {summary.last_snapshot_date
                  ? <>Снимок {ddmm(summary.last_snapshot_date)} · курсы {ddmm(summary.rates_date)}</>
                  : <>Прогноз обновится после первого снимка</>}
              </span>
            </div>
            <h2
              id="dashboard-space-title"
              className={cn(
                "max-w-[34ch] text-[21px] font-semibold leading-[1.2] tracking-[-0.02em] text-balance sm:text-[24px]",
                !dataReady && "text-ink-3",
              )}
            >
              {heroHeadline}
            </h2>
            <p className="mt-2 max-w-[66ch] text-[13.5px] leading-relaxed text-ink-2">{heroDetail}</p>
          </div>

          <div className={cn(
            "flex flex-col gap-2 border-t border-line-2 px-4 py-5 sm:px-6 sm:py-6 lg:border-t-0 lg:border-l",
            horizonCovered ? "bg-pos-soft" : "bg-card-2/70",
          )}>
            <div className={cn("text-[11.5px] font-medium", horizonCovered ? "text-pos" : "text-ink-3")}>Свободный ресурс</div>
            <div className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[30px]">
              {money(Math.max(0, headroom))}{" "}
              <span className={cn("text-[13px] font-medium", horizonCovered ? "text-pos" : "text-ink-3")}>{cur}</span>
            </div>
            <p className={cn("mt-auto max-w-[34ch] pt-2 text-[12.5px] leading-relaxed", horizonCovered ? "text-pos" : "text-ink-2")}>
              {horizonCovered
                ? "Можно направить, сохраняя подушку на всём горизонте."
                : dataReady
                  ? "Появится здесь, когда план будет держаться выше подушки."
                  : hasStartingBalance
                    ? "Появится после актуального снимка и всех нужных курсов."
                    : "Появится после стартового баланса."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 border-t border-line-2 bg-card-2/45">
          <div className="px-4 py-3 sm:px-6">
            <div className="min-h-8 text-[11.5px] font-medium text-ink-3 sm:min-h-0">Сейчас</div>
            <div className="mt-1 text-[17px] font-semibold tracking-[-0.015em] tabular-nums sm:text-[19px]">
              {money(balance)} <span className="text-xs font-medium text-ink-3">{cur}</span>
            </div>
            <div className="mt-1 hidden text-[11px] text-ink-3 sm:block">
              {supportingReady
                ? accounts.length
                  ? `${accounts.length} ${accounts.length === 1 ? "счёт" : "счетов"}`
                  : "счета не добавлены"
                : "детали загружаются"}
            </div>
          </div>
          <div className="border-l border-line-2 px-4 py-3 sm:px-6">
            <div className="min-h-8 text-[11.5px] font-medium text-ink-3 sm:min-h-0">Свободно / мес</div>
            <div className={cn(
              "mt-1 text-[17px] font-semibold tracking-[-0.015em] tabular-nums sm:text-[19px]",
              free != null && free >= 0 ? "text-pos" : free != null ? "text-warn" : "",
            )}>
              {free != null ? `${free >= 0 ? "+" : "−"}${money(Math.abs(free))}` : "—"} <span className="text-xs font-medium">{cur}</span>
            </div>
            <div className="mt-1 hidden text-[11px] text-ink-3 sm:block">после всех регулярных расходов</div>
          </div>
          <div className="border-l border-line-2 px-4 py-3 sm:px-6">
            <div className="min-h-8 text-[11.5px] font-medium text-ink-3 sm:min-h-0">Ожидается / 30 дней</div>
            <div className="mt-1 text-[17px] font-semibold tracking-[-0.015em] text-pos tabular-nums sm:text-[19px]">
              {expectedNext30 != null
                ? <>+{money(expectedNext30)} <span className="text-xs font-medium">{cur}</span></>
                : "—"}
            </div>
            <div className="mt-1 hidden text-[11px] text-ink-3 sm:block">уже запланированные поступления</div>
          </div>
        </div>
      </section>

      {supportingError && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl bg-card px-4 py-4 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-sm font-semibold">Часть данных не загрузилась</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
              Прогноз сохранён. Поступления, обязательства и мечты пока показаны без чисел, чтобы не выдавать сбой за ноль.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSupportingRevision((revision) => revision + 1)}
            className="touch-target inline-flex h-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-card px-3.5 text-[13px] font-medium transition-colors hover:bg-card-2"
          >
            Повторить загрузку деталей
          </button>
        </div>
      )}

      <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(290px,.45fr)]">
      {/* Прогноз доказывает позитивный тезис; сравнение сценариев остаётся по запросу. */}
      <Card className="order-2 gap-0 p-0 lg:order-1">
        <div className="flex flex-wrap items-start justify-between gap-3.5 px-5 pt-5 pb-2 sm:px-6">
          <div>
            <h2 className="text-[15.5px] font-semibold tracking-tight">Как движутся деньги</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              {horizonCovered
                ? `Подушка сохраняется · ${SCEN_LABEL[scenario]} сценарий`
                : `${PERIODS.find((p) => p.value === period)?.label} · ${SCEN_LABEL[scenario]} сценарий`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-expanded={showScenarios}
              onClick={() => setShowScenarios((value) => !value)}
              className="touch-target rounded-[9px] border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-card-2 hover:text-foreground"
            >
              {showScenarios ? "Скрыть сравнение" : "Сравнить сценарии"}
            </button>
            <Select value={String(period)} onValueChange={(v) => changePeriod(Number(v))}>
              <SelectTrigger className="h-[33px] rounded-[9px]" aria-label="Период прогноза">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {showScenarios && (
          <div className="mx-5 mt-2 flex w-fit max-w-[calc(100%-2.5rem)] gap-px overflow-x-auto rounded-[9px] border border-border bg-card-2 p-[3px] sm:mx-6">
              {(["base", "optimistic", "pessimistic"] as Scenario[]).map((s) => (
                <button
                  key={s}
                  onClick={() => changeScenario(s)}
                  className={cn(
                    "rounded-md px-2.5 py-[5px] text-[12.5px] font-medium whitespace-nowrap transition-colors",
                    scenario === s ? "bg-card text-foreground shadow-sm" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {s === "base" ? "Базовый" : s === "optimistic" ? "Оптимистичный" : "Осторожный"}
                </button>
              ))}
          </div>
        )}

        <div
          className="px-3 pb-2"
          role="img"
          aria-label={`Прогноз баланса на ${period} дней — ${SCEN_LABEL[scenario]} сценарий`}
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={chartData}
              margin={{ top: 16, right: 12, bottom: 4, left: 0 }}
            >
              <defs>
                <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={selectedLineColor || colGreen} stopOpacity={0.18} />
                  <stop offset="72%" stopColor={selectedLineColor || colGreen} stopOpacity={0.035} />
                  <stop offset="100%" stopColor={selectedLineColor || colGreen} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date" tickFormatter={(d: string) => ddmm(d)} minTickGap={48}
                tick={{ fontSize: 11.5, fill: colAxis }} stroke={colAxis} tickLine={false} axisLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => money(v)} width={64}
                tick={{ fontSize: 11.5, fill: colAxis }} stroke={colAxis} tickLine={false} axisLine={false}
              />
              <Tooltip
                formatter={(value, name) => [`${money(Number(value))} ${cur}`, SCEN_LABEL[name as Scenario] ?? String(name)]}
                labelFormatter={(label) => ddmm(String(label))}
                contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }}
              />

              <ReferenceArea y1={0} y2={-1e12} fill={colRed} fillOpacity={0.06} ifOverflow="hidden" />
              <ReferenceLine y={0} stroke={colAxis} strokeWidth={1} ifOverflow="extendDomain" />

              {/* мягкая заливка под выбранной линией */}
              <Area type="monotone" dataKey={scenario} stroke="none" fill="url(#dashArea)" isAnimationActive={false} />

              {/* линия-подушка */}
              <ReferenceLine
                y={forecast?.cushion ?? summary.cushion} stroke={colAmber}
                strokeWidth={1.3} strokeDasharray="6 6"
                label={{ value: "Подушка", position: "insideTopRight", fill: colAmber, fontSize: 11, fontWeight: 600 }}
              />

              {showScenarios ? (
                <>
                  <Line type="monotone" dataKey="optimistic" stroke={colGreen} strokeDasharray="6 6"
                    strokeWidth={scenario === "optimistic" ? 2.4 : 1.7} strokeOpacity={scenario === "optimistic" ? 1 : 0.5}
                    dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="pessimistic" stroke={colAmber} strokeDasharray="6 6"
                    strokeWidth={scenario === "pessimistic" ? 2.4 : 1.7} strokeOpacity={scenario === "pessimistic" ? 1 : 0.5}
                    dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="base" stroke={colInk}
                    strokeWidth={scenario === "base" ? 2.8 : 1.7} strokeOpacity={scenario === "base" ? 1 : 0.5}
                    dot={false} isAnimationActive={false} />
                </>
              ) : (
                <Line type="monotone" dataKey={scenario} stroke={selectedLineColor}
                  strokeWidth={2.8} dot={false} isAnimationActive={false} />
              )}

              {/* Единственный временной маркер: сегодня. Минимум остаётся в итоговой цифре, а не становится тревожным центром графика. */}
              <ReferenceLine x={chartData[0]?.date} stroke={colAxis} strokeWidth={1.2} strokeDasharray="3 3" strokeOpacity={0.5}
                label={{ value: "Сегодня", position: "insideTopLeft", fill: colAxis, fontSize: 11, fontWeight: 600 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-1 pb-4 text-xs text-ink-3 sm:px-6">
          <span>
            {horizonCovered
              ? <>Свободный ресурс: <b className="font-semibold text-pos">{money(headroom)} {cur}</b></>
              : <>Подушка: {money(forecast?.cushion ?? summary.cushion)} {cur}</>}
          </span>
          <span>Показан {SCEN_LABEL[scenario]} прогноз</span>
        </div>
      </Card>

      <aside className="order-1 flex min-h-[340px] flex-col overflow-hidden rounded-xl bg-card-2 ring-1 ring-foreground/10 lg:order-2" aria-labelledby="dashboard-possibility">
        {spotlightWish?.image_url ? (
          <div className="relative min-h-[150px] flex-1 overflow-hidden">
            <img src={spotlightWish.image_url} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
            {/* Подпись на своей плашке, а не на голом фото: на светлом кадре
                (небо, снег) белый текст по градиенту падал до 1.14:1. */}
            <div className="absolute right-4 bottom-3 left-4">
              <span className="inline-block max-w-full truncate rounded-md bg-black/60 px-2 py-[3px] text-[11.5px] font-medium text-white">
                {spotlightWish.category ?? "Личная цель"}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[132px] flex-1 items-center justify-center bg-pos-soft text-pos">
            <Sparkles className="size-10" strokeWidth={1.25} aria-hidden="true" />
          </div>
        )}
        <div className="flex flex-col px-5 py-5">
          <div id="dashboard-possibility" className="text-xs font-semibold text-pos">
            {!supportingReady
              ? supportingError
                ? "Детали временно недоступны"
                : "Загружаю возможности"
              : spotlightWish
              ? !dataReady
                ? "После уточнения данных"
                : wishIsAffordable
                  ? "Уже по карману"
                  : "Ближе всего"
              : "Что становится возможным"}
          </div>
          {!supportingReady ? (
            <>
              <h2 className="mt-1.5 text-[19px] font-semibold leading-snug tracking-[-0.02em]">
                {supportingError ? "Не удалось сверить мечты" : "Сверяю мечты с ресурсом"}
              </h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                {supportingError
                  ? "Повторите загрузку деталей — до этого finplan не будет подменять неизвестные данные пустым списком."
                  : "Ещё мгновение — и здесь появится ближайшая доступная возможность."}
              </p>
            </>
          ) : spotlightWish ? (
            <>
              <h2 className="mt-1.5 text-[19px] font-semibold leading-snug tracking-[-0.02em]">{spotlightWish.name}</h2>
              <div className="mt-2 text-sm font-semibold tabular-nums">
                {money(spotlightWish.amount_base)} {cur}
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                {!dataReady
                  ? "Обновите исходные данные — и finplan честно сопоставит мечту со свободным ресурсом."
                  : wishIsAffordable
                  ? `После неё останется ${money(wishResourceAfter)} ${cur} свободного ресурса над подушкой.`
                  : `До неё осталось ${money(Math.max(0, spotlightWish.amount_base - headroom))} ${cur} свободного ресурса.`}
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-1.5 text-[19px] font-semibold leading-snug tracking-[-0.02em]">Добавьте мечту</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                Finplan свяжет её стоимость со свободным ресурсом и покажет, когда она становится доступной.
              </p>
            </>
          )}
          {supportingReady && (
            <Link className="mt-5 inline-flex min-h-11 w-fit items-center text-[13px] font-semibold underline underline-offset-4 sm:min-h-0" to="/wishes">
              {spotlightWish ? "Открыть мечты" : "Добавить мечту"}
            </Link>
          )}
        </div>
      </aside>
      </div>

      <section className="border-y border-line-2 py-5" aria-labelledby="dashboard-next-30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="dashboard-next-30" className="text-[15.5px] font-semibold tracking-tight">Движение ближайших 30 дней</h2>
            <p className="mt-1 text-[12.5px] text-ink-3">{ddmm(today)}–{ddmm(next30Iso)} · только уже запланированные события</p>
          </div>
          <div className="sm:text-right">
            <div className="text-xs font-medium text-ink-3">
              {plannedDelta == null
                ? "Детали денежного движения"
                : plannedDelta >= 0
                  ? "Поступления выше списаний"
                  : "Разница поступлений и списаний"}
            </div>
            <div className={cn(
              "mt-0.5 text-[19px] font-semibold tracking-[-0.015em] tabular-nums",
              plannedDelta != null && (plannedDelta >= 0 ? "text-pos" : "text-warn"),
            )}>
              {plannedDelta != null
                ? <>{plannedDelta >= 0 ? "+" : "−"}{money(Math.abs(plannedDelta))} {cur}</>
                : "—"}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-6 md:grid-cols-2 md:gap-0">
          <div className="md:pr-7">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold">Приходит</h3>
              <span className="text-sm font-semibold text-pos tabular-nums">
                {expectedNext30 != null ? `+${money(expectedNext30)} ${cur}` : "—"}
              </span>
            </div>
            {expectedRows.length ? expectedRows.slice(0, 4).map((row) => (
              <div key={`${row.date}-${row.name}`} className="flex items-center justify-between gap-3 border-b border-line-2 py-2.5 last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-ink-2">{row.name}</div>
                  <div className="mt-0.5 text-[11px] text-ink-3">{ddmm(row.date)}</div>
                </div>
                <span className="shrink-0 text-[13px] font-semibold text-pos tabular-nums">+{money(row.amount)} {cur}</span>
              </div>
            )) : (
              <p className="py-3 text-sm text-ink-3">
                {supportingReady
                  ? "Добавьте ожидаемое поступление — оно появится здесь и в прогнозе."
                  : supportingError
                    ? "Поступления временно не загружены."
                    : "Загружаю поступления…"}
              </p>
            )}
            <Link className="mt-3 inline-flex min-h-11 items-center text-[13px] font-semibold underline underline-offset-4 sm:min-h-0" to="/income">Все поступления</Link>
          </div>

          <div className="border-t border-line-2 pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-7">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold">Уже учтено в плане</h3>
              <span className="text-sm font-semibold tabular-nums">
                {outgoingNext30 != null ? `−${money(outgoingNext30)} ${cur}` : "—"}
              </span>
            </div>
            {upcomingOut30.length ? upcomingOut30.slice(0, 4).map((row) => (
              <div key={`${row.date}-${row.name}`} className="flex items-center justify-between gap-3 border-b border-line-2 py-2.5 last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-ink-2">{row.name}</div>
                  <div className="mt-0.5 text-[11px] text-ink-3">{ddmm(row.date)}</div>
                </div>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums">−{money(row.amount)} {cur}</span>
              </div>
            )) : (
              <p className="py-3 text-sm text-ink-3">
                {supportingReady
                  ? "Обязательных списаний на этот период пока нет."
                  : supportingError
                    ? "Обязательства временно не загружены."
                    : "Загружаю обязательства…"}
              </p>
            )}
            <Link className="mt-3 inline-flex min-h-11 items-center text-[13px] font-semibold underline underline-offset-4 sm:min-h-0" to="/expenses">Все обязательства</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
