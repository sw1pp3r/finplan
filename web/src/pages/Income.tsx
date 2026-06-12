import { useCallback, useEffect, useMemo, useState } from "react"
import { api, type Income as IncomeData, type Inflow, type Ref } from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { ddmm, money, monthLabel, todayIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CurrencySelect } from "@/components/CurrencySelect"
import { RefCombo } from "@/components/RefCombo"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

const INF_STATUS = { expected: "ожидается", received: "получено", lost: "потеряно" }

// цвет = уверенность, pct = вес в базовом сценарии
const PROB_STYLE = {
  confirmed: { label: "точно", pct: "100%", text: "text-emerald-600", bar: "bg-emerald-600/80" },
  likely: { label: "скорее всего", pct: "70%", text: "text-amber-600", bar: "bg-amber-500/80" },
  possible: { label: "под вопросом", pct: "30%", text: "text-slate-500", bar: "bg-slate-400/80" },
} as const
const PROB_LABEL = {
  confirmed: PROB_STYLE.confirmed.label, likely: PROB_STYLE.likely.label, possible: PROB_STYLE.possible.label,
}

function GhostBtn(props: React.ComponentProps<typeof Button>) {
  return <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" {...props} />
}

function ExpectedPipeline({ data, cur }: { data: IncomeData["expected"]; cur: string }) {
  const probMax = Math.max(1, ...Object.values(data.by_probability ?? {}))
  const monthMax = Math.max(1, ...Object.values(data.by_month ?? {}))
  const months = Object.entries(data.by_month ?? {}).sort(([a], [b]) => a.localeCompare(b))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Ожидается</CardTitle>
        <p className="text-xs text-muted-foreground">пайплайн будущих поступлений</p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">По вероятности</div>
            {(["confirmed", "likely", "possible"] as const).map((p) => {
              const v = data.by_probability[p]
              const st = PROB_STYLE[p]
              return (
                <div key={p}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium">{st.label} <span className="text-xs font-normal text-muted-foreground">{st.pct}</span></span>
                    <span className={`tabular-nums ${st.text}`}>+{money(v)} {cur}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${(v / probMax) * 100}%` }} />
                  </div>
                </div>
              )
            })}
            <Separator />
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">Всего ожидается</span>
              <span className="font-semibold tabular-nums">{money(data.total)} {cur}</span>
            </div>
            <div className="flex items-baseline justify-between text-xs text-muted-foreground">
              <span>Реалистично (взвешенно 1 / 0.7 / 0.3)</span>
              <span className="tabular-nums">{money(data.weighted)} {cur}</span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">По месяцам</div>
            {months.length ? months.map(([m, v]) => (
              <div key={m}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-medium">{monthLabel(m)}</span>
                  <span className="tabular-nums">+{money(v)} {cur}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-foreground/30" style={{ width: `${(v / monthMax) * 100}%` }} />
                </div>
              </div>
            )) : <p className="text-sm text-muted-foreground">—</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Income() {
  const [data, setData] = useState<IncomeData | null>(null)
  const [inflows, setInflows] = useState<Inflow[]>([])
  const [directions, setDirections] = useState<Ref[]>([])
  const [mode, setMode] = useState<"received" | "expected">("received")
  const [currency, setCurrency] = useState("USD")
  const [direction, setDirection] = useState("")
  const [probability, setProbability] = useState("confirmed")
  // редактирование строки (всегда PATCH /inflows/{id}, режим mode тут не при чём)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const [editCurrency, setEditCurrency] = useState("USD")
  const [editDate, setEditDate] = useState("")
  const [editProbability, setEditProbability] = useState("confirmed")
  const [editCounterparty, setEditCounterparty] = useState("")
  const [editDirection, setEditDirection] = useState("")

  const load = useCallback(async () => {
    const [inc, infs, dirs] = await Promise.all([
      api.get<IncomeData>("/income"),
      api.get<Inflow[]>("/inflows"),
      api.get<Ref[]>("/directions"),
    ])
    setData(inc)
    setInflows(infs)
    setDirections(dirs)
  }, [])
  useEffect(() => { void load() }, [load])

  const counterparties = useMemo(() => {
    const c = new Set<string>()
    inflows.forEach((i) => { if (i.counterparty) c.add(i.counterparty) })
    return [...c].sort()
  }, [inflows])

  // ожидаемые сверху по дате ↑, факты снизу по дате ↓
  const rows = useMemo(() => {
    return [...inflows].sort((a, b) => {
      const ae = a.status === "expected" ? 0 : 1
      const be = b.status === "expected" ? 0 : 1
      if (ae !== be) return ae - be
      return ae === 0
        ? a.expected_date.localeCompare(b.expected_date)
        : b.expected_date.localeCompare(a.expected_date)
    })
  }, [inflows])

  if (!data) return <div className="py-20 text-center text-sm text-muted-foreground">Загрузка…</div>

  const cur = data.base_currency
  const maxDirection = Math.max(1, ...Object.values(data.by_direction))

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formEl = e.currentTarget
    const fd = new FormData(formEl)
    if (mode === "received") {
      await api.post("/income", {
        amount: Number(fd.get("amount")),
        currency,
        counterparty: (fd.get("counterparty") as string) || null,
        direction: direction.trim() || null,
        received_date: fd.get("received_date"),
      })
    } else {
      await api.post("/inflows", {
        amount: Number(fd.get("amount")),
        currency,
        expected_date: fd.get("expected_date"),
        probability,
        counterparty: (fd.get("counterparty") as string) || null,
        direction: direction.trim() || null,
      })
    }
    formEl.reset()
    setDirection("")
    void load()
    void refreshCurrencies()
  }

  const setInfStatus = (id: number, status: string) =>
    api.patch(`/inflows/${id}`, { status }).then(load)

  function startEdit(i: Inflow) {
    setEditingId(i.id)
    setEditAmount(String(i.amount))
    setEditCurrency(i.currency)
    setEditDate(i.expected_date)
    setEditProbability(i.probability)
    setEditCounterparty(i.counterparty ?? "")
    setEditDirection(i.direction ?? "")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function resetEdit() {
    setEditingId(null)
    setEditAmount(""); setEditCurrency("USD"); setEditDate("")
    setEditProbability("confirmed"); setEditCounterparty(""); setEditDirection("")
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (editAmount === "") return
    await api.patch(`/inflows/${editingId}`, {
      amount: Number(editAmount),
      currency: editCurrency,
      expected_date: editDate,
      probability: editProbability,
      counterparty: editCounterparty.trim() || null,
      direction: editDirection.trim() || null,
    })
    resetEdit()
    void load()
    void refreshCurrencies()
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Деньги на входе</CardTitle>
          <p className="text-sm text-muted-foreground">
            {mode === "received"
              ? "Факт: сколько, от кого и по какому направлению. Объясняет скачок остатков — burn rate точнее. Архивные доходы записывай реальной датой: всё до первого снимка не трогает прогноз, попадает только в сводки."
              : "Ожидаемое поступление с вероятностью. Попадает в прогноз (взвешенно по сценариям). Получишь — жми «получено», оно станет фактом дохода."}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="inline-flex w-fit rounded-lg border bg-muted/40 p-0.5 text-sm">
            <button type="button" onClick={() => setMode("received")}
              className={cn("rounded-md px-3 py-1 transition-colors",
                mode === "received" ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}>
              Получено
            </button>
            <button type="button" onClick={() => setMode("expected")}
              className={cn("rounded-md px-3 py-1 transition-colors",
                mode === "expected" ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}>
              Ожидается
            </button>
          </div>

          {mode === "received" ? (
            <form key="received" onSubmit={submit} className="flex flex-wrap items-center gap-2">
              <Input name="received_date" type="date" defaultValue={todayIso()} className="w-40" />
              <Input name="amount" type="number" step="any" placeholder="Сумма" required className="w-28" />
              <CurrencySelect value={currency} onChange={setCurrency} />
              <Input name="counterparty" placeholder="От кого (Atamura…)" list="dl-cp" className="w-44" />
              <RefCombo options={directions} value={direction} onChange={setDirection} placeholder="Направление" />
              <Button type="submit">Записать</Button>
            </form>
          ) : (
            <form key="expected" onSubmit={submit} className="flex flex-wrap items-center gap-2">
              <Input name="amount" type="number" step="any" placeholder="Сумма" required className="w-28" />
              <CurrencySelect value={currency} onChange={setCurrency} />
              <Input name="expected_date" type="date" required className="w-40" />
              <Select value={probability} onValueChange={setProbability}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">точно (100%)</SelectItem>
                  <SelectItem value="likely">скорее всего (70%)</SelectItem>
                  <SelectItem value="possible">под вопросом (30%)</SelectItem>
                </SelectContent>
              </Select>
              <Input name="counterparty" placeholder="От кого (Oasis…)" list="dl-cp" className="w-44" />
              <RefCombo options={directions} value={direction} onChange={setDirection} placeholder="Направление" />
              <Button type="submit">Добавить</Button>
            </form>
          )}
          <datalist id="dl-cp">{counterparties.map((c) => <option key={c} value={c} />)}</datalist>
        </CardContent>
      </Card>

      {editingId !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Редактировать поступление</CardTitle>
          </CardHeader>
          <CardContent>
            <form key="edit" onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
              <Input value={editAmount} onChange={(e) => setEditAmount(e.target.value)}
                type="number" step="any" placeholder="Сумма" required className="w-28" />
              <CurrencySelect value={editCurrency} onChange={setEditCurrency} />
              <Input value={editDate} onChange={(e) => setEditDate(e.target.value)}
                type="date" required className="w-40" />
              <Select value={editProbability} onValueChange={setEditProbability}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">точно (100%)</SelectItem>
                  <SelectItem value="likely">скорее всего (70%)</SelectItem>
                  <SelectItem value="possible">под вопросом (30%)</SelectItem>
                </SelectContent>
              </Select>
              <Input value={editCounterparty} onChange={(e) => setEditCounterparty(e.target.value)}
                placeholder="От кого" className="w-44" />
              <RefCombo options={directions} value={editDirection} onChange={setEditDirection} placeholder="Направление" />
              <Button type="submit">Сохранить</Button>
              <Button type="button" variant="ghost" onClick={resetEdit}>Отмена</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {data.expected.total > 0 && <ExpectedPipeline data={data.expected} cur={cur} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">По направлениям</CardTitle>
            <p className="text-xs text-muted-foreground">фактически полученные доходы</p>
          </CardHeader>
          <CardContent>
            {Object.keys(data.by_direction).length ? (
              <div className="flex flex-col gap-3">
                {Object.entries(data.by_direction)
                  .sort(([, a], [, b]) => b - a)
                  .map(([dir, total]) => (
                    <div key={dir}>
                      <div className="mb-1 flex items-baseline justify-between text-sm">
                        <span className="font-medium">{dir}</span>
                        <span className="tabular-nums text-emerald-600">+{money(total)} {cur}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-emerald-600/80" style={{ width: `${(total / maxDirection) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                <Separator />
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold">Итого</span>
                  <span className="font-semibold tabular-nums">{money(data.total)} {cur}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Пока пусто.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">По месяцам</CardTitle>
            <p className="text-xs text-muted-foreground">фактически полученные доходы</p>
          </CardHeader>
          <CardContent>
            {Object.keys(data.by_month).length ? (
              <Table>
                <TableBody>
                  {Object.entries(data.by_month)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([m, total]) => (
                      <TableRow key={m}>
                        <TableCell className="font-medium">{monthLabel(m)}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">+{money(total)} {cur}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Пока пусто.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Все поступления</CardTitle>
          <p className="text-xs text-muted-foreground">ожидаемые и полученные — одна лента</p>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Дата</TableHead>
                  <TableHead>От кого / что</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead className="w-32">Статус</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i) => (
                  <TableRow key={i.id} className={i.status === "lost" ? "opacity-45" : undefined}>
                    <TableCell className="tabular-nums text-muted-foreground">{ddmm(i.expected_date)}</TableCell>
                    <TableCell className="font-medium">{i.counterparty || i.name}</TableCell>
                    <TableCell className="text-muted-foreground">{i.direction ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600">+{money(i.amount)} {i.currency}</TableCell>
                    <TableCell>
                      <Badge variant={i.status === "received" ? "secondary" : "outline"}>{INF_STATUS[i.status]}</Badge>
                      {i.status === "expected" && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{PROB_LABEL[i.probability]}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <GhostBtn onClick={() => startEdit(i)}>✎</GhostBtn>
                      {i.status === "expected" ? (
                        <>
                          <GhostBtn onClick={() => setInfStatus(i.id, "received")}>получено</GhostBtn>
                          <GhostBtn onClick={() => setInfStatus(i.id, "lost")}>потеряно</GhostBtn>
                        </>
                      ) : (
                        <GhostBtn onClick={() => setInfStatus(i.id, "expected")}>вернуть</GhostBtn>
                      )}
                      <GhostBtn className="h-7 px-2 text-xs text-red-500" onClick={() => api.delete(`/inflows/${i.id}`).then(load)}>✕</GhostBtn>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              Пока пусто — запиши доход или добавь ожидаемое поступление выше.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
