import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { api, type Forecast, type Inflow, type Obligation, type Rates, type Summary } from "@/lib/api"
import { ddmm, money, nextOccurrence, todayIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Tooltip as Hint, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

function Stat({ label, value, sub, hint }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; hint?: React.ReactNode
}) {
  const card = (
    <Card className={cn("gap-1 py-4", hint && "cursor-help transition-colors hover:bg-muted/40")}>
      <CardHeader className="px-5">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
  if (!hint) return card
  return (
    <Hint>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Hint>
  )
}

function Receipt({ rows, subtotal, subtotalLabel, cur }: {
  rows: { label: string; value: number; tag?: string }[]
  subtotal: number | null
  subtotalLabel: string
  cur: string
}) {
  return (
    <div className="space-y-1">
      {rows.filter((r) => r.value !== 0).map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-6 tabular-nums">
          <span className="text-muted-foreground">
            {r.label}{r.tag && <span className="ml-1 opacity-60">{r.tag}</span>}
          </span>
          <span className={r.value < 0 ? "text-red-600" : "text-emerald-700"}>
            {r.value >= 0 ? "+" : "−"}{money(Math.abs(r.value))}
          </span>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-6 border-t border-border/60 pt-1 font-semibold tabular-nums">
        <span>{subtotalLabel}</span>
        <span>{money(subtotal)} {cur}</span>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [upcoming, setUpcoming] = useState<
    { date: string; name: string; amount: number; kind: "in" | "out"; mark?: string }[]
  >([])

  const load = useCallback(async () => {
    const [s, f, obs, infs, r] = await Promise.all([
      api.get<Summary>("/summary"),
      api.get<Forecast>("/forecast"),
      api.get<Obligation[]>("/obligations"),
      api.get<Inflow[]>("/inflows"),
      api.get<Rates>("/rates"),
    ])
    setSummary(s)
    setForecast(f)
    // Курсы к базовой валюте: всё в ленте «ближайшие 30 дней» показываем в долларах.
    const toBase = new Map<string, number>()
    for (const row of r.rates) if (row.rate_to_base != null) toBase.set(row.currency, row.rate_to_base)
    const conv = (amount: number, currency: string) => {
      const k = currency === r.base_currency ? 1 : toBase.get(currency)
      return k != null ? amount * k : null
    }
    const today = todayIso()
    const horizon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
    const up: typeof upcoming = []
    for (const o of obs) {
      if (o.status !== "planned") continue
      const occ = nextOccurrence(o.due_date, o.recurrence, today)
      const amt = conv(o.amount, o.currency)
      if (occ <= horizon && amt != null)
        up.push({ date: occ, name: o.name, amount: amt, kind: "out",
          mark: o.recurrence !== "once" ? "↻" : undefined })
    }
    for (const i of infs) {
      if (i.status !== "expected") continue
      const eff = i.expected_date < today ? today : i.expected_date
      const amt = conv(i.amount, i.currency)
      if (eff <= horizon && amt != null)
        up.push({ date: eff, name: i.name, amount: amt, kind: "in",
          mark: i.probability === "confirmed" ? "точно" : i.probability === "likely" ? "вероятно" : "может быть" })
    }
    up.sort((a, b) => a.date.localeCompare(b.date))
    setUpcoming(up)
  }, [])

  useEffect(() => { void load() }, [load])

  const chartData = useMemo(() => {
    if (!forecast) return []
    const base = forecast.scenarios.base
    return base.map(([date, value], i) => ({
      date,
      base: value,
      pessimistic: forecast.scenarios.pessimistic[i]?.[1],
      optimistic: forecast.scenarios.optimistic[i]?.[1],
    }))
  }, [forecast])

  if (!summary) return <div className="py-20 text-center text-sm text-muted-foreground">Загрузка…</div>

  const baseMin = summary.scenarios.base
  const pessMin = summary.scenarios.pessimistic
  const cur = summary.base_currency
  const pessGap = pessMin.min_total != null ? Math.max(0, summary.cushion - pessMin.min_total) : 0
  const burnSourceLabel = { derived: "выведен из снимков", manual: "ручная оценка", none: "нет данных" }[summary.burn_source]

  const t0Hint = (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">Сколько денег сейчас</p>
      <p>Последний снимок остатков, приведённый к {cur} по курсам от {ddmm(summary.rates_date)}:</p>
      <ul className="tabular-nums">
        {Object.entries(summary.t0_by_currency).map(([c, a]) => <li key={c}>{money(a)} {c}</li>)}
      </ul>
      <p className="font-medium tabular-nums">= {money(summary.t0)} {cur}</p>
    </div>
  )
  const baseB = baseMin.breakdown
  const baseHint = (
    <div className="space-y-2">
      <p className="font-medium text-foreground">Реалистичная цель</p>
      <Receipt
        cur={cur}
        rows={[
          { label: "Остаток сейчас", value: baseB.t0 },
          { label: `Burn до ${ddmm(baseMin.min_date)}`, value: -baseB.burn },
          { label: "Предстоящие расходы", value: -baseB.obligations },
          { label: "Ожидаемые приходы", value: baseB.inflows, tag: "взвеш." },
        ]}
        subtotal={baseMin.min_total}
        subtotalLabel="Минимум кэша"
      />
      <p className="text-muted-foreground">
        Подушка {money(summary.cushion)} − минимум {money(baseMin.min_total)} = <span className="font-medium text-foreground">{money(summary.gap_amount)} {cur} нужно заработать</span>.
      </p>
    </div>
  )
  const pessB = pessMin.breakdown
  const pessHint = (
    <div className="space-y-2">
      <p className="font-medium text-foreground">Если ничего не подтвердится</p>
      <Receipt
        cur={cur}
        rows={[
          { label: "Остаток сейчас", value: pessB.t0 },
          { label: `Burn до ${ddmm(pessMin.min_date)}`, value: -pessB.burn },
          { label: "Предстоящие расходы", value: -pessB.obligations },
          { label: "Точные приходы", value: pessB.inflows },
        ]}
        subtotal={pessMin.min_total}
        subtotalLabel="Минимум кэша"
      />
      <p className="text-muted-foreground">
        Без «скорее всего» и «под вопросом». Подушка {money(summary.cushion)} − минимум {money(pessMin.min_total)} = <span className="font-medium text-foreground">{money(pessGap)} {cur}</span>.
      </p>
    </div>
  )
  const snapHint = (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">Точка отсчёта</p>
      <p>Дата последнего снимка остатков. Курсы валют — от {ddmm(summary.rates_date)}.</p>
      <p>Прогноз строится от этой точки. Burn {money(summary.burn_weekly)} {cur}/нед ({burnSourceLabel}).</p>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      {summary.snapshot_stale && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {summary.last_snapshot_date
            ? <>Снимок остатков устарел (последний — {ddmm(summary.last_snapshot_date)}). <Link className="font-medium underline underline-offset-4" to="/snapshot">Обновить →</Link></>
            : <>Данных ещё нет — <Link className="font-medium underline underline-offset-4" to="/snapshot">сделай первый снимок остатков →</Link></>}
        </div>
      )}
      {summary.missing_rates.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Нет курса для: {summary.missing_rates.join(", ")} — эти суммы посчитаны по нулю.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Сейчас"
          value={<span className="text-3xl">{money(summary.t0)} <span className="text-base font-normal text-muted-foreground">{cur}</span></span>}
          sub={Object.entries(summary.t0_by_currency).map(([c, a]) => `${money(a)} ${c}`).join(" · ")}
          hint={t0Hint}
        />
        <Stat
          label="Нужно заработать"
          value={`${money(summary.gap_amount)} ${cur}`}
          sub={summary.gap_amount > 0
            ? <>реалистично · к {ddmm(summary.gap_deadline)}</>
            : <>подушка держится</>}
          hint={baseHint}
        />
        <Stat
          label="Если без приходов"
          value={`${money(pessGap)} ${cur}`}
          sub={pessGap > 0
            ? <>осторожный план · к {ddmm(pessMin.min_date)}</>
            : <>держится даже без приходов</>}
          hint={pessHint}
        />
        <Stat
          label="Снимок"
          value={ddmm(summary.last_snapshot_date)}
          sub={`курсы от ${ddmm(summary.rates_date)}`}
          hint={snapHint}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Кривая кэша, {summary.horizon_days} дней</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="baseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date" tickFormatter={(d: string) => ddmm(d)} minTickGap={48}
                tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => money(v)} width={64} tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)" tickLine={false} axisLine={false}
              />
              <Tooltip
                formatter={(value, name) => {
                  const labels: Record<string, string> = {
                    base: "базовый", pessimistic: "пессимистичный", optimistic: "оптимистичный",
                  }
                  return [`${money(Number(value))} ${cur}`, labels[String(name)] ?? String(name)]
                }}
                labelFormatter={(label) => ddmm(String(label))}
                contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
              />
              <Area type="monotone" dataKey="base" stroke="none" fill="url(#baseFill)" isAnimationActive={false} />
              <ReferenceLine y={summary.cushion} stroke="#d97706" strokeDasharray="8 5" strokeWidth={1.5} />
              <Line type="monotone" dataKey="optimistic" stroke="#059669" strokeWidth={1.3} strokeDasharray="5 4" dot={false} />
              <Line type="monotone" dataKey="pessimistic" stroke="#dc2626" strokeWidth={1.3} strokeDasharray="5 4" dot={false} />
              <Line type="monotone" dataKey="base" stroke="var(--foreground)" strokeWidth={2.2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Ближайшие 30 дней</CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Дата</TableHead>
                    <TableHead>Что</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcoming.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell className="tabular-nums text-muted-foreground">{ddmm(u.date)}</TableCell>
                      <TableCell>
                        {u.name}{" "}
                        {u.mark && <span className="text-xs text-muted-foreground">{u.mark}</span>}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${u.kind === "in" ? "text-emerald-600" : "text-red-600"}`}>
                        {u.kind === "in" ? "+" : "−"}{money(u.amount)} {cur}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                Пусто — добавь их на вкладках <Link className="underline underline-offset-4" to="/plans">Расходы</Link> и <Link className="underline underline-offset-4" to="/income">Доходы</Link>.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-mono">{cur}</Badge>
        базовая валюта · сценарии: пессимистичный = только подтверждённые поступления, базовый = взвешенные (0.7 / 0.3), оптимистичный = все
      </div>
    </div>
  )
}
