import { useCallback, useEffect, useState } from "react"
import { api, type Course } from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CurrencySelect } from "@/components/CurrencySelect"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

const COHORT = [
  { v: 1, label: "каждый месяц" },
  { v: 2, label: "раз в 2 месяца" },
  { v: 3, label: "раз в квартал" },
  { v: 6, label: "раз в полгода" },
  { v: 12, label: "раз в год" },
]
const cohortLabel = (m: number) => COHORT.find((c) => c.v === m)?.label ?? `раз в ${m} мес`

/** Число с правкой по месту: коммитит на blur, только если значение изменилось. */
function NumCell({ value, onCommit, className }: {
  value: number; onCommit: (v: number) => void; className?: string
}) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  return (
    <Input
      type="number" step="any" value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = Number(v); if (n !== value && !Number.isNaN(n)) onCommit(n) }}
      className={cn("h-8 tabular-nums", className)}
    />
  )
}

/** Строка «чека»: подпись слева, знаковая сумма справа. */
function Line({ label, value, cur, sign }: {
  label: string; value: number; cur: string; sign: "+" | "−"
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", sign === "−" ? "text-red-600" : "text-emerald-600")}>
        {sign}{money(value)} {cur}
      </span>
    </div>
  )
}

/** За сколько месяцев профита курс закроет разовую/накопленную сумму. */
function coverMonths(amount: number, net: number): string {
  if (net <= 0) return "курс пока в минусе"
  const m = amount / net
  if (m <= 1) return "закроет меньше чем за месяц"
  return `закроет за ~${Math.ceil(m)} мес`
}

const COVER_TONE = {
  ok: "bg-emerald-500/10 text-emerald-700",
  slow: "bg-amber-500/10 text-amber-700",
  bad: "bg-red-500/10 text-red-700",
}
function coverTone(amount: number, net: number): keyof typeof COVER_TONE {
  if (net <= 0) return "bad"
  return amount / net <= 6 ? "ok" : "slow"
}

/** Реальный предстоящий расход плашкой: цвет — по скорости покрытия курсом. */
function CoverLine({ label, sub, amount, net, cur }: {
  label: string; sub?: string; amount: number; net: number; cur: string
}) {
  return (
    <div className={cn(
      "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg px-3 py-2 text-sm",
      COVER_TONE[coverTone(amount, net)],
    )}>
      <span>{label}{sub && <span className="opacity-60"> · {sub}</span>}</span>
      <span className="text-right tabular-nums">
        <b>{money(amount)} {cur}</b>
        <span className="opacity-70"> — {coverMonths(amount, net)}</span>
      </span>
    </div>
  )
}

function Economics({ data }: { data: Course }) {
  const cur = data.base_currency
  const covers = data.net_vs_required >= 0
  const pct = data.required_monthly_income > 0
    ? Math.round((data.net_monthly / data.required_monthly_income) * 100)
    : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Экономика курса</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 sm:flex-row sm:gap-8">
        {/* итог */}
        <div className="flex-1">
          <div className="text-sm text-muted-foreground">Чистая прибыль</div>
          <div className={cn("text-3xl font-semibold tabular-nums",
            data.net_monthly >= 0 ? "text-emerald-600" : "text-red-600")}>
            {money(data.net_monthly)} {cur}<span className="text-lg text-muted-foreground">/мес</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.students_total} учеников · поток {cohortLabel(data.cohort_months)} ·
            {" "}{money(data.net_per_cohort)} {cur} за поток
          </div>

          <Separator className="my-4" />

          {/* влияние на метрики */}
          <div className="text-sm text-muted-foreground">Нужно зарабатывать в месяц</div>
          <div className="text-xl font-semibold tabular-nums">{money(data.required_monthly_income)} {cur}</div>
          <div className={cn("mt-2 rounded-lg px-3 py-2 text-sm",
            covers ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700")}>
            {covers ? (
              <>Курс покрывает всё{data.net_vs_required > 0 && <> и оставляет <b className="tabular-nums">{money(data.net_vs_required)} {cur}/мес</b> сверху</>}.</>
            ) : (
              <>Курс закрывает часть — не хватает <b className="tabular-nums">{money(-data.net_vs_required)} {cur}/мес</b>.</>
            )}
            {pct !== null && <span className="text-muted-foreground"> ({pct}% от необходимого)</span>}
          </div>

          {(data.one_off_total > 0 || data.gap_amount > 0) && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Против предстоящих расходов
              </div>
              <div className="flex flex-col gap-2">
                {data.one_off_total > 0 && (
                  <CoverLine label="Разовые впереди" sub={`${data.one_off_count} шт`}
                    amount={data.one_off_total} net={data.net_monthly} cur={cur} />
                )}
                {data.gap_amount > 0 && (
                  <CoverLine label="Дефицит до подушки"
                    amount={data.gap_amount} net={data.net_monthly} cur={cur} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* чек */}
        <div className="w-full max-w-xs rounded-xl border bg-muted/40 px-5 py-4">
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Как считается /мес</div>
          <div className="flex flex-col gap-1.5">
            <Line label="Выручка" value={data.gross_monthly} cur={cur} sign="+" />
            {data.fixed_monthly > 0 && <Line label="Фикс-расходы" value={data.fixed_monthly} cur={cur} sign="−" />}
            {data.variable_monthly > 0 && <Line label="На учеников" value={data.variable_monthly} cur={cur} sign="−" />}
            <Separator className="my-1.5" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">Чистыми</span>
              <span className={cn("font-semibold tabular-nums",
                data.net_monthly >= 0 ? "text-emerald-600" : "text-red-600")}>
                {money(data.net_monthly)} {cur}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function CoursePage() {
  const [data, setData] = useState<Course | null>(null)
  const [tName, setTName] = useState("")
  const [tCurrency, setTCurrency] = useState("USD")
  const [cName, setCName] = useState("")
  const [costCurrency, setCostCurrency] = useState("USD")
  const [costKind, setCostKind] = useState("monthly")

  const load = useCallback(async () => {
    const c = await api.get<Course>("/course")
    setData(c)
    setTCurrency((prev) => (c.tariffs.length ? c.tariffs[c.tariffs.length - 1].currency : prev))
    setCostCurrency((prev) => (c.costs.length ? c.costs[c.costs.length - 1].currency : prev))
  }, [])

  useEffect(() => { void load() }, [load])

  async function addTariff(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formEl = e.currentTarget
    const fd = new FormData(formEl)
    await api.post("/course/tariffs", {
      name: fd.get("name"),
      price: Number(fd.get("price")),
      currency: tCurrency,
      students: Number(fd.get("students")) || 0,
    })
    formEl.reset()
    setTName("")
    await load()
    void refreshCurrencies()
  }

  const patchTariff = (id: number, body: Record<string, unknown>) =>
    api.patch(`/course/tariffs/${id}`, body).then(load)
  const patchConfig = (body: Record<string, unknown>) =>
    api.patch("/course/config", body).then(load)

  async function addCost(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formEl = e.currentTarget
    const fd = new FormData(formEl)
    await api.post("/course/costs", {
      name: fd.get("name"),
      amount: Number(fd.get("amount")),
      currency: costCurrency,
      kind: costKind,
    })
    formEl.reset()
    setCName("")
    await load()
    void refreshCurrencies()
  }

  const patchCost = (id: number, body: Record<string, unknown>) =>
    api.patch(`/course/costs/${id}`, body).then(load).then(() => refreshCurrencies())

  if (!data) return <p className="text-sm text-muted-foreground">Загрузка…</p>
  const cur = data.base_currency

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Песочница: прикинь экономику курса и посмотри, закрывает ли он твою месячную планку.
        На реальный прогноз не влияет.
      </p>

      <Economics data={data} />

      {data.missing_rates.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 px-4 py-2 text-sm text-amber-700">
          Нет курса для {data.missing_rates.join(", ")} — считается как 0.
          Добавь курс в Настройках → Курсы валют.
        </div>
      )}

      {/* тарифы */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Тарифы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={addTariff} className="flex flex-wrap items-center gap-2">
            <Input name="name" value={tName} onChange={(e) => setTName(e.target.value)}
              placeholder="Базовый, Про, VIP…" required className="w-44" />
            <Input name="price" type="number" step="any" placeholder="Цена" required className="w-28" />
            <CurrencySelect value={tCurrency} onChange={setTCurrency} />
            <Input name="students" type="number" placeholder="Учеников" className="w-28" />
            <Button type="submit">Добавить</Button>
          </form>

          {data.tariffs.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Тариф</TableHead>
                  <TableHead className="w-32">Цена</TableHead>
                  <TableHead className="w-28">Учеников</TableHead>
                  <TableHead className="text-right">За поток</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tariffs.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <NumCell value={t.price} onCommit={(v) => patchTariff(t.id, { price: v })} className="w-20" />
                        <span className="text-xs text-muted-foreground">{t.currency}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <NumCell value={t.students} onCommit={(v) => patchTariff(t.id, { students: Math.round(v) })} className="w-16" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600">
                      +{money(t.gross_base)} {cur}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-500"
                        onClick={() => api.delete(`/course/tariffs/${t.id}`).then(load)}>✕</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Добавь хотя бы один тариф, чтобы увидеть экономику.</p>
          )}
        </CardContent>
      </Card>

      {/* расходы */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Расходы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={addCost} className="flex flex-wrap items-center gap-2">
            <Input name="name" value={cName} onChange={(e) => setCName(e.target.value)}
              placeholder="Реклама, площадка, ассистент…" required className="w-52" />
            <Input name="amount" type="number" step="any" placeholder="Сумма" required className="w-28" />
            <CurrencySelect value={costCurrency} onChange={setCostCurrency} />
            <Select value={costKind} onValueChange={setCostKind}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">в месяц</SelectItem>
                <SelectItem value="per_student">на ученика</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit">Добавить</Button>
          </form>

          {data.costs.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Расход</TableHead>
                  <TableHead className="w-32">Сумма</TableHead>
                  <TableHead className="w-32">Тип</TableHead>
                  <TableHead className="text-right">В месяц</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.costs.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <NumCell value={c.amount} onCommit={(v) => patchCost(c.id, { amount: v })} className="w-20" />
                        <span className="text-xs text-muted-foreground">{c.currency}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select value={c.kind} onValueChange={(v) => patchCost(c.id, { kind: v })}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">в месяц</SelectItem>
                          <SelectItem value="per_student">на ученика</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">
                      −{money(c.monthly_base)} {cur}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-500"
                        onClick={() => api.delete(`/course/costs/${c.id}`).then(load)}>✕</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              Пока без расходов — вся выручка идёт в прибыль. Добавь рекламу, площадку, ассистента отдельными строками
              («на ученика» — для затрат, что растут с числом учеников: проверка работ, поддержка).
            </p>
          )}
        </CardContent>
      </Card>

      {/* параметры */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Параметры</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Поток запускается</span>
            <Select value={String(data.cohort_months)} onValueChange={(v) => patchConfig({ cohort_months: Number(v) })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COHORT.map((c) => <SelectItem key={c.v} value={String(c.v)}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
