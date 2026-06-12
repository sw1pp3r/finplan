import { useCallback, useEffect, useState } from "react"
import { api, type Ref, type Summary, type WishItem, type Wishes as WishesData } from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { ddmm, money } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CurrencySelect } from "@/components/CurrencySelect"
import { RefCombo } from "@/components/RefCombo"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

const PRIORITY = [
  { value: "high", label: "высокий" },
  { value: "medium", label: "средний" },
  { value: "low", label: "низкий" },
]
const PRIORITY_LABEL: Record<string, string> = { high: "высокий", medium: "средний", low: "низкий" }
const PRIORITY_ORDER = ["high", "medium", "low"]

export default function Wishes() {
  const [data, setData] = useState<WishesData | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [categories, setCategories] = useState<Ref[]>([])
  // форма (контролируемая — чтобы префиллить при редактировании)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [priority, setPriority] = useState("medium")
  const [targetDate, setTargetDate] = useState("")
  const [category, setCategory] = useState("")

  const load = useCallback(async () => {
    const [w, s, cats] = await Promise.all([
      api.get<WishesData>("/wishes"),
      api.get<Summary>("/summary"),
      api.get<Ref[]>("/categories"),
    ])
    setData(w)
    setSummary(s)
    setCategories(cats)
  }, [])
  useEffect(() => { void load() }, [load])

  if (!data || !summary) return <div className="py-20 text-center text-sm text-muted-foreground">Загрузка…</div>

  const cur = data.base_currency
  // запас над подушкой: минимум базового сценария − подушка
  const headroom = (summary.scenarios.base.min_total ?? 0) - summary.cushion

  function affordability(amountBase: number) {
    if (amountBase <= headroom) return { label: "по карману", cls: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" }
    if (amountBase <= headroom * 1.5 || amountBase <= headroom + summary!.cushion)
      return { label: "впритык", cls: "bg-amber-100 text-amber-800 hover:bg-amber-100" }
    return { label: "не хватает", cls: "bg-red-100 text-red-800 hover:bg-red-100" }
  }

  function resetForm() {
    setEditingId(null)
    setName(""); setAmount(""); setCurrency("USD")
    setPriority("medium"); setTargetDate(""); setCategory("")
  }

  function startEdit(w: WishItem) {
    setEditingId(w.id)
    setName(w.name)
    setAmount(String(w.amount))
    setCurrency(w.currency)
    setPriority(w.priority)
    setTargetDate(w.target_date ?? "")
    setCategory(w.category ?? "")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || amount === "") return
    const body = {
      name: name.trim(),
      amount: Number(amount),
      currency,
      priority,
      target_date: targetDate || null,
      category: category.trim() || null,
    }
    if (editingId !== null) {
      await api.patch(`/wishes/${editingId}`, body)
    } else {
      await api.post("/wishes", body)
    }
    resetForm()
    void load()
    void refreshCurrencies()
  }

  async function promote(id: number) {
    await api.post(`/wishes/${id}/promote`, {})
    void load()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border bg-muted/40 px-6 py-4">
        <div className="text-sm text-muted-foreground">Свободно над подушкой (минимум прогноза − подушка)</div>
        <div className={`text-2xl font-semibold tabular-nums ${headroom >= 0 ? "" : "text-red-600"}`}>
          {money(headroom)} {cur}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Покупки не входят в прогноз. Бейдж показывает, влезает ли покупка в этот запас. «В расходы» переносит её в реальные обязательства.
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{editingId !== null ? "Редактировать покупку" : "Новая покупка"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="flex flex-wrap items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Что хочу купить (iPhone, отпуск…)" required className="w-52" />
            <Input value={amount} onChange={(e) => setAmount(e.target.value)}
              type="number" step="any" placeholder="Цена" required className="w-28" />
            <CurrencySelect value={currency} onChange={setCurrency} />
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITY.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
              type="date" className="w-40" title="Желаемая дата (необязательно)" />
            <RefCombo options={categories} value={category} onChange={setCategory} placeholder="Категория" />
            <Button type="submit">{editingId !== null ? "Сохранить" : "Добавить"}</Button>
            {editingId !== null && (
              <Button type="button" variant="ghost" onClick={resetForm}>Отмена</Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Список покупок</CardTitle>
          {Object.keys(data.by_priority).length > 0 && (
            <p className="text-sm text-muted-foreground">
              {PRIORITY_ORDER.filter((p) => data.by_priority[p]).map((p) =>
                `${PRIORITY_LABEL[p]}: ${money(data.by_priority[p])} ${cur}`).join(" · ")}
              {" · "}всего {money(data.total)} {cur}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {data.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Что</TableHead>
                  <TableHead className="w-24">Приоритет</TableHead>
                  <TableHead className="w-20">Когда</TableHead>
                  <TableHead className="text-right">Цена</TableHead>
                  <TableHead className="w-28 text-center">Доступность</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((w) => {
                  const aff = affordability(w.amount_base)
                  return (
                    <TableRow key={w.id} className={editingId === w.id ? "bg-muted/50" : undefined}>
                      <TableCell className="font-medium">
                        {w.name}
                        {w.category && <span className="ml-2 text-xs text-muted-foreground">{w.category}</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{PRIORITY_LABEL[w.priority]}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{w.target_date ? ddmm(w.target_date) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(w.amount)} {w.currency}
                        {w.currency !== cur && <span className="ml-1 text-xs text-muted-foreground">≈{money(w.amount_base)} {cur}</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={aff.cls}>{aff.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => startEdit(w)}>✎</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => promote(w.id)}>
                          В расходы →
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-500"
                          onClick={() => api.delete(`/wishes/${w.id}`).then(load)}>✕</Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Пока пусто — добавь то, что хотел бы купить.</p>

          )}
        </CardContent>
      </Card>
    </div>
  )
}
