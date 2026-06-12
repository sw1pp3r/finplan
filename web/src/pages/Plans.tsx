import { useCallback, useEffect, useState } from "react"
import { api, type Expenses, type Obligation, type Ref } from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { ddmm, money, nextOccurrence, todayIso } from "@/lib/format"
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

function ExpensesSummary({ data }: { data: Expenses }) {
  const cur = data.base_currency
  const cats = Object.entries(data.by_category).sort(([, a], [, b]) => b - a)
  const max = Math.max(1, data.burn_monthly, ...cats.map(([, v]) => v))
  const Bar = ({ v }: { v: number }) => (
    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
      <div className="h-full rounded-full bg-red-500/70" style={{ width: `${(v / max) * 100}%` }} />
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ежемесячные расходы</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-xl border bg-muted/40 px-6 py-4">
          <div className="text-sm text-muted-foreground">Чтобы кэш не падал, нужно зарабатывать в месяц</div>
          <div className="text-2xl font-semibold tabular-nums">{money(data.required_monthly_income)} {cur}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            обязательства {money(data.monthly_obligations)} + burn {money(data.burn_monthly)} {cur}/мес
          </div>
        </div>

        {cats.length || data.burn_monthly > 0 ? (
          <div className="flex flex-col gap-3">
            {cats.map(([cat, total]) => (
              <div key={cat}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-medium">{cat}</span>
                  <span className="tabular-nums text-red-600">{money(total)} {cur}/мес</span>
                </div>
                <Bar v={total} />
              </div>
            ))}
            <div>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-medium text-muted-foreground">Burn · повседневные траты</span>
                <span className="tabular-nums text-red-600">{money(data.burn_monthly)} {cur}/мес</span>
              </div>
              <Bar v={data.burn_monthly} />
            </div>
            <Separator />
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">Итого в месяц</span>
              <span className="font-semibold tabular-nums">{money(data.required_monthly_income)} {cur}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Добавь повторяющиеся расходы, чтобы увидеть месячную картину.</p>
        )}

        {data.one_off_count > 0 && (
          <p className="text-xs text-muted-foreground">
            Разовые предстоящие: {money(data.one_off_total)} {cur} ({data.one_off_count}) — не входят в месячную сумму.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

const REC_LABEL = { once: "—", weekly: "нед ↻", monthly: "мес ↻", yearly: "год ↻" }
const OB_STATUS = { planned: "план", paid: "оплачено", cancelled: "отменено" }

function GhostBtn(props: React.ComponentProps<typeof Button>) {
  return <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" {...props} />
}

export default function Plans() {
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [expenses, setExpenses] = useState<Expenses | null>(null)
  const [categories, setCategories] = useState<Ref[]>([])
  // контролируемая форма (добавление + редактирование)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [recurrence, setRecurrence] = useState("once")
  const [obCurrency, setObCurrency] = useState("USD")
  const [category, setCategory] = useState("")
  // дата окончания повтора (показывается только для повторяющихся; null для разовых)
  const [recurrenceEnd, setRecurrenceEnd] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [obs, cats, exp] = await Promise.all([
      api.get<Obligation[]>("/obligations"),
      api.get<Ref[]>("/categories"),
      api.get<Expenses>("/expenses"),
    ])
    obs.sort((a, b) => (a.status === b.status ? a.due_date.localeCompare(b.due_date) : a.status === "planned" ? -1 : 1))
    setObligations(obs)
    setCategories(cats)
    setExpenses(exp)
  }, [])

  useEffect(() => { void load() }, [load])

  function resetForm() {
    setEditingId(null)
    setName(""); setAmount(""); setDueDate("")
    setRecurrence("once"); setObCurrency("USD"); setCategory(""); setRecurrenceEnd(null)
  }

  function startEdit(o: Obligation) {
    setEditingId(o.id)
    setName(o.name)
    setAmount(String(o.amount))
    setDueDate(o.due_date)
    setRecurrence(o.recurrence)
    setObCurrency(o.currency)
    setCategory(o.category ?? "")
    setRecurrenceEnd(o.recurrence_end)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || amount === "" || !dueDate) return
    const body = {
      name: name.trim(),
      amount: Number(amount),
      currency: obCurrency,
      due_date: dueDate,
      recurrence,
      recurrence_end: recurrenceEnd,
      category: category.trim() || null,
    }
    if (editingId !== null) await api.patch(`/obligations/${editingId}`, body)
    else await api.post("/obligations", body)
    resetForm()
    void load()
    void refreshCurrencies()
  }

  const setObStatus = (id: number, status: string) =>
    api.patch(`/obligations/${id}`, { status }).then(load)

  const today = todayIso()

  return (
    <div className="flex flex-col gap-6">
      {expenses && <ExpensesSummary data={expenses} />}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{editingId !== null ? "Редактировать расход" : "Предстоящие расходы"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={save} className="flex flex-wrap items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Аренда, школа, билеты…" required className="w-52" />
            <Input value={amount} onChange={(e) => setAmount(e.target.value)}
              type="number" step="any" placeholder="Сумма" required className="w-28" />
            <CurrencySelect value={obCurrency} onChange={setObCurrency} />
            <Input value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              type="date" required className="w-40" />
            <Select value={recurrence} onValueChange={(v) => { setRecurrence(v); if (v === "once") setRecurrenceEnd(null) }}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="once">разово</SelectItem>
                <SelectItem value="weekly">еженедельно</SelectItem>
                <SelectItem value="monthly">ежемесячно</SelectItem>
                <SelectItem value="yearly">ежегодно</SelectItem>
              </SelectContent>
            </Select>
            {recurrence !== "once" && (
              <Input value={recurrenceEnd ?? ""} onChange={(e) => setRecurrenceEnd(e.target.value || null)}
                type="date" className="w-40" title="Повтор до (необязательно)" placeholder="до" />
            )}
            <RefCombo options={categories} value={category} onChange={setCategory} placeholder="Категория" />
            <Button type="submit">{editingId !== null ? "Сохранить" : "Добавить"}</Button>
            {editingId !== null && (
              <Button type="button" variant="ghost" onClick={resetForm}>Отмена</Button>
            )}
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Дата</TableHead>
                <TableHead>Что</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead className="w-20">Повтор</TableHead>
                <TableHead className="w-24">Статус</TableHead>
                <TableHead className="w-56" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {obligations.map((o) => (
                <TableRow key={o.id} className={
                  editingId === o.id ? "bg-muted/50" : o.status !== "planned" ? "opacity-45" : undefined
                }>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {ddmm(o.status === "planned" ? nextOccurrence(o.due_date, o.recurrence, today) : o.due_date)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {o.name}
                    {o.category && <span className="ml-2 text-xs text-muted-foreground">{o.category}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-red-600">−{money(o.amount)} {o.currency}</TableCell>
                  <TableCell className="text-muted-foreground">{REC_LABEL[o.recurrence]}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === "planned" ? "secondary" : "outline"}>{OB_STATUS[o.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <GhostBtn onClick={() => startEdit(o)}>✎</GhostBtn>
                    {o.status === "planned" ? (
                      <>
                        <GhostBtn
                          title={o.recurrence !== "once" ? "оплатить за этот период → перейти к следующему" : undefined}
                          onClick={() => setObStatus(o.id, "paid")}>оплачено</GhostBtn>
                        <GhostBtn onClick={() => setObStatus(o.id, "cancelled")}>отмена</GhostBtn>
                      </>
                    ) : (
                      <GhostBtn onClick={() => setObStatus(o.id, "planned")}>вернуть</GhostBtn>
                    )}
                    <GhostBtn className="h-7 px-2 text-xs text-red-500" onClick={() => api.delete(`/obligations/${o.id}`).then(load)}>✕</GhostBtn>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
