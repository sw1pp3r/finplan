import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api, type Course, type CourseTariff, type CourseCost } from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { setShowCourse } from "@/lib/prefs"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { CurrencySelect } from "@/components/CurrencySelect"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

const COHORT = [
  { v: 1, label: "каждый месяц" },
  { v: 2, label: "раз в 2 месяца" },
  { v: 3, label: "раз в квартал" },
  { v: 6, label: "раз в полгода" },
  { v: 12, label: "раз в год" },
]
const cohortLabel = (m: number) => COHORT.find((c) => c.v === m)?.label ?? `раз в ${m} мес`

/** Деньги со знаком в базовой валюте: «+12 000 ₽» / «−1 040 $». */
function signed(v: number, cur: string): string {
  const s = v < 0 ? "−" : "+"
  return `${s}${money(Math.abs(v))} ${cur}`
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" />
  </svg>
)
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
)

/* ── action buttons ───────────────────────────────────────────── */
function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button onClick={onEdit} title="Редактировать"
        className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground">
        <EditIcon />
      </button>
      <button onClick={onDelete} title="Удалить"
        className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-ink-2 transition-colors hover:border-neg hover:bg-neg-soft hover:text-neg">
        <TrashIcon />
      </button>
    </div>
  )
}

const inputCls = "h-9 tnum"

/* ── tariff editor ────────────────────────────────────────────── */
function TariffEditor({ tariff, cur, onSave, onCancel, onDelete }: {
  tariff: CourseTariff | null
  cur: string
  onSave: (body: { name: string; price: number; currency: string; students: number }) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(tariff?.name ?? "")
  const [price, setPrice] = useState(tariff ? String(tariff.price) : "")
  const [currency, setCurrency] = useState(tariff?.currency ?? cur)
  const [students, setStudents] = useState(tariff ? String(tariff.students) : "")

  const save = () =>
    onSave({
      name: name.trim() || "Тариф",
      price: Number(price) || 0,
      currency: currency || cur,
      students: Math.round(Number(students)) || 0,
    })

  return (
    <div className="rounded-lg bg-card p-3 shadow-[0_0_0_1px_var(--primary),0_0_0_4px_var(--accent-soft)]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_120px]">
        <Input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Название тарифа" className="h-9" aria-label="Тариф" autoFocus />
        <div className="flex items-center gap-2">
          <Input value={price} onChange={(e) => setPrice(e.target.value)}
            type="number" step="any" inputMode="numeric" placeholder="Цена"
            className={cn(inputCls, "w-28")} aria-label="Цена" />
          <CurrencySelect value={currency} onChange={setCurrency} className="w-[88px]" />
        </div>
        <Input value={students} onChange={(e) => setStudents(e.target.value)}
          type="number" inputMode="numeric" placeholder="Продаж"
          className={cn(inputCls)} aria-label="Продаж в месяц" />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line-2 pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>Отмена</Button>
        <div className="flex-1" />
        {onDelete && <Button variant="outline" size="sm" onClick={onDelete}>Удалить</Button>}
        <Button size="sm" onClick={save}>Сохранить</Button>
      </div>
    </div>
  )
}

/* ── cost editor ──────────────────────────────────────────────── */
function CostEditor({ cost, cur, onSave, onCancel, onDelete }: {
  cost: CourseCost | null
  cur: string
  onSave: (body: { name: string; amount: number; currency: string; kind: string }) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(cost?.name ?? "")
  const [amount, setAmount] = useState(cost ? String(cost.amount) : "")
  const [currency, setCurrency] = useState(cost?.currency ?? cur)
  const [kind, setKind] = useState<string>(cost?.kind ?? "monthly")

  const save = () =>
    onSave({
      name: name.trim() || "Расход",
      amount: Number(amount) || 0,
      currency: currency || cur,
      kind,
    })

  return (
    <div className="rounded-lg bg-card p-3 shadow-[0_0_0_1px_var(--primary),0_0_0_4px_var(--accent-soft)]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_150px]">
        <Input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Статья расхода" className="h-9" aria-label="Статья" autoFocus />
        <div className="flex items-center gap-2">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)}
            type="number" step="any" inputMode="numeric" placeholder="Сумма"
            className={cn(inputCls, "w-28")} aria-label="Сумма" />
          <CurrencySelect value={currency} onChange={setCurrency} className="w-[88px]" />
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">в месяц</SelectItem>
            <SelectItem value="per_student">на ученика</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line-2 pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>Отмена</Button>
        <div className="flex-1" />
        {onDelete && <Button variant="outline" size="sm" onClick={onDelete}>Удалить</Button>}
        <Button size="sm" onClick={save}>Сохранить</Button>
      </div>
    </div>
  )
}

/* ── section header ───────────────────────────────────────────── */
function SectionHead({ title, sub, totalLabel, total }: {
  title: string; sub: string; totalLabel: string; total: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
        <span className="whitespace-nowrap text-xs text-ink-3">{sub}</span>
      </div>
      <span className="whitespace-nowrap text-[13px] font-medium tnum text-ink-2">
        {totalLabel} <b className="font-semibold text-foreground">{total}</b> / мес
      </span>
    </div>
  )
}

/* ── summary ──────────────────────────────────────────────────── */
type Tone = "pos" | "warn" | "neg"
function summaryTone(net: number, required: number): Tone {
  if (net <= 0) return "neg"
  return net >= required ? "pos" : "warn"
}
const TONE_STRIP: Record<Tone, string> = {
  pos: "before:bg-pos", warn: "before:bg-warn", neg: "before:bg-neg",
}
const TONE_PILL: Record<Tone, string> = {
  pos: "bg-pos-soft text-pos", warn: "bg-warn-soft text-warn", neg: "bg-neg-soft text-neg",
}
const TONE_DOT: Record<Tone, string> = {
  pos: "bg-pos", warn: "bg-warn", neg: "bg-neg",
}
const TONE_NUM: Record<Tone, string> = {
  pos: "text-pos", warn: "text-warn", neg: "text-neg",
}

function Summary({ data }: { data: Course }) {
  const cur = data.base_currency
  const rev = data.gross_monthly
  const cost = data.cost_monthly
  const profit = data.net_monthly
  const required = data.required_monthly_income
  const tone = summaryTone(profit, required)
  const cover = required > 0 ? Math.round((profit / required) * 100) : null

  let stateText: string
  let sub: React.ReactNode
  if (tone === "pos") {
    stateText = "Покрывает точку безубыточности"
    sub = (
      <>Выручка <b className="text-foreground">{money(rev)} {cur}</b> минус расходы курса{" "}
        <b className="text-foreground">{money(cost)} {cur}</b>. Этого хватает, чтобы закрыть личную точку
        безубыточности <b className="text-foreground">{money(required)} {cur}/мес</b>
        {data.net_vs_required > 0 && <> и остаётся <b className="text-foreground">{money(data.net_vs_required)} {cur}/мес</b> сверху</>}.</>
    )
  } else if (tone === "warn") {
    stateText = "Покрывает breakeven частично"
    sub = (
      <>Прибыль <b className="text-foreground">{money(profit)} {cur}/мес</b> закрывает часть личной точки
        безубыточности. До полного покрытия не хватает{" "}
        <b className="text-foreground">{money(-data.net_vs_required)} {cur}/мес</b>.</>
    )
  } else {
    stateText = "Пока убыточно"
    sub = (
      <>Расходы курса <b className="text-foreground">{money(cost)} {cur}</b> превышают выручку{" "}
        <b className="text-foreground">{money(rev)} {cur}</b>. На этих цифрах запуск уводит в минус на{" "}
        <b className="text-foreground">{money(Math.abs(profit))} {cur}/мес</b>.</>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
      {/* main */}
      <div className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-card px-6 py-6 shadow-sm",
        "before:absolute before:left-0 before:top-[18px] before:bottom-[18px] before:w-[3px] before:rounded-full",
        TONE_STRIP[tone],
      )}>
        <span className={cn("inline-flex w-fit items-center gap-2 rounded-full px-3 py-1", TONE_PILL[tone])}>
          <i className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
          <span className="text-xs font-semibold">{stateText}</span>
        </span>
        <div className="mt-4 text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">
          Прибыль курса в месяц
        </div>
        <div className={cn("mt-1 text-4xl font-semibold tracking-tight tnum", TONE_NUM[tone])}>
          {signed(profit, cur)}
        </div>
        <p className="mt-2 max-w-[46ch] text-sm text-ink-2">{sub}</p>
      </div>

      {/* side check */}
      <div className="flex flex-col justify-center rounded-lg border border-border bg-card px-6 py-5 shadow-sm">
        <SideRow label="Выручка / мес" value={`+${money(rev)} ${cur}`} valueCls="text-pos" />
        <SideRow label="Расходы курса / мес" value={`−${money(cost)} ${cur}`} valueCls="text-neg" />
        <SideRow label="Прибыль / мес" value={signed(profit, cur)} total
          valueCls={profit >= 0 ? "text-pos" : "text-neg"} />
        <SideRow label="Личный breakeven" value={`${money(required)} ${cur}`} />
        <SideRow label="Покрытие breakeven" value={cover === null ? "—" : `${cover}%`}
          valueCls={TONE_NUM[tone]} />
      </div>
    </div>
  )
}

function SideRow({ label, value, valueCls, total }: {
  label: string; value: string; valueCls?: string; total?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-2 py-2.5 last:border-b-0">
      <span className={cn("min-w-0 flex-1 text-[13.5px]", total ? "font-semibold text-foreground" : "text-ink-2")}>
        {label}
      </span>
      <span className={cn("flex-none whitespace-nowrap font-semibold tnum",
        total ? "text-[17px]" : "text-[15px]", valueCls)}>
        {value}
      </span>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────── */
export default function CoursePage() {
  const navigate = useNavigate()
  const [data, setData] = useState<Course | null>(null)
  const [editTariff, setEditTariff] = useState<number | null>(null)
  const [addingTariff, setAddingTariff] = useState(false)
  const [editCost, setEditCost] = useState<number | null>(null)
  const [addingCost, setAddingCost] = useState(false)

  const load = useCallback(async () => {
    setData(await api.get<Course>("/course"))
  }, [])

  useEffect(() => { void load() }, [load])

  const reload = () => load().then(() => refreshCurrencies())

  const addTariff = async (body: Record<string, unknown>) => {
    await api.post("/course/tariffs", body)
    setAddingTariff(false)
    await reload()
  }
  const patchTariff = async (id: number, body: Record<string, unknown>) => {
    await api.patch(`/course/tariffs/${id}`, body)
    setEditTariff(null)
    await reload()
  }
  const delTariff = async (id: number) => {
    await api.delete(`/course/tariffs/${id}`)
    setEditTariff(null)
    setAddingTariff(false)
    await reload()
  }

  const addCost = async (body: Record<string, unknown>) => {
    await api.post("/course/costs", body)
    setAddingCost(false)
    await reload()
  }
  const patchCost = async (id: number, body: Record<string, unknown>) => {
    await api.patch(`/course/costs/${id}`, body)
    setEditCost(null)
    await reload()
  }
  const delCost = async (id: number) => {
    await api.delete(`/course/costs/${id}`)
    setEditCost(null)
    setAddingCost(false)
    await reload()
  }

  const patchConfig = (body: Record<string, unknown>) =>
    api.patch("/course/config", body).then(load)

  if (!data) return <p className="text-sm text-muted-foreground">Загрузка…</p>
  const cur = data.base_currency

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4">
      {/* heading */}
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        Ещё <span className="font-normal text-ink-3">/</span> Курс
      </h1>

      {/* sandbox header */}
      <div className="flex flex-wrap items-start gap-3.5">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-accent-soft text-primary shadow-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3 6.5 12 4l9 2.5-9 2.5z" />
            <path d="M7 10v5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-5" />
            <path d="M21 6.5V13" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold tracking-tight">Запуск курса</h2>
          <p className="mt-0.5 max-w-[60ch] text-sm text-ink-2">
            Песочница «что если»: раскладываем запуск продукта на тарифы и расходы, чтобы прикинуть прибыль
            ещё до старта.
          </p>
        </div>
        <span className="ml-auto inline-flex flex-none items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-2.5 pr-3 text-xs font-medium text-ink-2 shadow-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
            strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-primary">
            <circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" />
          </svg>
          Не влияет на основной прогноз
        </span>
      </div>

      {data.missing_rates.length > 0 && (
        <div className="rounded-lg bg-warn-soft px-4 py-2 text-sm text-warn">
          Нет курса для {data.missing_rates.join(", ")} — считается как 0.
          Добавь курс в Настройках → Курсы валют.
        </div>
      )}

      {/* tariffs */}
      <section>
        <SectionHead title="Тарифы" sub="цена × продажи в месяц"
          totalLabel="выручка" total={`${money(data.gross_monthly)} ${cur}`} />
        <div className="rounded-lg border border-border bg-card p-2 shadow-sm">
          {/* column heads */}
          <div className="hidden grid-cols-[minmax(0,1fr)_132px_130px_130px] gap-3.5 px-4 pb-2 pt-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3 sm:grid">
            <span>Тариф</span><span>Цена</span><span>Продаж / мес</span><span>Выручка</span>
          </div>
          {data.tariffs.map((t, i) => (
            editTariff === t.id ? (
              <div key={t.id} className="px-1 py-1">
                <TariffEditor tariff={t} cur={cur}
                  onSave={(b) => patchTariff(t.id, b)}
                  onCancel={() => setEditTariff(null)}
                  onDelete={() => delTariff(t.id)} />
              </div>
            ) : (
              <div key={t.id} className={cn(
                "group grid grid-cols-2 items-center gap-x-3.5 gap-y-1 rounded-[10px] px-4 py-3 transition-colors hover:bg-card-2 sm:grid-cols-[minmax(0,1fr)_132px_130px_130px]",
                i > 0 && "shadow-[inset_0_1px_0_var(--line-2)]",
              )}>
                <div className="col-span-2 flex min-w-0 items-center gap-2.5 sm:col-span-1">
                  <span className="h-[18px] w-[3px] flex-none rounded-full bg-primary" />
                  <span className="min-w-0 truncate text-[14.5px] font-medium">{t.name}</span>
                </div>
                <span className="text-[14.5px] tnum text-ink-2">{money(t.price)} {t.currency}</span>
                <span className="text-[14.5px] tnum text-ink-2">{t.students} / мес</span>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14.5px] font-semibold tnum text-pos">+{money(t.gross_base)} {cur}</span>
                  <div className="opacity-0 transition-opacity group-hover:opacity-100">
                    <RowActions onEdit={() => setEditTariff(t.id)} onDelete={() => delTariff(t.id)} />
                  </div>
                </div>
              </div>
            )
          ))}
          {addingTariff ? (
            <div className="px-1 py-1">
              <TariffEditor tariff={null} cur={cur}
                onSave={addTariff} onCancel={() => setAddingTariff(false)} />
            </div>
          ) : (
            <button onClick={() => setAddingTariff(true)}
              className="m-1 inline-flex h-9 items-center gap-2 rounded-md border border-dashed border-border px-3 text-[13.5px] font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary">
              <PlusIcon /> Добавить тариф
            </button>
          )}
          {!data.tariffs.length && !addingTariff && (
            <p className="px-4 py-2 text-sm text-muted-foreground">
              Добавь хотя бы один тариф, чтобы увидеть экономику.
            </p>
          )}
        </div>
      </section>

      {/* costs */}
      <section>
        <SectionHead title="Расходы курса" sub="приведено к месяцу"
          totalLabel="расходы" total={`${money(data.cost_monthly)} ${cur}`} />
        <div className="rounded-lg border border-border bg-card p-2 shadow-sm">
          <div className="hidden grid-cols-[minmax(0,1fr)_150px_180px] gap-3.5 px-4 pb-2 pt-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3 sm:grid">
            <span>Статья</span><span>Сумма</span><span>Тип / в месяц</span>
          </div>
          {data.costs.map((c, i) => (
            editCost === c.id ? (
              <div key={c.id} className="px-1 py-1">
                <CostEditor cost={c} cur={cur}
                  onSave={(b) => patchCost(c.id, b)}
                  onCancel={() => setEditCost(null)}
                  onDelete={() => delCost(c.id)} />
              </div>
            ) : (
              <div key={c.id} className={cn(
                "group grid grid-cols-2 items-center gap-x-3.5 gap-y-1 rounded-[10px] px-4 py-3 transition-colors hover:bg-card-2 sm:grid-cols-[minmax(0,1fr)_150px_180px]",
                i > 0 && "shadow-[inset_0_1px_0_var(--line-2)]",
              )}>
                <div className="col-span-2 min-w-0 truncate text-[14.5px] font-medium sm:col-span-1">{c.name}</div>
                <span className="text-[14.5px] font-semibold tnum text-ink-2">{money(c.amount)} {c.currency}</span>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                      c.kind === "monthly"
                        ? "border-transparent bg-accent-soft text-primary"
                        : "border-border bg-card-2 text-ink-3",
                    )}>
                      {c.kind === "monthly" ? "ежемесячно" : "на ученика"}
                    </span>
                    <span className="text-[13px] tnum text-neg">−{money(c.monthly_base)} {cur}</span>
                  </span>
                  <div className="opacity-0 transition-opacity group-hover:opacity-100">
                    <RowActions onEdit={() => setEditCost(c.id)} onDelete={() => delCost(c.id)} />
                  </div>
                </div>
              </div>
            )
          ))}
          {addingCost ? (
            <div className="px-1 py-1">
              <CostEditor cost={null} cur={cur}
                onSave={addCost} onCancel={() => setAddingCost(false)} />
            </div>
          ) : (
            <button onClick={() => setAddingCost(true)}
              className="m-1 inline-flex h-9 items-center gap-2 rounded-md border border-dashed border-border px-3 text-[13.5px] font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary">
              <PlusIcon /> Добавить расход
            </button>
          )}
          {!data.costs.length && !addingCost && (
            <p className="px-4 py-2 text-sm text-muted-foreground">
              Пока без расходов — вся выручка идёт в прибыль. «На ученика» — для затрат, что растут с числом
              учеников (проверка работ, поддержка).
            </p>
          )}
        </div>
      </section>

      {/* summary */}
      <Summary data={data} />

      {/* params + footer */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-5 py-4 text-sm shadow-sm">
        <span className="text-ink-2">Поток запускается</span>
        <Select value={String(data.cohort_months)} onValueChange={(v) => patchConfig({ cohort_months: Number(v) })}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {COHORT.map((c) => <SelectItem key={c.v} value={String(c.v)}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-ink-3">
          {data.students_total} учеников · {money(data.net_per_cohort)} {cur} за поток
          ({cohortLabel(data.cohort_months)})
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm"
          onClick={() => { setShowCourse(false); navigate("/") }}>
          Скрыть вкладку «Курс»
        </Button>
      </div>
    </div>
  )
}
