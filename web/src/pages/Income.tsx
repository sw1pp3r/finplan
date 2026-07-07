import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api, type Income as IncomeData, type Inflow, type Ref } from "@/lib/api"
import { regularMonthlyIncome } from "@/lib/aggregates"
import { useCoach, COACH_STEPS } from "@/lib/coach"
import { refreshCurrencies } from "@/lib/currencies"
import { useConverter } from "@/lib/fx"
import { ddmm, money, monthLabel, todayIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import { BaseAside } from "@/components/BaseAside"
import { CurrencySelect } from "@/components/CurrencySelect"
import { RefCombo } from "@/components/RefCombo"
import { SectionHelp } from "@/components/SectionHelp"
import { InfoHint } from "@/components/InfoHint"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

// ───────────────────────────── constants / helpers ─────────────────────────

const REC_LABEL: Record<string, string> = {
  once: "Разовый", weekly: "Еженедельно", monthly: "Ежемесячно", yearly: "Ежегодно",
}
const REC_SHORT: Record<string, string> = {
  once: "разовый", weekly: "еженедельно", monthly: "ежемесячно", yearly: "ежегодно",
}

// цвет = уверенность, pct = вес в базовом сценарии
const PROB_STYLE = {
  confirmed: { label: "точно", pct: "100%", text: "text-pos", bar: "bg-pos/70" },
  likely: { label: "скорее всего", pct: "70%", text: "text-warn", bar: "bg-warn/70" },
  possible: { label: "под вопросом", pct: "30%", text: "text-ink-3", bar: "bg-ink-3/60" },
} as const
const PROB_LABEL = {
  confirmed: PROB_STYLE.confirmed.label, likely: PROB_STYLE.likely.label, possible: PROB_STYLE.possible.label,
}
const PROB_KEYS = ["confirmed", "likely", "possible"] as const
type ProbKey = typeof PROB_KEYS[number]

const isRegular = (rec: string) => rec !== "once"
const initials = (s: string) => (s.trim()[0] || "•").toUpperCase()

// общая колоночная сетка для read-строк И inline-форм — ничего не «прыгает» при правке
const GRID =
  "grid items-center gap-x-3.5 " +
  "grid-cols-[40px_minmax(0,1fr)_158px] " +
  "lg:grid-cols-[40px_minmax(0,1fr)_158px_124px_126px_120px]"
const ACTION_RAIL =
  "col-span-full mt-3 flex flex-wrap items-center justify-end gap-1 border-t border-line-2 pt-3 opacity-100 " +
  "lg:pointer-events-none lg:absolute lg:right-3.5 lg:top-1/2 lg:mt-0 lg:-translate-y-1/2 " +
  "lg:border-t-0 lg:bg-gradient-to-r lg:from-transparent lg:via-card-2 lg:to-card-2 lg:pl-9 lg:pt-0 " +
  "lg:opacity-0 lg:transition-opacity lg:group-hover:pointer-events-auto lg:group-hover:opacity-100"

// ───────────────────────────── icons ───────────────────────────────────────

function IcRepeat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 2l3 3-3 3" /><path d="M3 11V9a4 4 0 0 1 4-4h13" />
      <path d="M7 22l-3-3 3-3" /><path d="M21 13v2a4 4 0 0 1-4 4H4" />
    </svg>
  )
}
function IcEdit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" />
    </svg>
  )
}
function IcCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12l5 5L20 6" />
    </svg>
  )
}
function IcTrash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  )
}
function IcPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

// ───────────────────────────── small UI bits ───────────────────────────────

function StatusChip({ status }: { status: Inflow["status"] }) {
  if (status === "received") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-pos-soft px-2.5 py-1 text-[11.5px] font-semibold text-pos">
        <i className="h-1.5 w-1.5 rounded-full bg-pos" />Получено
      </span>
    )
  }
  if (status === "lost") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-neg-soft px-2.5 py-1 text-[11.5px] font-semibold text-neg">
        <i className="h-1.5 w-1.5 rounded-full bg-neg" />Потеряно
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-warn-soft px-2.5 py-1 text-[11.5px] font-semibold text-warn">
      <i className="h-1.5 w-1.5 rounded-full bg-warn" />Ожидается
    </span>
  )
}

function GroupLabel({ text, n }: { text: string; n: number }) {
  return (
    <div className="flex items-center gap-2 px-4 pb-1.5 pt-3.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
      {text}
      <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border border-border bg-card-2 px-1.5 text-[11px] font-semibold normal-case tracking-normal text-ink-2">
        {n}
      </span>
    </div>
  )
}

function IncomeTotalDashboard({
  data,
  cur,
  selected,
  onToggle,
}: {
  data: IncomeData
  cur: string
  selected: Record<ProbKey, boolean>
  onToggle: (p: ProbKey) => void
}) {
  const future = PROB_KEYS.reduce((sum, p) => sum + (selected[p] ? data.expected.by_probability[p] : 0), 0)
  const total = data.total + future
  return (
    <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className="relative overflow-hidden rounded-lg border border-border bg-card px-6 py-5 shadow-sm">
        <span aria-hidden className="absolute inset-y-[18px] left-0 w-[3px] rounded bg-pos" />
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          Итого с будущими
        </span>
        <div className="tnum mt-1.5 text-[36px] font-semibold leading-[1.05] tracking-[-0.035em]">
          {money(total)} {cur}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line-2 bg-card-2 px-4 py-3">
            <span className="text-[12px] font-medium text-ink-3">Получено</span>
            <span className="tnum mt-1 block text-[20px] font-semibold text-pos">{money(data.total)} {cur}</span>
          </div>
          <div className="rounded-lg border border-line-2 bg-card-2 px-4 py-3">
            <span className="text-[12px] font-medium text-ink-3">Будущие</span>
            <span className="tnum mt-1 block text-[20px] font-semibold text-warn">{money(future)} {cur}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            Вероятность будущих
          </span>
          <span className="tnum text-[13px] font-semibold text-ink-2">{money(future)} {cur}</span>
        </div>
        <div className="flex flex-col gap-2">
          {PROB_KEYS.map((p) => {
            const st = PROB_STYLE[p]
            return (
              <label key={p}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  selected[p] ? "border-primary/35 bg-accent-soft" : "border-border bg-card-2",
                )}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <input
                    type="checkbox"
                    aria-label={st.label}
                    checked={selected[p]}
                    onChange={() => onToggle(p)}
                    className="h-4 w-4 rounded border-border accent-[var(--primary)]"
                  />
                  <span className="truncate text-[13px] font-medium text-foreground">{st.label}</span>
                  <span className="text-[12px] text-ink-3">{st.pct}</span>
                </span>
                <span className={cn("tnum whitespace-nowrap text-[13.5px] font-semibold", st.text)}>
                  +{money(data.expected.by_probability[p])} {cur}
                </span>
              </label>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ───────────────────────────── pipeline header block ───────────────────────

function PipelineTop({ data, expectedRows, cur, regularMonthly }: {
  data: IncomeData
  expectedRows: Inflow[]
  cur: string
  regularMonthly: number
}) {
  const exp = data.expected
  const probMax = Math.max(1, ...Object.values(exp.by_probability ?? {}))
  const receivedThisMonth = useMemo(() => {
    const ym = todayIso().slice(0, 7)
    return data.by_month?.[ym] ?? 0
  }, [data.by_month])
  const monthName = monthLabel(todayIso().slice(0, 7)).split(" ")[0]

  return (
    <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      {/* pipeline */}
      <div className="relative overflow-hidden rounded-lg border border-border bg-card px-6 py-5 shadow-sm">
        <span className="absolute inset-y-[18px] left-0 w-[3px] rounded bg-warn" />
        <div className="mb-1 flex items-center gap-2.5">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">
            Ожидается дальше
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-warn-soft px-2.5 py-1 text-[11.5px] font-semibold text-warn">
            <i className="h-1.5 w-1.5 rounded-full bg-warn" />{expectedRows.length} в очереди
          </span>
        </div>
        <div className="mt-1.5 text-[38px] font-semibold leading-[1.05] tracking-[-0.035em] tnum">
          {money(exp.weighted)} {cur}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[13.5px] text-ink-2">
          <span><b className="font-semibold text-foreground">Реалистичная сумма</b> — она и питает кривую прогноза. Если сбудется всё на 100%: <b className="font-semibold text-foreground tnum">{money(exp.total)} {cur}</b>.</span>
          <InfoHint>Точные берём целиком, «скорее всего» — на 70%, «под вопросом» — на 30%. Реалистичная сумма и попадает в прогноз.</InfoHint>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {(["confirmed", "likely", "possible"] as const).map((p) => {
            const v = exp.by_probability[p]
            const st = PROB_STYLE[p]
            return (
              <div key={p} className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-2">
                <span className="text-[13px] text-ink-2">
                  {st.label} <span className="text-ink-3">{st.pct}</span>
                </span>
                <span className={cn("text-[13.5px] font-semibold tnum", st.text)}>+{money(v)} {cur}</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded bg-card-2">
                  <span className={cn("block h-full rounded", st.bar)} style={{ width: `${(v / probMax) * 100}%` }} />
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* context cards */}
      <div className="flex flex-col gap-4 max-[980px]:flex-row">
        <div className="flex flex-1 flex-col justify-center rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
          <span className="text-[12.5px] font-medium text-ink-2">Получено в {monthName.toLowerCase()}</span>
          <span className="mt-1 text-[25px] font-semibold leading-none tracking-[-0.025em] text-pos tnum">
            {money(receivedThisMonth)} {cur}
          </span>
          <span className="mt-1.5 text-[12px] text-ink-3">уже на счетах · в снимке «сегодня»</span>
        </div>
        <div className="flex flex-1 flex-col justify-center rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
          <span className="text-[12.5px] font-medium text-ink-2">Регулярный доход</span>
          <span className="mt-1 text-[25px] font-semibold leading-none tracking-[-0.025em] tnum">
            {money(regularMonthly)} {cur}
            <span className="text-[15px] font-medium text-ink-3"> / мес</span>
          </span>
          <span className="mt-1.5 text-[12px] text-ink-3">повторяющиеся источники · без разовых</span>
        </div>
      </div>
    </section>
  )
}

// ───────────────────────────── read row ────────────────────────────────────

function ReadRow({ i, base, conv, onEdit, onMark, onLost, onReturn, onDelete }: {
  i: Inflow
  base: string
  conv: (amount: number, currency: string) => number | null
  onEdit: () => void
  onMark: () => void
  onLost: () => void
  onReturn: () => void
  onDelete: () => void
}) {
  const regular = isRegular(i.recurrence)
  const name = i.counterparty || i.name
  const lost = i.status === "lost"

  return (
    <div className={cn(
      "group relative mx-1 rounded-[10px] px-4 py-3 transition-colors hover:bg-card-2",
      "[&+&]:shadow-[inset_0_1px_0_var(--line-2)]",
      lost && "opacity-50",
      GRID,
    )}>
      <span className={cn(
        "grid h-10 w-10 place-items-center rounded-[10px] border text-[15px] font-semibold",
        regular ? "border-transparent bg-accent-soft text-primary" : "border-border bg-card-2 text-ink-2",
      )}>
        {initials(name)}
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[14.5px] font-medium tracking-[-0.01em]">
          <span className="truncate">{name}</span>
          {regular ? (
            <span className="inline-flex flex-none items-center gap-1 rounded-md bg-accent-soft py-0.5 pl-1.5 pr-1.5 text-[11px] font-semibold text-primary">
              <IcRepeat className="h-3 w-3" />{REC_SHORT[i.recurrence]}
            </span>
          ) : i.status === "expected" ? (
            <span className="flex-none rounded-md border border-border bg-card-2 px-2 py-0.5 text-[11px] font-semibold text-ink-3">
              разовый
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[12.5px] text-ink-3">{i.direction || i.note || "—"}</div>
      </div>

      <div className="text-right">
        <span className={cn(
          "block whitespace-nowrap text-[15.5px] font-semibold tnum",
          i.status === "received" ? "text-pos" : "text-foreground",
        )}>
          +{money(i.amount)} {i.currency}
        </span>
        {i.currency !== base && <BaseAside cur={base} value={conv(i.amount, i.currency)} sign="+" />}
      </div>

      <span className="hidden whitespace-nowrap text-[13px] text-ink-2 lg:block">
        {i.status === "expected" ? REC_LABEL[i.recurrence] : "—"}
      </span>
      <span className="hidden whitespace-nowrap text-[13px] text-ink-2 tnum lg:block">{ddmm(i.expected_date)}</span>
      <span className="hidden min-w-0 lg:flex lg:items-center lg:gap-1.5">
        <StatusChip status={i.status} />
        {i.status === "expected" && (
          <span className="text-[11px] text-ink-3">{PROB_LABEL[i.probability]}</span>
        )}
      </span>

      <div className={ACTION_RAIL} aria-label="Действия с доходом">
        <button onClick={onEdit} aria-label="Редактировать доход" title="Редактировать"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground">
          <IcEdit className="h-[15px] w-[15px]" />
        </button>
        {i.status === "expected" ? (
          <>
            <button onClick={onMark} aria-label="Отметить доход полученным"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-pos hover:bg-pos-soft hover:text-pos">
              <IcCheck className="h-[14px] w-[14px]" />Получено
            </button>
            <button onClick={onLost} aria-label="Отметить доход потерянным" title="Не пришло"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground">
              ✕
            </button>
          </>
        ) : (
          <button onClick={onReturn} aria-label="Вернуть доход в ожидаемые"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground">
            Вернуть
          </button>
        )}
        <button onClick={onDelete} aria-label="Удалить доход" title="Удалить"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-neg hover:bg-neg-soft hover:text-neg">
          <IcTrash className="h-[15px] w-[15px]" />
        </button>
      </div>
    </div>
  )
}

// ───────────────────────────── inline form (add OR edit) ───────────────────
// Те же колонки, что у read-строки (через GRID), плюс полнострочный футер.

type FormState = {
  source: string
  amount: string
  currency: string
  recurrence: string
  date: string
  probability: string
}

function InlineForm({ kind, state, set, directions, onSubmit, onCancel, onDelete }: {
  kind: "add" | "edit"
  state: FormState
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  directions: Ref[]
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const regular = isRegular(state.recurrence)
  return (
    <form onSubmit={onSubmit}
      className={cn(
        "relative mx-1 my-1.5 rounded-[10px] bg-card px-4 py-3",
        "shadow-[0_0_0_1px_var(--primary),0_0_0_4px_var(--accent-soft)]",
        GRID,
      )}>
      {kind === "add" && (
        <div className="col-span-full mb-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
          <IcPlus className="h-[15px] w-[15px] text-primary" />Новый доход
        </div>
      )}

      <span className={cn(
        "grid h-10 w-10 place-items-center rounded-[10px] border text-[15px] font-semibold max-[980px]:hidden",
        regular || kind === "add" ? "border-transparent bg-accent-soft text-primary" : "border-border bg-card-2 text-ink-2",
      )}>
        {kind === "add" ? <IcPlus className="h-[17px] w-[17px]" /> : initials(state.source || "•")}
      </span>

      {/* источник (RefCombo over directions/counterparties) */}
      <RefCombo
        options={directions}
        value={state.source}
        onChange={(v) => set("source", v)}
        placeholder="Источник / направление"
        width="w-full"
      />

      {/* сумма + валюта */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          type="number"
          step="any"
          min="0.01"
          inputMode="decimal"
          value={state.amount}
          onChange={(e) => set("amount", e.target.value)}
          placeholder="0"
          required
          className="min-w-0 text-right font-medium tnum"
        />
        <CurrencySelect value={state.currency} onChange={(v) => set("currency", v)} className="w-[78px]" />
      </div>

      {/* повтор */}
      <Select value={state.recurrence} onValueChange={(v) => set("recurrence", v)}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="once">Разовый</SelectItem>
          <SelectItem value="weekly">Еженедельно</SelectItem>
          <SelectItem value="monthly">Ежемесячно</SelectItem>
          <SelectItem value="yearly">Ежегодно</SelectItem>
        </SelectContent>
      </Select>

      {/* дата */}
      <Input type="date" value={state.date} onChange={(e) => set("date", e.target.value)} required className="w-full" />

      {/* уверенность */}
      <Select value={state.probability} onValueChange={(v) => set("probability", v)}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="confirmed">точно (100%)</SelectItem>
          <SelectItem value="likely">скорее всего (70%)</SelectItem>
          <SelectItem value="possible">под вопросом (30%)</SelectItem>
        </SelectContent>
      </Select>

      {/* footer */}
      <div className="col-span-full mt-2 flex items-center gap-2.5 border-t border-line-2 pt-3">
        <button type="button" onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[13.5px] font-medium text-ink-3 transition-colors hover:text-foreground">
          Отмена
        </button>
        <div className="flex-1" />
        {kind === "edit" && onDelete && (
          <button type="button" onClick={onDelete}
            className="rounded-lg border border-border bg-card px-3.5 py-1.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:border-neg hover:text-neg">
            Удалить
          </button>
        )}
        <button type="submit"
          className="rounded-lg border border-primary bg-primary px-3.5 py-1.5 text-[13.5px] font-medium text-primary-foreground shadow-sm transition-[filter] hover:brightness-105">
          {kind === "add" ? "Добавить доход" : "Сохранить"}
        </button>
      </div>
    </form>
  )
}

// ───────────────────────────── page ────────────────────────────────────────

const EMPTY_FORM: FormState = {
  source: "", amount: "", currency: "USD", recurrence: "once",
  date: todayIso(), probability: "confirmed",
}

export default function Income() {
  const [data, setData] = useState<IncomeData | null>(null)
  const [inflows, setInflows] = useState<Inflow[]>([])
  const [directions, setDirections] = useState<Ref[]>([])
  const [filter, setFilter] = useState<"all" | "expected" | "received">("all")
  const [probFilter, setProbFilter] = useState<Record<ProbKey, boolean>>({
    confirmed: true,
    likely: true,
    possible: true,
  })
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const feedRef = useRef<HTMLDivElement>(null)
  const { base, conv } = useConverter()

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

  // ожидаемые сверху (регулярные первыми, затем по дате ↑); факты снизу по дате ↓
  const rows = useMemo(() => {
    const recRank = (x: Inflow) => (isRegular(x.recurrence) ? 0 : 1)
    return [...inflows].sort((a, b) => {
      const ae = a.status === "received" ? 1 : 0
      const be = b.status === "received" ? 1 : 0
      if (ae !== be) return ae - be
      if (ae === 0) {
        if (recRank(a) !== recRank(b)) return recRank(a) - recRank(b)
        return a.expected_date.localeCompare(b.expected_date)
      }
      return b.expected_date.localeCompare(a.expected_date)
    })
  }, [inflows])

  const expectedRows = useMemo(() => inflows.filter((i) => i.status === "expected"), [inflows])
  // FX-конверсия в базу + нормализация ВСЕХ повторяющихся (не только monthly) в месяц (#23)
  const regularMonthly = useMemo(
    () => regularMonthlyIncome(expectedRows, conv),
    [expectedRows, conv],
  )

  // Онбординг-тур на шаге «Доходы» подсвечивает форму добавления — авто-открываем её,
  // чтобы подсветка легла на поля, а не на заголовок (иначе форма закрыта и затемнена).
  // ВАЖНО: хук должен стоять до early-return ниже, иначе порядок хуков плавает (React #310).
  const coachIdx = useCoach()
  useEffect(() => {
    if (coachIdx !== null && COACH_STEPS[coachIdx]?.target === "income-form") openAdd()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachIdx])

  if (!data) return <div className="py-20 text-center text-sm text-muted-foreground">Загрузка…</div>

  const cur = data.base_currency

  function setAdd<K extends keyof FormState>(k: K, v: FormState[K]) {
    setAddForm((f) => ({ ...f, [k]: v }))
  }
  function setEdit<K extends keyof FormState>(k: K, v: FormState[K]) {
    setEditForm((f) => ({ ...f, [k]: v }))
  }

  function openAdd() {
    setEditingId(null)
    setAddForm(EMPTY_FORM)
    setAdding(true)
    requestAnimationFrame(() => feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  function startEdit(i: Inflow) {
    setAdding(false)
    setEditingId(i.id)
    setEditForm({
      source: i.counterparty || i.direction || "",
      amount: String(i.amount),
      currency: i.currency,
      recurrence: i.recurrence,
      date: i.expected_date,
      probability: i.probability,
    })
  }

  // источник пишем и в counterparty (от кого), и в direction (если из справочника).
  function sourcePayload(source: string) {
    const s = source.trim()
    if (!s) return { counterparty: null, direction: null }
    const isDir = directions.some((d) => d.name === s)
    return isDir ? { counterparty: null, direction: s } : { counterparty: s, direction: null }
  }

  function toggleProb(p: ProbKey) {
    setProbFilter((prev) => ({ ...prev, [p]: !prev[p] }))
  }

  async function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const source = sourcePayload(addForm.source)
    if (addForm.recurrence === "once" && addForm.date < todayIso()) {
      await api.post("/income", {
        amount: Number(addForm.amount),
        currency: addForm.currency,
        received_date: addForm.date,
        ...source,
      })
    } else {
      await api.post("/inflows", {
        amount: Number(addForm.amount),
        currency: addForm.currency,
        expected_date: addForm.date,
        probability: addForm.probability,
        recurrence: addForm.recurrence,
        ...source,
      })
    }
    f.reset()
    setAdding(false)
    setAddForm(EMPTY_FORM)
    void load()
    void refreshCurrencies()
  }

  async function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (editForm.amount === "" || editingId === null) return
    await api.patch(`/inflows/${editingId}`, {
      amount: Number(editForm.amount),
      currency: editForm.currency,
      expected_date: editForm.date,
      probability: editForm.probability,
      recurrence: editForm.recurrence,
      ...sourcePayload(editForm.source),
    })
    setEditingId(null)
    setEditForm(EMPTY_FORM)
    void load()
    void refreshCurrencies()
  }

  const setInfStatus = (id: number, status: string) =>
    api.patch(`/inflows/${id}`, { status }).then(load)
  const removeInflow = (id: number) => api.delete(`/inflows/${id}`).then(load)

  const visible = rows.filter((i) =>
    filter === "all" ? true : filter === "expected" ? i.status === "expected" : i.status === "received",
  )
  const expVisible = visible.filter((i) => i.status === "expected")
  const rcvVisible = visible.filter((i) => i.status !== "expected")

  function renderRow(i: Inflow) {
    if (editingId === i.id) {
      return (
        <InlineForm
          key={`edit-${i.id}`}
          kind="edit"
          state={editForm}
          set={setEdit}
          directions={directions}
          onSubmit={submitEdit}
          onCancel={() => setEditingId(null)}
          onDelete={() => { setEditingId(null); void removeInflow(i.id) }}
        />
      )
    }
    return (
      <ReadRow
        key={`row-${i.id}`}
        i={i}
        base={base}
        conv={conv}
        onEdit={() => startEdit(i)}
        onMark={() => setInfStatus(i.id, "received")}
        onLost={() => setInfStatus(i.id, "lost")}
        onReturn={() => setInfStatus(i.id, "expected")}
        onDelete={() => removeInflow(i.id)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHelp route="/income" title="Доходы">
        Два вида денег на входе: то, что вы уже <b>получили</b>, и то, что <b>ожидаете</b>. Ожидаемое попадает в прогноз с поправкой на вероятность. Пришли деньги — нажмите «получено».
      </SectionHelp>

      {/* heading */}
      <div className="flex items-start justify-between gap-5">
        <div>
          <h2 className="text-[21px] font-semibold tracking-[-0.03em]">Доходы</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Поступления, которые питают прогноз</p>
        </div>
        <button onClick={openAdd}
          className="inline-flex h-[37px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary bg-primary px-4 text-[13.5px] font-medium text-primary-foreground shadow-sm transition-[filter] hover:brightness-105">
          <IcPlus className="h-4 w-4" />Добавить доход
        </button>
      </div>

      <IncomeTotalDashboard data={data} cur={cur} selected={probFilter} onToggle={toggleProb} />

      {data.expected.total > 0 && (
        <PipelineTop data={data} expectedRows={expectedRows} cur={cur} regularMonthly={regularMonthly} />
      )}

      {/* unified feed */}
      <section ref={feedRef} className="rounded-lg border border-border bg-card px-2 pb-3 pt-2 shadow-sm">
        <div className="flex items-center justify-between gap-3.5 px-4 pb-3 pt-3.5">
          <h3 className="text-[15.5px] font-semibold tracking-[-0.02em]">Все поступления</h3>
          <div className="flex gap-px rounded-lg border border-border bg-card-2 p-[3px]">
            {([["all", "Все"], ["expected", "Ожидается"], ["received", "Получено"]] as const).map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors",
                  filter === f ? "bg-card text-foreground shadow-sm" : "text-ink-3 hover:text-ink-2",
                )}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {adding && (
          <div data-coach="income-form">
            <InlineForm
              kind="add"
              state={addForm}
              set={setAdd}
              directions={directions}
              onSubmit={submitAdd}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}

        {visible.length === 0 && !adding ? (
          <p className="px-4 py-10 text-center text-sm text-ink-3">
            Пока пусто — нажмите «Добавить доход».
          </p>
        ) : (
          <>
            {expVisible.length > 0 && filter !== "received" && (
              <>
                <GroupLabel text="Ожидается" n={expVisible.length} />
                {expVisible.map(renderRow)}
              </>
            )}
            {rcvVisible.length > 0 && filter !== "expected" && (
              <>
                <GroupLabel text="Получено" n={rcvVisible.length} />
                {rcvVisible.map(renderRow)}
              </>
            )}
          </>
        )}
      </section>

      {/* summaries: by direction + by month (as on current page) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
            По направлениям
            <InfoHint>Направление — откуда пришли деньги (Acme, обучение…). Настраивается в Настройках.</InfoHint>
          </div>
          {Object.keys(data.by_direction).length ? (
            <div className="flex flex-col gap-3">
              {Object.entries(data.by_direction)
                .sort(([, a], [, b]) => b - a)
                .map(([dir, total]) => {
                  const maxDir = Math.max(1, ...Object.values(data.by_direction))
                  return (
                    <div key={dir}>
                      <div className="mb-1 flex items-baseline justify-between text-sm">
                        <span className="font-medium">{dir}</span>
                        <span className="tnum text-pos">+{money(total)} {cur}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-card-2">
                        <div className="h-full rounded-full bg-pos/70" style={{ width: `${(total / maxDir) * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              <div className="my-1 h-px bg-line-2" />
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold">Итого</span>
                <span className="font-semibold tnum">{money(data.total)} {cur}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-3">Пока пусто.</p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 text-sm font-medium">По месяцам</div>
          {Object.keys(data.by_month).length ? (
            <div className="flex flex-col">
              {Object.entries(data.by_month)
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([m, total], idx) => (
                  <div key={m} className={cn(
                    "flex items-center justify-between py-2 text-sm",
                    idx > 0 && "border-t border-line-2",
                  )}>
                    <span className="font-medium">{monthLabel(m)}</span>
                    <span className="tnum text-pos">+{money(total)} {cur}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-ink-3">Пока пусто.</p>
          )}
        </div>
      </div>
    </div>
  )
}
