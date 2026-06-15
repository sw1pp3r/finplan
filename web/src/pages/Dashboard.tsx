import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Area, ComposedChart, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import {
  api, type Account, type Expenses, type Forecast, type Income,
  type Inflow, type LastSnapshot, type Obligation, type Rates, type Summary,
} from "@/lib/api"
import { incomePerMonth } from "@/lib/aggregates"
import { ddmm, money, monthLabel, nextOccurrence, todayIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import { SectionHelp } from "@/components/SectionHelp"
import { OnboardingChecklist } from "@/components/OnboardingChecklist"
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
const SCEN_LABEL: Record<Scenario, string> = {
  base: "базовый", optimistic: "оптимистичный", pessimistic: "осторожный",
}

/** Прочитать CSS-переменную темы во время рендера (следует за light/dark). */
function cssVar(name: string): string {
  if (typeof window === "undefined") return ""
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function Figure({ label, value, note, green }: {
  label: string; value: string; note?: string; green?: boolean
}) {
  return (
    <div className="flex flex-col justify-center gap-1 border-l border-line-2 px-5 py-[18px] first:border-l-0">
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <span className={cn("text-[22px] font-semibold tracking-tight tnum", green && "text-pos")}>{value}</span>
      {note && <span className="text-[11.5px] text-ink-3">{note}</span>}
    </div>
  )
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [income, setIncome] = useState<Income | null>(null)
  const [expenses, setExpenses] = useState<Expenses | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [lastSnap, setLastSnap] = useState<LastSnapshot | null>(null)
  const [rates, setRates] = useState<Rates | null>(null)
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [inflows, setInflows] = useState<Inflow[]>([])
  const [period, setPeriod] = useState<number>(() => {
    const saved = Number(localStorage.getItem(PERIOD_KEY))
    return PERIODS.some((p) => p.value === saved) ? saved : 180
  })
  const [scenario, setScenario] = useState<Scenario>(() => {
    const saved = localStorage.getItem(SCENARIO_KEY)
    return saved === "optimistic" || saved === "pessimistic" ? saved : "base"
  })
  // Триггер пересчёта цветов графика при смене темы (light/dark).
  const [themeTick, setThemeTick] = useState(0)

  // Первая загрузка панелей, не зависящих от периода.
  const loadAll = useCallback(async () => {
    const [inc, exp, accs, snap, r, obs, infs] = await Promise.all([
      api.get<Income>("/income"),
      api.get<Expenses>("/expenses"),
      api.get<Account[]>("/accounts"),
      api.get<LastSnapshot>("/snapshots/last"),
      api.get<Rates>("/rates"),
      api.get<Obligation[]>("/obligations"),
      api.get<Inflow[]>("/inflows"),
    ])
    setIncome(inc)
    setExpenses(exp)
    setAccounts(accs)
    setLastSnap(snap)
    setRates(r)
    setObligations(obs)
    setInflows(infs)
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  // И прогноз (график), и summary (карточки запас/min/gap) считаем на ОДНОМ выбранном
  // периоде — иначе карточки врут на фикс. 180д против графика (#1/#22).
  useEffect(() => {
    void api.get<Forecast>(`/forecast?horizon=${period}`).then(setForecast)
    void api.get<Summary>(`/summary?horizon=${period}`).then(setSummary)
  }, [period])

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

  // Самый тонкий месяц по выбранному сценарию (точка-маркер).
  const thinnest = useMemo(() => {
    if (!chartData.length) return null
    let idx = 0
    let min = Infinity
    chartData.forEach((d, i) => {
      const v = d[scenario]
      if (v != null && v < min) { min = v; idx = i }
    })
    if (idx === 0) return null
    return { date: chartData[idx].date, value: min }
  }, [chartData, scenario])

  if (!summary) return <div className="py-20 text-center text-sm text-muted-foreground">Загрузка…</div>

  // ----- производные цифры для статус-полосы -----
  const balance = summary.t0
  // среднее по календарному диапазону + помесячный фолбэк (#24/#30/#31), не sum/present-months
  const incomePerMonthValue = income ? incomePerMonth(income) : null
  // Расходы/мес = месячная планка из /expenses (обязательства + повседневные траты),
  // т.е. required_monthly_income. НЕ один только burn — иначе «Свободно» завышалось
  // на сумму регулярных обязательств (фантомный профицит).
  const expensesPerMonth = expenses?.required_monthly_income ?? null
  const free = incomePerMonthValue != null && expensesPerMonth != null ? incomePerMonthValue - expensesPerMonth : null

  // Запас хода: месяцы до пробития подушки по выбранному сценарию.
  const runway = (() => {
    const cushionBreach = summary.scenarios[scenario].cushion_breach_date
    if (!cushionBreach) return { months: null as number | null, breach: null as string | null }
    const days = (new Date(cushionBreach).getTime() - new Date(todayIso()).getTime()) / 86400_000
    return { months: Math.max(0, Math.round(days / 30.44)), breach: cushionBreach }
  })()
  const runwayMonths = runway.months
  const overHorizon = runwayMonths == null
  const thin = runwayMonths != null && runwayMonths < 12
  const stateText = runwayMonths == null ? "Большой запас"
    : runwayMonths >= 14 ? "Отличный запас"
      : runwayMonths >= 12 ? "Хороший запас" : "Запас тоньше"

  // Месяц «хватает до» = месяц пробития подушки (или конец горизонта).
  const lastForecastDate = chartData.length ? chartData[chartData.length - 1].date : null
  const coverUntilIso = runway.breach ?? lastForecastDate
  const coverUntil = coverUntilIso ? monthLabel(coverUntilIso.slice(0, 7)) : "—"

  // ----- инсайт 1: ожидается в этом месяце -----
  const thisMonth = todayIso().slice(0, 7)
  const expectedThisMonth = income?.expected.by_month[thisMonth] ?? 0
  const expectedRows = inflows
    .filter((i) => i.status === "expected" && i.expected_date.slice(0, 7) === thisMonth)
    .map((i) => ({ name: i.name, amount: conv(i.amount, i.currency) }))
    .filter((r): r is { name: string; amount: number } => r.amount != null)
    .sort((a, b) => b.amount - a.amount)
  const expectBreakdown = expectedRows.slice(0, 3)
    .map((r) => `${r.name} ${money(r.amount)}`).join(" · ")

  // ----- инсайт 3: ближайшее крупное списание -----
  const today = todayIso()
  const upcomingOut = obligations
    .filter((o) => o.status === "planned")
    .map((o) => {
      const occ = nextOccurrence(o.due_date, o.recurrence, today)
      const amt = conv(o.amount, o.currency)
      return amt != null ? { date: occ, name: o.name, amount: amt } : null
    })
    .filter((x): x is { date: string; name: string; amount: number } => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  const nextBig = upcomingOut[0] ?? null
  const nextBig2 = upcomingOut[1] ?? null
  const daysUntil = nextBig
    ? Math.round((new Date(nextBig.date).getTime() - new Date(today).getTime()) / 86400_000)
    : 0

  // ----- панель «Счета» -----
  const snapByAcc = new Map<number, number>()
  if (lastSnap) for (const it of lastSnap.items) snapByAcc.set(it.account_id, (snapByAcc.get(it.account_id) ?? 0) + it.amount)
  const accountRows = accounts.map((a) => {
    const native = snapByAcc.get(a.id) ?? 0
    const base = conv(native, a.currency) ?? 0
    return { id: a.id, name: a.name, currency: a.currency, base }
  })
  const accountsTotal = accountRows.reduce((s, a) => s + a.base, 0)
  const accountMax = Math.max(1, ...accountRows.map((a) => a.base))

  // ----- панель «Куда уходят деньги» -----
  const catRows = expenses
    ? Object.entries(expenses.by_category)
      .map(([name, amount]) => ({ name, amount }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)
    : []
  const catTotal = expenses?.monthly_obligations ?? 0
  const catMax = Math.max(1, ...catRows.map((c) => c.amount))

  // ----- цвета графика (читаем токены темы; themeTick форсит пересчёт) -----
  void themeTick
  const colInk = cssVar("--foreground")
  const colAccent = cssVar("--primary")
  const colGreen = cssVar("--green")
  const colAmber = cssVar("--amber")
  const colRed = cssVar("--red")
  const colAxis = cssVar("--chart-axis")

  return (
    <div className="flex flex-col gap-6">
      <SectionHelp route="/" title="Дашборд">
        Главная картина денег: сколько есть сейчас, сколько нужно заработать и как будет меняться сумма на счетах. Чтобы цифры ожили — пройдите настройку из карточки ниже.
      </SectionHelp>

      <OnboardingChecklist summary={summary} />

      {/* топбар: приветствие + действие */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Денежная картина</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {summary.last_snapshot_date
              ? <>Снимок от {ddmm(summary.last_snapshot_date)} · курсы от {ddmm(summary.rates_date)}</>
              : <>Прогноз пересчитан сегодня</>}
          </p>
        </div>
        <Link
          to="/income"
          className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-primary px-3.5 text-[13.5px] font-medium text-primary-foreground transition-[filter] hover:brightness-105"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          Операция
        </Link>
      </div>

      {summary.snapshot_stale && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm text-warn">
          {summary.last_snapshot_date
            ? <>Снимок остатков устарел (последний — {ddmm(summary.last_snapshot_date)}). <Link className="font-medium underline underline-offset-4" to="/snapshot">Обновить →</Link></>
            : <>Данных ещё нет — <Link className="font-medium underline underline-offset-4" to="/snapshot">сделай первый снимок остатков →</Link></>}
        </div>
      )}
      {summary.missing_rates.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm text-warn">
          Нет курса для: {summary.missing_rates.join(", ")} — эти суммы посчитаны по нулю.
        </div>
      )}

      {/* ===== статус-полоса ===== */}
      <Card className="grid grid-cols-1 gap-0 overflow-hidden p-0 lg:grid-cols-[296px_1fr]">
        <div className={cn(
          "relative flex flex-col justify-center gap-3 px-6 py-5",
          "before:absolute before:top-3.5 before:bottom-3.5 before:left-0 before:w-[3px] before:rounded-[3px] before:content-['']",
          thin ? "before:bg-warn" : "before:bg-pos",
        )}>
          <span className={cn(
            "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full py-1 pr-3 pl-2",
            thin ? "bg-warn-soft" : "bg-pos-soft",
          )}>
            <span className={cn("size-[7px] rounded-full", thin ? "bg-warn" : "bg-pos")} />
            <span className={cn("text-xs font-semibold", thin ? "text-warn" : "text-pos")}>{stateText}</span>
          </span>
          <div>
            <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">Запас хода</div>
            <div className="flex items-baseline gap-2 whitespace-nowrap tnum">
              <span className={cn("text-[40px] font-semibold leading-none tracking-[-0.035em]", thin ? "text-warn" : "text-pos")}>
                {overHorizon ? "за горизонт" : `≈ ${runway.months}`}
              </span>
              {!overHorizon && <span className="text-lg font-medium tracking-tight text-ink-2">мес</span>}
            </div>
            <div className="mt-2 text-[13.5px] text-ink-2">
              {overHorizon
                ? <>денег хватает <b className="font-semibold text-foreground">за горизонт прогноза</b></>
                : <>денег хватает до <b className="font-semibold text-foreground">{coverUntil}</b></>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-border lg:grid-cols-4 lg:border-t-0 lg:border-l">
          <Figure label="Баланс" value={`${money(balance)} ${cur}`}
            note={accountRows.length ? accountRows.slice(0, 3).map((a) => a.name).join(" · ") : undefined} />
          <Figure label="Доходы / мес" value={incomePerMonthValue != null ? `${money(incomePerMonthValue)} ${cur}` : "—"}
            note={income && Object.keys(income.by_month).length ? "в среднем" : "ожидаемое"} />
          <Figure label="Расходы / мес" value={expensesPerMonth != null ? `${money(expensesPerMonth)} ${cur}` : "—"}
            note="обязательства + траты" />
          <Figure label="Свободно / мес" green={free != null && free >= 0}
            value={free != null ? `${free >= 0 ? "+" : "−"}${money(Math.abs(free))} ${cur}` : "—"}
            note="чистый поток" />
        </div>
      </Card>

      {/* ===== график прогноза ===== */}
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-start justify-between gap-3.5 px-6 pt-5 pb-2">
          <div>
            <h3 className="text-[15.5px] font-semibold tracking-tight">Прогноз баланса</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              {PERIODS.find((p) => p.value === period)?.label} · базовый, оптимистичный и осторожный сценарии
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <div className="flex gap-px rounded-[9px] border border-border bg-card-2 p-[3px]">
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

        <div className="px-3 pb-2">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
              <defs>
                <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colAccent} stopOpacity={0.15} />
                  <stop offset="70%" stopColor={colAccent} stopOpacity={0.03} />
                  <stop offset="100%" stopColor={colAccent} stopOpacity={0} />
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

              {/* красная зона ниже нуля — риск ухода в минус */}
              <ReferenceArea y1={0} y2={-1e12} fill={colRed} fillOpacity={0.12} ifOverflow="hidden" />
              <ReferenceLine y={0} stroke={colAxis} strokeWidth={1} ifOverflow="extendDomain" />

              {/* мягкая заливка под выбранной линией */}
              <Area type="monotone" dataKey={scenario} stroke="none" fill="url(#dashArea)" isAnimationActive={false} />

              {/* линия-подушка */}
              <ReferenceLine
                y={forecast?.cushion ?? summary.cushion} stroke={colAmber}
                strokeWidth={1.3} strokeDasharray="6 6"
                label={{ value: "Подушка", position: "insideTopRight", fill: colAmber, fontSize: 11, fontWeight: 600 }}
              />

              {/* три сценария: невыбранные тоньше/полупрозрачные */}
              <Line type="monotone" dataKey="optimistic" stroke={colGreen} strokeDasharray="6 6"
                strokeWidth={scenario === "optimistic" ? 2.4 : 1.7} strokeOpacity={scenario === "optimistic" ? 1 : 0.55}
                dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pessimistic" stroke={colRed} strokeDasharray="6 6"
                strokeWidth={scenario === "pessimistic" ? 2.4 : 1.7} strokeOpacity={scenario === "pessimistic" ? 1 : 0.55}
                dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="base" stroke={colInk}
                strokeWidth={scenario === "base" ? 2.8 : 1.7} strokeOpacity={scenario === "base" ? 1 : 0.55}
                dot={false} isAnimationActive={false} />

              {/* маркеры: сегодня + самый тонкий месяц */}
              <ReferenceLine x={chartData[0]?.date} stroke={colAxis} strokeWidth={1.2} strokeDasharray="3 3" strokeOpacity={0.5}
                label={{ value: "Сегодня", position: "insideTopLeft", fill: colAxis, fontSize: 11, fontWeight: 600 }} />
              {thinnest && (
                <ReferenceLine x={thinnest.date} stroke={thinnest.value < 0 ? colRed : colAmber}
                  strokeWidth={1.2} strokeDasharray="3 3" strokeOpacity={0.6}
                  label={{
                    value: monthLabel(thinnest.date.slice(0, 7)),
                    position: "insideBottomRight",
                    fill: thinnest.value < 0 ? colRed : colAmber, fontSize: 11, fontWeight: 600,
                  }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 px-6 pt-2 pb-5">
          <div className="flex flex-wrap gap-4 text-xs text-ink-2">
            <LegendItem color={colInk}>базовый</LegendItem>
            <LegendItem color={colGreen} dashed>оптимистичный</LegendItem>
            <LegendItem color={colRed} dashed>осторожный</LegendItem>
            <LegendItem color={colAmber} dashed>подушка</LegendItem>
          </div>
          <div className="text-xs text-ink-3">Сценарий: {SCEN_LABEL[scenario]} прогноз</div>
        </div>
      </Card>

      {/* ===== три инсайта ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-[18px]">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="grid size-[30px] place-items-center rounded-lg bg-accent-soft text-primary">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v9" /><path d="M8 9l4 4 4-4" /><path d="M5 19h14" /></svg>
            </span>
            <span className="text-[13px] font-medium text-ink-2">Ожидается в этом месяце</span>
          </div>
          <div className="text-[23px] font-semibold leading-tight tracking-tight tnum">{money(expectedThisMonth)} {cur}</div>
          <div className="mt-1.5 text-xs leading-relaxed text-ink-3">
            {expectBreakdown || "Пока ничего не запланировано на этот месяц."}
          </div>
        </Card>

        <Card className="p-[18px]">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="grid size-[30px] place-items-center rounded-lg bg-pos-soft text-pos">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="M16.5 7.5C16.5 5.6 14.5 4.5 12 4.5S7.5 5.6 7.5 7.5 9.5 10.5 12 11s4.5 1.5 4.5 3.5S14.5 18 12 18s-4.5-1.1-4.5-3" /></svg>
            </span>
            <span className="text-[13px] font-medium text-ink-2">Можно потратить сверх плана</span>
          </div>
          <div className={cn("text-[23px] font-semibold leading-tight tracking-tight tnum", (free ?? 0) >= 0 && "text-pos")}>
            {free != null ? <>{free >= 0 ? "+" : "−"}{money(Math.abs(free))} {cur}</> : "—"}
          </div>
          <div className="mt-1.5 text-xs leading-relaxed text-ink-3">
            В этом месяце — без риска для срока запаса.
          </div>
        </Card>

        <Card className="p-[18px]">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="grid size-[30px] place-items-center rounded-lg bg-accent-soft text-primary">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 9.5h17M8 3v3M16 3v3" /></svg>
            </span>
            <span className="text-[13px] font-medium text-ink-2">Ближайшее крупное списание</span>
          </div>
          {nextBig ? (
            <>
              <div className="text-[23px] font-semibold leading-tight tracking-tight tnum">{money(nextBig.amount)} {cur}</div>
              <div className="mt-1.5 text-[13px] font-medium text-foreground">
                {nextBig.name} · {daysUntil <= 0 ? "сегодня" : `через ${daysUntil} дн`}
              </div>
              {nextBig2 && (
                <div className="mt-1 text-xs text-ink-3">
                  Затем {nextBig2.name} {money(nextBig2.amount)} · {ddmm(nextBig2.date)}
                </div>
              )}
            </>
          ) : (
            <div className="mt-1.5 text-xs leading-relaxed text-ink-3">
              Списаний впереди нет. Добавьте их на вкладке <Link className="underline underline-offset-4" to="/plans">Расходы</Link>.
            </div>
          )}
        </Card>
      </div>

      {/* ===== две панели ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.12fr]">
        {/* Счета */}
        <Card className="p-5">
          <div className="mb-3.5 flex items-baseline justify-between">
            <h3 className="text-[14.5px] font-semibold tracking-tight">Счета</h3>
            <span className="text-[12.5px] text-ink-3 tnum">{money(accountsTotal)} {cur} всего</span>
          </div>
          {accountRows.length ? accountRows.map((a) => (
            <div key={a.id} className="flex items-center gap-3 border-b border-line-2 py-2.5 last:border-b-0">
              <span className="grid size-[33px] flex-none place-items-center rounded-[9px] border border-border bg-card-2 text-xs font-semibold text-ink-2">
                {a.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{a.name} · {a.currency}</div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-[3px] bg-line-2">
                  <span className="block h-full rounded-[3px] bg-primary/50" style={{ width: `${Math.round((a.base / accountMax) * 100)}%` }} />
                </div>
              </div>
              <span className="flex-none whitespace-nowrap text-right text-sm font-semibold tnum">{money(a.base)} {cur}</span>
            </div>
          )) : (
            <p className="text-sm text-ink-3">
              Счетов пока нет — добавьте их в <Link className="underline underline-offset-4" to="/settings">Настройках</Link>.
            </p>
          )}
        </Card>

        {/* Куда уходят деньги */}
        <Card className="p-5">
          <div className="mb-3.5 flex items-baseline justify-between">
            <h3 className="text-[14.5px] font-semibold tracking-tight">Куда уходят деньги</h3>
            <span className="text-[12.5px] text-ink-3 tnum">{money(catTotal)} {cur} в месяц</span>
          </div>
          {catRows.length ? catRows.map((c) => (
            <div key={c.name} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 py-[7px]">
              <span className="truncate text-[13px] text-ink-2">{c.name}</span>
              <span className="h-2 overflow-hidden rounded-[5px] bg-card-2">
                <span className="block h-full rounded-[5px] bg-primary/50" style={{ width: `${Math.round((c.amount / catMax) * 100)}%` }} />
              </span>
              <span className="min-w-[52px] text-right text-[13px] font-semibold tnum">{money(c.amount)}</span>
            </div>
          )) : (
            <p className="text-sm text-ink-3">
              Регулярных расходов пока нет — добавьте их на вкладке <Link className="underline underline-offset-4" to="/plans">Расходы</Link>.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

function LegendItem({ color, dashed, children }: {
  color: string; dashed?: boolean; children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <i className="block w-4" style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }} />
      {children}
    </span>
  )
}
