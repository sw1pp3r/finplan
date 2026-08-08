/**
 * THESIS: Дашборд — приборная панель: один вердикт с датой, четыре сходящихся числа, доказательство.
 * OWN-WORLD: Строгий zinc, одна вваренная полоса метрик, хайрлайны вместо карточек, ноль тонированных панелей.
 * STORY: Вердикт (что и когда) → четыре числа, которые его объясняют → график-доказательство → ближайшие 30 дней.
 * FIRST VIEWPORT: Строка вердикта и полоса метрик; период стоит рядом с вердиктом, потому что задаёт его.
 * FORM: Один инструмент, а не набор виджетов. Мечта — строка, а не витрина: доска живёт на /wishes.
 */
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Area, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine,
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
type FlowEvent = { date: string; name: string; amount: number }

const PERIOD_KEY = "finplan-period"
const SCENARIO_KEY = "finplan-scenario"
const COMPARE_KEY = "finplan-compare"
// «6 месяцев» = 180, в лад с settings.horizon_days по умолчанию (#6) — иначе график
// и карточки стартовали бы на разных окнах по умолчанию.
const PERIODS: { value: number; label: string }[] = [
  { value: 14, label: "2 недели" },
  { value: 31, label: "1 месяц" },
  { value: 92, label: "3 месяца" },
  { value: 180, label: "6 месяцев" },
  { value: 365, label: "1 год" },
]
const SCEN_LABEL: Record<Scenario, string> = {
  base: "базовый", optimistic: "оптимистичный", pessimistic: "осторожный",
}
// Сколько строк движения показываем до сворачивания в «ещё N».
const FLOW_ROWS = 6

/** Прочитать CSS-переменную темы во время рендера (следует за light/dark). */
function cssVar(name: string): string {
  if (typeof window === "undefined") return ""
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Целых дней между ISO-датой и сегодня. */
function daysSince(iso: string): number {
  const then = new Date(`${iso}T00:00:00`).getTime()
  const now = new Date(`${todayIso()}T00:00:00`).getTime()
  return Math.max(0, Math.round((now - then) / 86_400_000))
}

/** Знаковая сумма: «+1 200» / «−1 200». */
function signed(v: number): string {
  return `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`
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
  // Персистим вместе со сценарием: иначе после релоада рисуется осторожная линия
  // со скрытым переключателем, и её нечем объяснить.
  const [showScenarios, setShowScenarios] = useState(
    () => localStorage.getItem(COMPARE_KEY) === "1",
  )
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
  const toggleScenarios = () => {
    setShowScenarios((value) => {
      localStorage.setItem(COMPARE_KEY, value ? "0" : "1")
      return !value
    })
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
            <h2 className="text-[15.5px] font-semibold">Не удалось загрузить прогноз</h2>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">
              Данные не изменены. Попробуйте загрузить денежную картину ещё раз.
            </p>
            <button
              type="button"
              onClick={() => setHorizonRevision((revision) => revision + 1)}
              className="touch-target mt-4 inline-flex h-9 items-center rounded-[9px] bg-primary px-3.5 text-[13px] font-medium text-primary-foreground"
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

  // ----- вердикт: что с подушкой и КОГДА -----
  const balance = summary.t0
  const incomePerMonthValue = supportingReady && income ? incomePerMonth(income) : null
  const expensesPerMonth = supportingReady ? expenses?.required_monthly_income ?? null : null
  const free = incomePerMonthValue != null && expensesPerMonth != null ? incomePerMonthValue - expensesPerMonth : null

  const hasStartingBalance = summary.last_snapshot_date != null
  const hasCompleteRates = summary.missing_rates.length === 0
  const scenarioMeta = summary.scenarios[scenario]
  const minTotal = scenarioMeta.min_total
  const breachDate = scenarioMeta.cushion_breach_date
  // Устаревший снимок — оговорка о свежести, а не блокер: числа посчитаны верно, просто
  // измерены N дней назад. Он живёт одной строкой в мета-линии и НЕ переписывает вердикт.
  // Недостающий курс — другое дело: без него часть счетов приводится к нулю, и вердикт
  // был бы неправдой, поэтому его по-прежнему придерживаем.
  const dataReady = hasStartingBalance && hasCompleteRates && minTotal != null
  const headroom = dataReady && minTotal != null ? minTotal - summary.cushion : null
  const horizonCovered = dataReady && breachDate == null && (headroom ?? 0) >= 0
  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? "период"

  const verdict = !hasStartingBalance
    ? "Здесь появится ваш финансовый простор"
    : !hasCompleteRates
      ? `Нужен курс для ${summary.missing_rates.join(", ")} — без него простор считается не полностью`
      : minTotal == null
        ? "Прогноз пока не покрывает весь горизонт"
        : horizonCovered
          ? `Подушка держится ${periodLabel} · минимум ${money(minTotal)} ${cur}`
          : breachDate != null
            ? `Подушка пробита ${ddmm(breachDate)} · не хватает ${money(Math.abs(headroom ?? 0))} ${cur}`
            : `Минимум за период ниже подушки на ${money(Math.abs(headroom ?? 0))} ${cur}`

  const snapshotAge = summary.last_snapshot_date ? daysSince(summary.last_snapshot_date) : null

  // ----- ближайшие 30 дней: одна хронологическая лента -----
  const today = todayIso()
  const next30Iso = addDaysIso(today, 30)
  const expectedRows: FlowEvent[] = supportingReady ? inflows
    .filter((i) => i.status === "expected")
    .flatMap((i) => occurrencesInRange(
      i.expected_date, i.recurrence, today, next30Iso, i.recurrence_end,
    ).map((date) => ({ date, name: i.name, amount: conv(i.amount, i.currency) })))
    .filter((r): r is FlowEvent => r.amount != null) : []
  const expectedNext30 = supportingReady
    ? expectedRows.reduce((sum, row) => sum + row.amount, 0)
    : null

  const upcomingOut: FlowEvent[] = supportingReady ? obligations
    .filter((o) => o.status === "planned")
    .flatMap((o) => occurrencesInRange(
      o.due_date, o.recurrence, today, next30Iso, o.recurrence_end,
    ).map((date) => {
      const amt = conv(o.remaining_amount > 0 ? o.remaining_amount : o.amount, o.currency)
      return amt != null ? { date, name: o.name, amount: -amt } : null
    }))
    .filter((x): x is FlowEvent => x !== null) : []
  const outgoingNext30 = supportingReady
    ? upcomingOut.reduce((sum, row) => sum + Math.abs(row.amount), 0)
    : null
  const plannedDelta = expectedNext30 != null && outgoingNext30 != null
    ? expectedNext30 - outgoingNext30
    : null

  // Режем по величине, а НЕ по дате: срез по дате прятал самое крупное обязательство
  // месяца, оставляя подытог, который не сходится с видимыми строками.
  const flowEvents = [...expectedRows, ...upcomingOut]
  const shownFlow = [...flowEvents]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, FLOW_ROWS)
    .sort((a, b) => a.date.localeCompare(b.date))
  const hiddenFlow = flowEvents.length - shownFlow.length
  const hiddenFlowSum = flowEvents.reduce((sum, row) => sum + row.amount, 0)
    - shownFlow.reduce((sum, row) => sum + row.amount, 0)

  const priorityRank: Record<WishItem["priority"], number> = { high: 0, medium: 1, low: 2 }
  const activeWishes = supportingReady ? [...(wishes?.items ?? [])].sort(
    (a, b) => (priorityRank[a.priority] - priorityRank[b.priority]) || (a.sort_order - b.sort_order),
  ) : []
  const affordableWish = headroom != null ? activeWishes.find((wish) => wish.amount_base <= headroom) : undefined
  const nearestWish = [...activeWishes].sort(
    (a, b) => Math.max(0, a.amount_base - (headroom ?? 0)) - Math.max(0, b.amount_base - (headroom ?? 0)),
  )[0]
  const spotlightWish = affordableWish ?? nearestWish ?? null
  const wishIsAffordable = headroom != null && spotlightWish != null && spotlightWish.amount_base <= headroom

  const primaryAction = !hasStartingBalance
    ? { to: "/balance", label: "Записать баланс" }
    : summary.missing_rates.length > 0
      ? { to: "/settings", label: "Добавить курс" }
      : { to: "/income", label: "Добавить поступление" }

  // ----- цвета графика (читаем токены темы; themeTick форсит пересчёт) -----
  void themeTick
  const colInk = cssVar("--foreground")
  const colGreen = cssVar("--green")
  const colAmber = cssVar("--amber")
  const colRed = cssVar("--red")
  const colAxis = cssVar("--chart-axis")
  const selectedLineColor = scenario === "pessimistic" ? colAmber : colGreen
  const breachInRange = breachDate != null && chartData.some((row) => row.date === breachDate)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHelp route="/" title="Финансовый простор" defaultOpen={false}>
          Здесь видно, какой период уже обеспечен, сколько свободного ресурса остаётся над подушкой и что благодаря этому стало возможным.
        </SectionHelp>
        <div className="flex shrink-0 items-center gap-2">
          {/* Период стоит рядом с вердиктом и метриками, потому что задаёт их значение. */}
          <Select value={String(period)} onValueChange={(v) => changePeriod(Number(v))}>
            <SelectTrigger className="h-9 rounded-[9px]" aria-label="Период прогноза">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link
            to={primaryAction.to}
            className="touch-target inline-flex h-9 shrink-0 items-center gap-2 rounded-[9px] bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-[filter] hover:brightness-105"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            {primaryAction.label}
          </Link>
        </div>
      </div>

      {/* Один инструмент: вердикт + свежесть + четыре сходящихся числа. */}
      <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" aria-labelledby="dashboard-verdict">
        <div className="px-4 py-5 sm:px-6">
          <h2
            id="dashboard-verdict"
            className={cn(
              "max-w-[40ch] text-[21px] font-semibold leading-[1.2] tracking-[-0.02em] text-balance sm:text-[24px]",
              !dataReady && "text-ink-2",
            )}
          >
            {verdict}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-3 tabular-nums">
            {summary.last_snapshot_date ? (
              summary.snapshot_stale ? (
                <Link
                  to="/balance"
                  className="touch-target inline-flex min-h-6 items-center gap-1.5 rounded-md bg-warn-soft px-2 py-[3px] font-medium text-warn"
                >
                  <span className="size-[6px] rounded-full bg-warn" />
                  Снимок {ddmm(summary.last_snapshot_date)} · {snapshotAge} дн. назад · обновить
                </Link>
              ) : (
                <span>Снимок {ddmm(summary.last_snapshot_date)}</span>
              )
            ) : (
              <Link to="/balance" className="touch-target inline-flex min-h-6 items-center font-medium underline underline-offset-4">
                Добавить стартовый баланс
              </Link>
            )}
            <span>курсы {ddmm(summary.rates_date)}</span>
            <span>{SCEN_LABEL[scenario]} сценарий</span>
          </div>
        </div>

        {/* Порядок группирует: слева — СКОЛЬКО ЕСТЬ (запасы), справа — КАК МЕНЯЕТСЯ (потоки).
            Окно уехало в саму подпись: без него четыре числа читались как одна величина
            в четырёх видах, а −1 410 рядом с +1 320 выглядело противоречием. */}
        <div className="grid grid-cols-2 border-t border-line-2 bg-card-2/45 sm:grid-cols-4">
          <div className="border-b border-line-2 px-4 py-3 sm:border-b-0 sm:px-5" title={`Сумма по всем счетам (${accounts.length}) в базовой валюте, снимок от ${ddmm(summary.last_snapshot_date)}`}>
            <div className="text-[11.5px] font-medium text-ink-3">Есть сейчас</div>
            <div className="mt-1 text-[17px] font-semibold tracking-[-0.015em] tabular-nums sm:text-[19px]">
              {money(balance)} <span className="text-[11.5px] font-medium text-ink-3">{cur}</span>
            </div>
          </div>
          <div className="border-b border-l border-line-2 px-4 py-3 sm:border-b-0 sm:px-5" title="Самая низкая точка прогноза за выбранный период минус подушка. Столько можно потратить, не пробив подушку.">
            <div className="text-[11.5px] font-medium text-ink-3">Свободно над подушкой · {periodLabel}</div>
            <div className={cn(
              "mt-1 text-[17px] font-semibold tracking-[-0.015em] tabular-nums sm:text-[19px]",
              headroom != null && (headroom >= 0 ? "text-pos" : "text-warn"),
            )}>
              {headroom != null ? signed(headroom) : "—"} <span className="text-[11.5px] font-medium text-ink-3">{cur}</span>
            </div>
          </div>
          <div className="border-line-2 px-4 py-3 sm:border-l sm:px-5" title="Постоянные доходы минус постоянные расходы. Ритм, а не конкретные даты.">
            <div className="text-[11.5px] font-medium text-ink-3">Регулярно · в месяц</div>
            <div className={cn(
              "mt-1 text-[17px] font-semibold tracking-[-0.015em] tabular-nums sm:text-[19px]",
              free != null && (free >= 0 ? "text-pos" : "text-warn"),
            )}>
              {free != null ? signed(free) : "—"} <span className="text-[11.5px] font-medium text-ink-3">{cur}</span>
            </div>
          </div>
          <div className="border-l border-line-2 px-4 py-3 sm:px-5" title="Конкретные запланированные поступления минус списания в ближайшие 30 дней — то, что перечислено в ленте ниже.">
            <div className="text-[11.5px] font-medium text-ink-3">Запланировано · 30 дней</div>
            <div className={cn(
              "mt-1 text-[17px] font-semibold tracking-[-0.015em] tabular-nums sm:text-[19px]",
              plannedDelta != null && (plannedDelta >= 0 ? "text-pos" : "text-warn"),
            )}>
              {plannedDelta != null ? signed(plannedDelta) : "—"} <span className="text-[11.5px] font-medium text-ink-3">{cur}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Мечта — строка, а не витрина: связь «свободный ресурс → что стало возможным» без 374px фотографии. */}
      {supportingReady && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
          {spotlightWish ? (
            <>
              {spotlightWish.image_url && (
                <img
                  src={spotlightWish.image_url} alt="" width={32} height={32} loading="lazy" decoding="async"
                  className="size-8 shrink-0 rounded-md object-cover"
                />
              )}
              <span className="text-ink-3">Ближайшая цель</span>
              <span className="font-medium">{spotlightWish.name}</span>
              <span className="tabular-nums text-ink-2">{money(spotlightWish.amount_base)} {cur}</span>
              <span className={cn("font-medium", wishIsAffordable ? "text-pos" : "text-ink-3")}>
                {headroom == null
                  ? "сверим после курсов"
                  : wishIsAffordable
                    ? "Уже по карману"
                    : `не хватает ${money(spotlightWish.amount_base - headroom)} ${cur}`}
              </span>
              {wishIsAffordable && headroom != null && (
                <span className="text-ink-3 tabular-nums">
                  останется {money(headroom - spotlightWish.amount_base)} {cur}
                </span>
              )}
              <Link className="touch-target inline-flex min-h-6 items-center font-medium underline underline-offset-4" to="/wishes">Все мечты</Link>
            </>
          ) : (
            <>
              <span className="text-ink-3">Мечт пока нет — finplan свяжет их стоимость со свободным ресурсом.</span>
              <Link className="touch-target inline-flex min-h-6 items-center font-medium underline underline-offset-4" to="/wishes">Добавить мечту</Link>
            </>
          )}
        </div>
      )}

      {supportingError && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl bg-card px-4 py-4 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-[13px] font-semibold">Часть данных не загрузилась</h2>
            <p className="mt-1 max-w-[62ch] text-[11.5px] leading-relaxed text-ink-3">
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

      {/* Доказательство вердикта. Период задаётся выше — здесь только сценарии. */}
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-2 sm:px-6">
          <h2 className="text-[15.5px] font-semibold tracking-tight">Как движутся деньги</h2>
          <button
            type="button"
            aria-expanded={showScenarios}
            onClick={toggleScenarios}
            className="touch-target rounded-[9px] border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-card-2 hover:text-foreground"
          >
            {showScenarios ? "Скрыть сравнение" : "Сравнить сценарии"}
          </button>
        </div>

        {showScenarios && (
          <div className="mx-5 mt-2 flex w-fit max-w-[calc(100%-2.5rem)] gap-px overflow-x-auto rounded-[9px] border border-border bg-card-2 p-[3px] sm:mx-6">
            {(["base", "optimistic", "pessimistic"] as Scenario[]).map((s) => (
              <button
                key={s}
                onClick={() => changeScenario(s)}
                className={cn(
                  "rounded-md px-2.5 py-[5px] text-[13px] font-medium whitespace-nowrap transition-colors",
                  scenario === s ? "bg-card text-foreground shadow-sm" : "text-ink-3 hover:text-ink-2",
                )}
              >
                {s === "base" ? "Базовый" : s === "optimistic" ? "Оптимистичный" : "Осторожный"}
              </button>
            ))}
          </div>
        )}

        {/* Имя графика живёт на контейнере; сам svg выведен из tab-порядка (tabIndex=-1),
            поэтому фокус больше не попадает на безымянный узел recharts. */}
        <div
          className="px-3 pt-2 pb-4"
          role="img"
          aria-label={`Прогноз баланса на ${period} дней — ${SCEN_LABEL[scenario]} сценарий, подушка ${money(forecast?.cushion ?? summary.cushion)} ${cur}`}
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={chartData}
              margin={{ top: 16, right: 12, bottom: 4, left: 0 }}
              tabIndex={-1}
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

              <ReferenceArea y1={0} y2={-1e12} fill={colRed} fillOpacity={0.09} ifOverflow="hidden" />
              <ReferenceLine y={0} stroke={colAxis} strokeWidth={1} ifOverflow="extendDomain" />

              {/* мягкая заливка под выбранной линией */}
              <Area type="monotone" dataKey={scenario} stroke="none" fill="url(#dashArea)" isAnimationActive={false} />

              {/* линия-подушка; подпись слева-снизу — справа её пересекала кривая */}
              <ReferenceLine
                y={forecast?.cushion ?? summary.cushion} stroke={colAmber}
                strokeWidth={1.3} strokeDasharray="6 6"
                label={{ value: "Подушка", position: "insideBottomLeft", fill: colAmber, fontSize: 11, fontWeight: 600 }}
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

              {/* Дата из вердикта должна находиться на кривой, а не только в тексте. */}
              {breachInRange && (
                <ReferenceDot
                  x={breachDate as string} y={forecast?.cushion ?? summary.cushion} r={4}
                  fill={colAmber} stroke={cssVar("--card") || "#fff"} strokeWidth={2}
                />
              )}

              <ReferenceLine x={chartData[0]?.date} stroke={colAxis} strokeWidth={1.2} strokeDasharray="3 3" strokeOpacity={0.5}
                label={{ value: "Сегодня", position: "insideTopLeft", fill: colAxis, fontSize: 11, fontWeight: 600 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Одна хронологическая лента: приход и расход вперемешку, крупное не может выпасть. */}
      <section className="border-y border-line-2 py-5" aria-labelledby="dashboard-next-30">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="dashboard-next-30" className="text-[15.5px] font-semibold tracking-tight">Ближайшие 30 дней</h2>
          <p className="text-[11.5px] text-ink-3 tabular-nums">
            {ddmm(today)}–{ddmm(next30Iso)}
            {expectedNext30 != null && outgoingNext30 != null
              ? <> · +{money(expectedNext30)} / −{money(outgoingNext30)} {cur}</>
              : null}
          </p>
        </div>

        {/* Две колонки — это ОДНА лента, свёрнутая пополам: порядок, срез и остаток
            считаются до раскладки, поэтому крупное событие не может выпасть за колонку. */}
        {shownFlow.length ? (
          <div className="mt-3 lg:columns-2 lg:gap-x-10">
            {shownFlow.map((row) => (
              <div key={`${row.date}-${row.name}-${row.amount}`} className="flex items-center justify-between gap-3 break-inside-avoid border-b border-line-2 py-[7px] last:border-b-0">
                <div className="flex min-w-0 items-baseline gap-3">
                  <span className="w-[42px] shrink-0 text-[11.5px] text-ink-3 tabular-nums">{ddmm(row.date)}</span>
                  <span className="truncate text-[13px] text-ink-2">{row.name}</span>
                </div>
                <span className={cn(
                  "shrink-0 text-[13px] font-semibold tabular-nums",
                  row.amount >= 0 ? "text-pos" : "text-foreground",
                )}>
                  {signed(row.amount)} {cur}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-ink-3">
            {supportingReady
              ? "Запланированных событий на этот период нет."
              : supportingError
                ? "Движение временно не загружено."
                : "Загружаю движение…"}
          </p>
        )}

        {/* Срез не исчезает молча: остаток назван числом на всю ширину ленты. */}
        {hiddenFlow > 0 && (
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-line-2 pt-2 text-[11.5px] text-ink-3 tabular-nums">
            <span>Ещё {hiddenFlow}</span>
            <span>{signed(hiddenFlowSum)} {cur}</span>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          <Link className="touch-target inline-flex min-h-11 items-center text-[13px] font-semibold underline underline-offset-4 sm:min-h-6" to="/income">Все поступления</Link>
          <Link className="touch-target inline-flex min-h-11 items-center text-[13px] font-semibold underline underline-offset-4 sm:min-h-6" to="/expenses">Все обязательства</Link>
        </div>
      </section>

      {/* Скаффолдинг первого запуска не должен вести экран, который смотрят каждый день. */}
      <OnboardingChecklist summary={summary} />
    </div>
  )
}
