import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api, type Course, type CourseTariff, type CourseCost } from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { setShowCourse } from "@/lib/prefs"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { CurrencySelect } from "@/components/CurrencySelect"
import { Cell, IconBtn } from "@/components/InlineCell"
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
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
)

/* ── section head with right-aligned totals + optional controls ── */
function SectionHead({ title, totals, children }: {
  title: string; totals: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
        {children}
      </div>
      <span className="text-[13px] tnum text-ink-2">{totals}</span>
    </div>
  )
}

/* ── summary strip ────────────────────────────────────────────── */
type Tone = "pos" | "warn" | "neg"
function summaryTone(net: number, required: number): Tone {
  if (net <= 0) return "neg"
  return net >= required ? "pos" : "warn"
}
const TONE_NUM: Record<Tone, string> = { pos: "text-pos", warn: "text-warn", neg: "text-neg" }

function SummaryStrip({ data }: { data: Course }) {
  const cur = data.base_currency
  const tone = summaryTone(data.net_monthly, data.required_monthly_income)
  const cover = data.required_monthly_income > 0
    ? Math.round((data.net_monthly / data.required_monthly_income) * 100) : null
  const Item = ({ label, value, sub, cls }: { label: string; value: React.ReactNode; sub?: string; cls?: string }) => (
    <div className="min-w-0 flex-1 px-4 py-2.5 first:pl-0 last:pr-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className={cn("mt-0.5 truncate text-[15px] font-semibold tnum", cls)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-ink-3">{sub}</div>}
    </div>
  )
  return (
    <div className="flex flex-wrap divide-x divide-line-2 rounded-lg border border-border bg-card px-4">
      <Item label="Выручка/мес" value={`+${money(data.gross_monthly)} ${cur}`} cls="text-pos"
        sub={`${data.students_total} учеников за поток`} />
      <Item label="Расходы/мес" value={`−${money(data.cost_monthly)} ${cur}`} cls="text-neg"
        sub={`фикс ${money(data.fixed_monthly)} · на учеников ${money(data.variable_monthly)}`} />
      <Item label="Прибыль/мес" value={signed(data.net_monthly, cur)} cls={TONE_NUM[tone]}
        sub={`нужно ≥ ${money(data.required_monthly_income)} ${cur}`} />
      <Item label="Прибыль/поток" value={signed(data.net_per_cohort, cur)}
        cls={data.net_per_cohort >= 0 ? "text-pos" : "text-neg"}
        sub={cohortLabel(data.cohort_months)} />
      <Item label="vs breakeven" value={signed(data.net_vs_required, cur)} cls={TONE_NUM[tone]}
        sub={cover === null ? undefined : `покрытие ${cover}%`} />
    </div>
  )
}

/* ── tariffs table ────────────────────────────────────────────── */
function TariffsTable({ data, onPatch, onDelete, onAdd }: {
  data: Course
  onPatch: (id: number, body: Record<string, unknown>) => void
  onDelete: (id: number) => void
  onAdd: () => void
}) {
  const cur = data.base_currency
  const gridCols = "minmax(0,1.4fr) 190px 110px 130px 32px"
  return (
    <div className="rounded-lg border border-border bg-card">
      <SectionHead title="Тарифы"
        totals={<>выручка <b className="font-semibold text-foreground">{money(data.gross_monthly)} {cur}</b> / мес</>} />
      <div className="overflow-x-auto border-t border-line-2">
        <div className="min-w-full">
          <div className="grid items-center gap-x-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3"
            style={{ gridTemplateColumns: gridCols }}>
            <span>Тариф</span>
            <span className="text-right">Цена</span>
            <span className="text-right">Продаж/поток</span>
            <span className="text-right">Выручка/поток</span>
            <span />
          </div>
          <div className="divide-y divide-line-2">
            {data.tariffs.map((t: CourseTariff) => (
              <div key={t.id} className="group grid items-center gap-x-2 px-3 py-1"
                style={{ gridTemplateColumns: gridCols }}>
                <Cell defaultValue={t.name} ariaLabel="Тариф"
                  onCommit={(v) => onPatch(t.id, { name: v.trim() || "Тариф" })} />
                <div className="flex items-center justify-end gap-1">
                  <Cell defaultValue={String(t.price)} type="number" step="any" min="0.01" align="right"
                    ariaLabel="Цена" className="w-20"
                    onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) onPatch(t.id, { price: n }) }} />
                  <CurrencySelect value={t.currency} onChange={(v) => onPatch(t.id, { currency: v })}
                    className="h-7 w-[72px] text-[12px]" />
                </div>
                <Cell defaultValue={String(t.students)} type="number" min="0" align="right"
                  ariaLabel="Продаж за поток"
                  onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) onPatch(t.id, { students: Math.round(n) }) }} />
                <span className="text-right text-[13px] font-semibold tnum text-pos">
                  +{money(t.gross_base)} {cur}
                </span>
                <IconBtn onClick={() => onDelete(t.id)} label="Удалить тариф" danger><TrashIcon /></IconBtn>
              </div>
            ))}
          </div>
        </div>
      </div>
      <button onClick={onAdd} aria-label="Добавить тариф"
        className="m-1.5 inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary">
        <PlusIcon /> тариф
      </button>
      {!data.tariffs.length && (
        <p className="px-3 pb-2 text-[12.5px] text-muted-foreground">
          Добавь хотя бы один тариф, чтобы увидеть экономику.
        </p>
      )}
    </div>
  )
}

/* ── costs table ──────────────────────────────────────────────── */
function CostsTable({ data, onPatch, onDelete, onAdd }: {
  data: Course
  onPatch: (id: number, body: Record<string, unknown>) => void
  onDelete: (id: number) => void
  onAdd: () => void
}) {
  const cur = data.base_currency
  const gridCols = "minmax(0,1.4fr) 140px 190px 110px 32px"
  return (
    <div className="rounded-lg border border-border bg-card">
      <SectionHead title="Расходы курса"
        totals={<>расходы <b className="font-semibold text-foreground">{money(data.cost_monthly)} {cur}</b> / мес</>} />
      <div className="overflow-x-auto border-t border-line-2">
        <div className="min-w-full">
          <div className="grid items-center gap-x-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3"
            style={{ gridTemplateColumns: gridCols }}>
            <span>Статья</span><span>Тип</span><span className="text-right">Сумма</span>
            <span className="text-right">/мес в базе</span><span />
          </div>
          <div className="divide-y divide-line-2">
            {data.costs.map((c: CourseCost) => (
              <div key={c.id} className="group grid items-center gap-x-2 px-3 py-1"
                style={{ gridTemplateColumns: gridCols }}>
                <Cell defaultValue={c.name} ariaLabel="Статья"
                  onCommit={(v) => onPatch(c.id, { name: v.trim() || "Расход" })} />
                <Select value={c.kind} onValueChange={(v) => onPatch(c.id, { kind: v })}>
                  <SelectTrigger className="h-7 w-full text-[12px]" aria-label="Тип"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">фикс/мес</SelectItem>
                    <SelectItem value="per_student">на ученика</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-end gap-1">
                  <Cell defaultValue={String(c.amount)} type="number" step="any" min="0.01" align="right"
                    ariaLabel="Сумма" className="w-20"
                    onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) onPatch(c.id, { amount: n }) }} />
                  <CurrencySelect value={c.currency} onChange={(v) => onPatch(c.id, { currency: v })}
                    className="h-7 w-[72px] text-[12px]" />
                </div>
                <span className="text-right text-[13px] tnum text-neg">
                  −{money(c.monthly_base)} {cur}
                </span>
                <IconBtn onClick={() => onDelete(c.id)} label="Удалить расход" danger><TrashIcon /></IconBtn>
              </div>
            ))}
          </div>
        </div>
      </div>
      <button onClick={onAdd} aria-label="Добавить статью"
        className="m-1.5 inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary">
        <PlusIcon /> статья
      </button>
      {!data.costs.length && (
        <p className="px-3 pb-2 text-[12.5px] text-muted-foreground">
          Пока без расходов — вся выручка идёт в прибыль. «На ученика» — для затрат, что растут с числом
          учеников (проверка работ, поддержка).
        </p>
      )}
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────── */
export default function CoursePage() {
  const navigate = useNavigate()
  const [data, setData] = useState<Course | null>(null)

  const load = useCallback(async () => {
    setData(await api.get<Course>("/course"))
  }, [])

  useEffect(() => { void load() }, [load])

  const reload = () => load().then(() => refreshCurrencies())

  const addTariff = async () => {
    if (!data) return
    await api.post("/course/tariffs", {
      name: "Тариф", price: 100, currency: data.base_currency, students: 0,
    })
    await reload()
  }
  const patchTariff = async (id: number, body: Record<string, unknown>) => {
    await api.patch(`/course/tariffs/${id}`, body)
    await reload()
  }
  const delTariff = async (id: number) => {
    await api.delete(`/course/tariffs/${id}`)
    await reload()
  }

  const addCost = async () => {
    if (!data) return
    await api.post("/course/costs", {
      name: "Статья", amount: 1, currency: data.base_currency, kind: "monthly",
    })
    await reload()
  }
  const patchCost = async (id: number, body: Record<string, unknown>) => {
    await api.patch(`/course/costs/${id}`, body)
    await reload()
  }
  const delCost = async (id: number) => {
    await api.delete(`/course/costs/${id}`)
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight">Запуск курса</h2>
          <p className="mt-0.5 max-w-[60ch] text-[12.5px] text-ink-2">
            Песочница «что если»: тарифы и расходы запуска → прибыль. Не влияет на основной прогноз.
          </p>
        </div>
        <div className="ml-auto flex flex-none items-center gap-2 text-[12.5px] text-ink-2">
          <span>Поток запускается</span>
          <Select value={String(data.cohort_months)} onValueChange={(v) => patchConfig({ cohort_months: Number(v) })}>
            <SelectTrigger className="h-8 w-44 text-[12.5px]" aria-label="Периодичность потока"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COHORT.map((c) => <SelectItem key={c.v} value={String(c.v)}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {data.missing_rates.length > 0 && (
        <div className="rounded-lg bg-warn-soft px-3 py-1.5 text-[12.5px] text-warn">
          Нет курса для {data.missing_rates.join(", ")} — считается как 0.
          Добавь курс в Настройках → Курсы валют.
        </div>
      )}

      <SummaryStrip data={data} />

      <TariffsTable data={data} onPatch={patchTariff} onDelete={delTariff} onAdd={addTariff} />
      <CostsTable data={data} onPatch={patchCost} onDelete={delCost} onAdd={addCost} />

      {/* footer */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-[12.5px]">
        <span className="tnum text-ink-3">
          {data.students_total} учеников · {money(data.net_per_cohort)} {cur} за поток
          ({cohortLabel(data.cohort_months)})
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-8"
          onClick={() => { setShowCourse(false); navigate("/") }}>
          Скрыть вкладку «Курс»
        </Button>
      </div>
    </div>
  )
}
