import { useCallback, useEffect, useMemo, useState } from "react"
import { api, type Expenses, type Obligation, type Ref } from "@/lib/api"
import { useCoach, COACH_STEPS } from "@/lib/coach"
import { refreshCurrencies } from "@/lib/currencies"
import { useConverter } from "@/lib/fx"
import { cn } from "@/lib/utils"
import { ddmm, money, nextOccurrence, todayIso } from "@/lib/format"
import { BaseAside } from "@/components/BaseAside"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CurrencySelect } from "@/components/CurrencySelect"
import { RefCombo } from "@/components/RefCombo"
import { SectionHelp } from "@/components/SectionHelp"
import { InfoHint } from "@/components/InfoHint"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

const REC_OPTIONS = [
  { value: "once", label: "Разовый" },
  { value: "weekly", label: "Еженедельно" },
  { value: "monthly", label: "Ежемесячно" },
  { value: "yearly", label: "Ежегодно" },
] as const
const REC_LABEL: Record<string, string> = {
  once: "Разовый", weekly: "Еженедельно", monthly: "Ежемесячно", yearly: "Ежегодно",
}
const REC_SHORT: Record<string, string> = {
  once: "разовый", weekly: "еженедельно", monthly: "ежемесячно", yearly: "ежегодно",
}

type Filter = "all" | "recur" | "once"

// ── иконки (из макета) ───────────────────────────────────────────────────────
const Repeat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
    <path d="M17 2l3 3-3 3" /><path d="M3 11V9a4 4 0 0 1 4-4h13" /><path d="M7 22l-3-3 3-3" /><path d="M21 13v2a4 4 0 0 1-4 4H4" />
  </svg>
)
const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
    <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" />
  </svg>
)
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" className="h-[14px] w-[14px]">
    <path d="M5 12l5 5L20 6" />
  </svg>
)
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
)
const PlusIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const DotsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
    <circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" />
  </svg>
)

// одна сетка для read-row и form-row — колонки совпадают, нет «прыжка» при редактировании
const GRID =
  "grid grid-cols-[40px_minmax(0,1fr)_minmax(120px,158px)] items-center gap-3.5 " +
  "lg:grid-cols-[40px_minmax(0,1fr)_158px_124px_126px_120px]"
const ACTION_RAIL =
  "relative mt-3 flex flex-wrap items-center justify-end gap-1 border-t border-line-2 pt-3 opacity-100 " +
  "lg:pointer-events-none lg:absolute lg:right-3.5 lg:top-1/2 lg:mt-0 lg:-translate-y-1/2 " +
  "lg:border-t-0 lg:bg-gradient-to-l lg:from-card-2 lg:from-[28%] lg:to-transparent lg:pl-9 lg:pt-0 " +
  "lg:opacity-0 lg:transition-opacity lg:group-hover:pointer-events-auto lg:group-hover:opacity-100"

// ── модуль «Ежемесячные расходы» + точка безубыточности ──────────────────────
function Breakeven({ data }: { data: Expenses }) {
  const cur = data.base_currency
  const cats = Object.entries(data.by_category).sort(([, a], [, b]) => b - a)
  const rows: { label: string; v: number }[] = cats.map(([c, v]) => ({ label: c, v }))
  if (data.burn_monthly > 0) rows.push({ label: "Повседневные траты", v: data.burn_monthly })
  rows.sort((a, b) => b.v - a.v)
  const total = data.required_monthly_income
  const mx = Math.max(1, ...rows.map((r) => r.v))

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
      {/* breakeven — главный ответ, поэтому слева */}
      <Card className="relative flex flex-col gap-0 overflow-hidden px-6 py-[22px]">
        <span aria-hidden className="absolute inset-y-[18px] left-0 w-[3px] rounded-[3px] bg-pos" />
        <span className="flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-pos-soft py-1 pl-2 pr-[11px]">
          <i className="h-[7px] w-[7px] shrink-0 rounded-full bg-pos" />
          <span className="text-xs font-semibold text-pos">Точка безубыточности</span>
        </span>
        <span className="mt-4 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          Сколько нужно зарабатывать
        </span>
        <div className="tnum mt-[5px] text-[34px] font-semibold leading-[1.05] tracking-[-0.035em]">
          ≈ {money(total)} {cur}
          <span className="text-[15px] font-medium text-ink-3"> / мес</span>
        </div>
        <p className="mt-[7px] text-pretty text-[13.5px] text-ink-2">
          Чтобы выходить в ноль, нужно зарабатывать <b className="font-semibold text-foreground">≈ {money(total)} {cur}</b> в&nbsp;месяц:
          регулярные платежи и повседневные траты.
        </p>
        <div className="mt-auto flex gap-6 border-t border-line-2 pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="whitespace-nowrap text-[11.5px] text-ink-3">Регулярные платежи</span>
            <span className="tnum whitespace-nowrap text-base font-semibold">{money(data.monthly_obligations)} {cur}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="whitespace-nowrap text-[11.5px] text-ink-3">Повседневные траты</span>
            <span className="tnum whitespace-nowrap text-base font-semibold">{money(data.burn_monthly)} {cur}</span>
          </div>
        </div>
        {data.one_off_count > 0 && (
          <p className="mt-3 text-[11.5px] text-ink-3">
            Разовые предстоящие: {money(data.one_off_total)} {cur} ({data.one_off_count}) — не входят в месячную сумму.
          </p>
        )}
      </Card>

      {/* breakdown */}
      <Card className="gap-0 px-6 py-[22px]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">
            Ежемесячные расходы
            <InfoHint>Сколько нужно зарабатывать в месяц, чтобы деньги не таяли: регулярные платежи + повседневные траты.</InfoHint>
          </span>
          <span className="tnum text-sm font-semibold text-ink-2">
            всего <b className="text-[15px] font-semibold text-foreground">{money(total)} {cur}</b> / мес
          </span>
        </div>
        {rows.length ? (
          <div className="flex flex-col gap-[13px]">
            {rows.map((r) => {
              const lead = total > 0 && r.v / total > 0.25
              return (
                <div key={r.label} className="grid grid-cols-[128px_minmax(0,1fr)_auto] items-center gap-3">
                  <span className="truncate text-[13.5px] text-ink-2">{r.label}</span>
                  <span className="h-2 overflow-hidden rounded-[5px] bg-card-2">
                    <i className={cn("block h-full rounded-[5px]", lead ? "bg-primary/55" : "bg-ink-3/40")}
                      style={{ width: `${(r.v / mx * 100).toFixed(0)}%` }} />
                  </span>
                  <span className="tnum min-w-[54px] text-right text-[13.5px] font-semibold">{money(r.v)} {cur}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Добавь повторяющиеся расходы, чтобы увидеть месячную картину.</p>
        )}
      </Card>
    </section>
  )
}

// ── чип статуса ──────────────────────────────────────────────────────────────
function StatusChip({ obligation }: { obligation: Obligation }) {
  if (obligation.status === "planned" && obligation.paid_amount > 0) {
    return (
      <span className="inline-flex min-w-[118px] items-center justify-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-[3px] text-[11.5px] font-semibold text-primary">
        <i className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Частично
      </span>
    )
  }
  const map = {
    planned: { cls: "bg-warn-soft text-warn", dot: "bg-warn", label: "Запланировано" },
    paid: { cls: "bg-pos-soft text-pos", dot: "bg-pos", label: "Оплачено" },
    cancelled: { cls: "bg-card-2 text-ink-3", dot: "bg-ink-3", label: "Отменено" },
  } as const
  const s = map[obligation.status]
  return (
    <span className={cn("inline-flex min-w-[118px] items-center justify-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold", s.cls)}>
      <i className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />{s.label}
    </span>
  )
}

function PaymentDialog({ obligation, onClose, onPaid }: {
  obligation: Obligation
  onClose: () => void
  onPaid: (amount: number) => Promise<void>
}) {
  const remaining = obligation.remaining_amount
  const [partial, setPartial] = useState("")
  const partialAmount = Number(partial)
  const partialValid = partial !== "" && partialAmount > 0 && partialAmount <= remaining

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 p-4" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose()
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="payment-title"
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="payment-title" className="text-lg font-semibold tracking-tight">Оплата расхода</h2>
            <p className="mt-1 text-sm text-ink-2">{obligation.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть диалог"
            className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-card-2 hover:text-foreground">×</button>
        </div>

        <div className="mt-5 rounded-lg bg-card-2 px-4 py-3">
          <span className="text-xs text-ink-3">Осталось оплатить</span>
          <div className="tnum mt-1 text-2xl font-semibold">{money(remaining)} {obligation.currency}</div>
          {obligation.paid_amount > 0 && (
            <p className="mt-1 text-xs text-ink-3">
              Уже оплачено {money(obligation.paid_amount)} из {money(obligation.amount)} {obligation.currency}
            </p>
          )}
        </div>

        <Button type="button" className="mt-4 w-full" onClick={() => void onPaid(remaining)}>
          <CheckIcon />Оплатить полностью
        </Button>

        <div className="my-4 flex items-center gap-3 text-xs text-ink-3">
          <span className="h-px flex-1 bg-line-2" />или частично<span className="h-px flex-1 bg-line-2" />
        </div>
        <div className="flex gap-2">
          <Input type="number" min="0.01" max={remaining} step="any" value={partial}
            onChange={(e) => setPartial(e.target.value)} aria-label="Сумма частичной оплаты"
            placeholder="Сумма" className="tnum" autoFocus />
          <Button type="button" variant="outline" disabled={!partialValid}
            onClick={() => void onPaid(partialAmount)} className="shrink-0">
            Оплатить частично
          </Button>
        </div>
      </section>
    </div>
  )
}

export default function Plans() {
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [expenses, setExpenses] = useState<Expenses | null>(null)
  const [categories, setCategories] = useState<Ref[]>([])
  const [filter, setFilter] = useState<Filter>("all")
  // форма: adding (новый) | editingId (правка существующего) | null (закрыта)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [recurrence, setRecurrence] = useState("once")
  const [obCurrency, setObCurrency] = useState("USD")
  const [category, setCategory] = useState("")
  const [status, setStatus] = useState("planned")
  const [recurrenceEnd, setRecurrenceEnd] = useState<string | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<Obligation | null>(null)
  const { base, conv } = useConverter()

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

  // Онбординг-тур на шаге «Расходы» подсвечивает форму добавления — авто-открываем её,
  // чтобы подсветка легла на реальные поля, а не на заголовок (форма иначе закрыта и
  // выглядит «затемнённой/недоступной»).
  const coachIdx = useCoach()
  useEffect(() => {
    if (coachIdx !== null && COACH_STEPS[coachIdx]?.target === "expense-form") startAdd()
  }, [coachIdx])

  function resetForm() {
    setAdding(false); setEditingId(null)
    setName(""); setAmount(""); setDueDate("")
    setRecurrence("once"); setObCurrency("USD"); setCategory(""); setStatus("planned"); setRecurrenceEnd(null)
  }

  function startAdd() {
    setEditingId(null); setAdding(true)
    setName(""); setAmount(""); setDueDate(todayIso())
    setRecurrence("monthly"); setObCurrency("USD"); setCategory(""); setStatus("planned"); setRecurrenceEnd(null)
  }

  function startEdit(o: Obligation) {
    setAdding(false); setEditingId(o.id)
    setName(o.name)
    setAmount(String(o.amount))
    setDueDate(o.due_date)
    setRecurrence(o.recurrence)
    setObCurrency(o.currency)
    setCategory(o.category ?? "")
    setStatus(o.status)
    setRecurrenceEnd(o.recurrence_end)
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
      recurrence_end: recurrence === "once" ? null : recurrenceEnd,
      category: category.trim() || null,
      status,
    }
    if (editingId !== null) await api.patch(`/obligations/${editingId}`, body)
    else await api.post("/obligations", body)
    resetForm()
    void load()
    void refreshCurrencies()
  }

  const setObStatus = (id: number, s: string) =>
    api.patch(`/obligations/${id}`, { status: s }).then(load)

  const payOneOff = async (amount: number) => {
    if (!paymentTarget) return
    await api.post(`/obligations/${paymentTarget.id}/payments`, { amount })
    setPaymentTarget(null)
    await load()
  }

  const today = todayIso()

  const { recurRows, onceRows } = useMemo(() => {
    const visible = obligations.filter((o) =>
      filter === "all" ? true : filter === "recur" ? o.recurrence !== "once" : o.recurrence === "once")
    return {
      recurRows: visible.filter((o) => o.recurrence !== "once"),
      onceRows: visible.filter((o) => o.recurrence === "once"),
    }
  }, [obligations, filter])

  // ── строка чтения ──────────────────────────────────────────────────────────
  const ReadRow = (o: Obligation) => {
    const recur = o.recurrence !== "once"
    const paidAmount = o.paid_amount
    const remainingAmount = o.remaining_amount
    const occ = o.status === "planned" ? nextOccurrence(o.due_date, o.recurrence, today) : o.due_date
    return (
      <div key={o.id}
        className={cn("group relative mx-1 rounded-[10px] px-4 py-3 transition-colors hover:bg-card-2",
          o.status === "cancelled" && "opacity-45")}>
        <div className={GRID}>
          <span className={cn("grid h-10 w-10 place-items-center rounded-[10px] border",
            recur ? "border-transparent bg-accent-soft text-primary" : "border-border bg-card-2 text-ink-2")}>
            <DotsIcon />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14.5px] font-medium tracking-[-0.01em]">
              <span className="truncate">{o.name}</span>
              {recur ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-soft py-0.5 pl-1.5 pr-[7px] text-[11px] font-semibold text-primary">
                  <Repeat />{REC_SHORT[o.recurrence]}
                </span>
              ) : (
                <span className="shrink-0 rounded-md border border-border bg-card-2 px-2 py-0.5 text-[11px] font-semibold text-ink-3">разовый</span>
              )}
            </div>
            {o.category && <div className="mt-[3px] text-[12.5px] text-ink-3">{o.category}</div>}
          </div>
          <span className="whitespace-nowrap text-[13px] text-ink-2">{REC_LABEL[o.recurrence]}</span>
          <span className="tnum whitespace-nowrap text-[13px] text-ink-2">{ddmm(occ)}</span>
          <span className="block text-left">
            <span className="tnum block whitespace-nowrap text-[15.5px] font-semibold text-neg">−{money(remainingAmount)} {o.currency}</span>
            {paidAmount > 0 && <span className="block whitespace-nowrap text-[11px] text-ink-3">из {money(o.amount)} · оплачено {money(paidAmount)}</span>}
            {o.currency !== base && <BaseAside cur={base} value={conv(remainingAmount, o.currency)} sign="−" />}
          </span>
          <span className="flex min-w-0 justify-start"><StatusChip obligation={o} /></span>
        </div>
        <div className={ACTION_RAIL} aria-label="Действия с расходом">
          <button type="button" aria-label="Редактировать расход" title="Редактировать" onClick={() => startEdit(o)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground">
            <EditIcon />
          </button>
          {o.status === "planned" ? (
            <>
              <button type="button"
                aria-label={recur ? "Отметить расход оплаченным за период" : "Отметить расход оплаченным"}
                title={recur ? "оплатить за этот период → перейти к следующему" : undefined}
                onClick={() => recur ? setObStatus(o.id, "paid") : setPaymentTarget(o)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-[11px] text-[12.5px] font-medium text-ink-2 transition-colors hover:border-pos hover:bg-pos-soft hover:text-pos">
                <CheckIcon />Оплачено
              </button>
              <button type="button" aria-label="Отменить расход" title="Отменить" onClick={() => setObStatus(o.id, "cancelled")}
                className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground">
                ✕
              </button>
            </>
          ) : (
            <button type="button" aria-label="Вернуть расход в план" title="Вернуть в план" onClick={() => setObStatus(o.id, "planned")}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-[11px] text-[12.5px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground">
              Вернуть
            </button>
          )}
          <button type="button" aria-label="Удалить расход" title="Удалить" onClick={() => api.delete(`/obligations/${o.id}`).then(load)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-neg hover:bg-neg-soft hover:text-neg">
            <TrashIcon />
          </button>
        </div>
      </div>
    )
  }

  // ── строка формы (добавление/редактирование) — та же сетка ───────────────────
  const recurForm = recurrence !== "once"
  const FormRow = (
    <form key={editingId ?? "new"} onSubmit={save}
      className={cn(GRID, "relative mx-1 my-1.5 rounded-[10px] bg-card px-4 py-3 shadow-[0_0_0_1px_var(--primary),0_0_0_4px_var(--accent-soft)]")}
      data-coach="expense-form">
      {editingId === null && (
        <div className="col-span-full mb-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
          <span className="text-primary"><PlusIcon className="h-[15px] w-[15px]" /></span>Новый расход
        </div>
      )}
      <span className={cn("grid h-10 w-10 place-items-center rounded-[10px] border",
        recurForm ? "border-transparent bg-accent-soft text-primary" : "border-border bg-card-2 text-ink-2")}>
        {editingId === null ? <PlusIcon className="h-[17px] w-[17px]" /> : <DotsIcon />}
      </span>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Статья расхода" aria-label="Статья" required className="h-[38px]" />
      <div className="flex min-w-0 items-center gap-1.5">
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="any" min="0.01" placeholder="0" aria-label="Сумма" required className="tnum h-[38px] min-w-0 font-medium" />
        <CurrencySelect value={obCurrency} onChange={setObCurrency} className="h-[38px] w-[72px]" />
      </div>
      <Select value={recurrence} onValueChange={(v) => { setRecurrence(v); if (v === "once") setRecurrenceEnd(null) }}>
        <SelectTrigger className="h-[38px]" aria-label="Периодичность"><SelectValue /></SelectTrigger>
        <SelectContent>
          {REC_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date" aria-label="Срок" required className="h-[38px]" />
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="h-[38px]" aria-label="Статус"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="planned">Запланировано</SelectItem>
          <SelectItem value="paid">Оплачено</SelectItem>
          <SelectItem value="cancelled">Отменено</SelectItem>
        </SelectContent>
      </Select>
      <div className="col-span-full mt-2 flex flex-wrap items-center gap-2.5 border-t border-line-2 pt-3">
        <RefCombo options={categories} value={category} onChange={setCategory} placeholder="Категория" />
        {recurForm && (
          <Input value={recurrenceEnd ?? ""} onChange={(e) => setRecurrenceEnd(e.target.value || null)}
            type="date" className="h-[38px] w-40" title="Повтор до (необязательно)" placeholder="до" />
        )}
        <div className="flex-1" />
        <Button type="button" variant="ghost" onClick={resetForm}>Отмена</Button>
        {editingId !== null && (
          <Button type="button" variant="outline" onClick={() => api.delete(`/obligations/${editingId}`).then(() => { resetForm(); void load() })}>
            Удалить
          </Button>
        )}
        <Button type="submit">{editingId !== null ? "Сохранить" : "Добавить расход"}</Button>
      </div>
    </form>
  )

  const GroupLabel = ({ text, n }: { text: string; n: number }) => (
    <div className="flex items-center gap-2 px-4 pb-[7px] pt-3.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
      {text}
      <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border border-border bg-card-2 px-1.5 text-[11px] font-semibold text-ink-2">{n}</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-5">
        <SectionHelp route="/plans" title="Расходы">
          Регулярные и разовые платежи (аренда, подписки, налоги). Внизу видно, сколько нужно зарабатывать в месяц, чтобы не уходить в минус. Всё это вычитается из прогноза.
        </SectionHelp>
        {!adding && editingId === null && (
          <Button onClick={startAdd} className="shrink-0"><PlusIcon className="h-4 w-4" />Добавить расход</Button>
        )}
      </div>

      {expenses && <Breakeven data={expenses} />}

      <Card className="gap-0 px-2 pb-3 pt-2">
        <div className="flex items-center justify-between gap-3.5 px-4 pb-3 pt-3.5">
          <h3 className="text-[15.5px] font-semibold tracking-[-0.02em]">Обязательства</h3>
          <div className="flex gap-px rounded-lg border border-border bg-card-2 p-[3px]">
            {([["all", "Все"], ["recur", "Регулярные"], ["once", "Разовые"]] as const).map(([f, label]) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={cn("whitespace-nowrap rounded-md px-3 py-[5px] text-[12.5px] font-medium transition-colors",
                  filter === f ? "bg-card text-foreground shadow-sm" : "text-ink-3 hover:text-ink-2")}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {(adding || editingId !== null) && FormRow}

        {recurRows.length === 0 && onceRows.length === 0 && !adding && editingId === null && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Пока пусто — добавь первый расход.
          </p>
        )}

        {recurRows.length > 0 && (
          <>
            <GroupLabel text="Регулярные" n={recurRows.length} />
            {recurRows.map((o) => (editingId === o.id ? null : ReadRow(o)))}
          </>
        )}
        {onceRows.length > 0 && (
          <>
            <GroupLabel text="Разовые" n={onceRows.length} />
            {onceRows.map((o) => (editingId === o.id ? null : ReadRow(o)))}
          </>
        )}
      </Card>
      {paymentTarget && (
        <PaymentDialog obligation={paymentTarget} onClose={() => setPaymentTarget(null)} onPaid={payOneOff} />
      )}
    </div>
  )
}
