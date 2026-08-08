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
import { PageSkeleton } from "@/components/PageSkeleton"
import { SectionHelp } from "@/components/SectionHelp"
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

/* ── product verdict ──────────────────────────────────────────── */
type Tone = "pos" | "warn" | "neg"
function summaryTone(net: number, required: number): Tone {
  if (net <= 0) return "neg"
  return net >= required ? "pos" : "warn"
}
const TONE_NUM: Record<Tone, string> = { pos: "text-pos", warn: "text-warn", neg: "text-neg" }

function CourseVerdict({ data }: { data: Course }) {
  const cur = data.base_currency
  const tone = summaryTone(data.net_monthly, data.required_monthly_income)
  const verdict = tone === "pos"
    ? "Запуск покрывает финансовый минимум"
    : tone === "warn"
      ? "Курс прибыльный, но не закрывает финансовый минимум"
      : "В текущей модели запуск убыточен"
  const deltaLabel = data.net_vs_required >= 0 ? "Сверх минимума" : "До минимума"

  return (
    <section
      aria-label="Финансовый результат запуска"
      className="grid gap-5 rounded-lg border border-border bg-card px-5 py-5 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(260px,auto)] sm:items-center"
    >
      <div>
        <p className={cn("text-sm font-semibold", TONE_NUM[tone])}>{verdict}</p>
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Прибыль в месяц</p>
        <p className={cn("mt-0.5 text-3xl font-semibold tracking-tight tnum", TONE_NUM[tone])}>
          {signed(data.net_monthly, cur)}
        </p>
        <p className="mt-1 text-sm text-ink-3">
          {signed(data.net_per_cohort, cur)} за поток · {cohortLabel(data.cohort_months)}
        </p>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-2 border-t border-line-2 pt-4 text-sm sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
        <dt className="text-ink-3">Выручка</dt>
        <dd className="text-right font-semibold text-pos tnum">+{money(data.gross_monthly)} {cur}</dd>
        <dt className="text-ink-3">Расходы курса</dt>
        <dd className="text-right font-semibold text-neg tnum">−{money(data.cost_monthly)} {cur}</dd>
        <dt className="text-ink-3">{deltaLabel}</dt>
        <dd className={cn("text-right font-semibold tnum", TONE_NUM[tone])}>
          {signed(data.net_vs_required, cur)}
        </dd>
      </dl>
    </section>
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
  return (
    <div className="rounded-lg border border-border bg-card">
      <SectionHead title="Тарифы"
        totals={<>выручка <b className="font-semibold text-foreground">{money(data.gross_monthly)} {cur}</b> / мес</>} />
      <div className="border-t border-line-2">
        <div>
          <div className="course-tariff-grid hidden items-center gap-x-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3 sm:grid">
            <span>Тариф</span>
            <span className="text-right">Цена</span>
            <span className="text-right">Продаж/поток</span>
            <span className="text-right">Выручка/поток</span>
            <span />
          </div>
          <div className="divide-y divide-line-2">
            {data.tariffs.map((t: CourseTariff) => (
              <div key={t.id} className="course-tariff-grid group grid items-center gap-3 px-3 py-3 sm:gap-x-2 sm:py-1">
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <Cell defaultValue={t.name} ariaLabel="Тариф"
                    onCommit={(v) => onPatch(t.id, { name: v.trim() || "Тариф" })} />
                </div>
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-end">
                  <span className="text-[11px] font-medium text-ink-3 sm:hidden">Цена</span>
                  <div className="flex items-center gap-1">
                  <Cell defaultValue={String(t.price)} type="number" step="any" min="0.01" align="right"
                    ariaLabel="Цена" className="w-20 min-w-0"
                    onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) onPatch(t.id, { price: n }) }} />
                  <CurrencySelect value={t.currency} onChange={(v) => onPatch(t.id, { currency: v })}
                    ariaLabel={`Валюта тарифа ${t.name}`}
                    className="min-h-11 w-[72px] text-[12px] sm:min-h-0 sm:h-7" />
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-1 sm:block">
                  <span className="text-[11px] font-medium text-ink-3 sm:hidden">Продаж за поток</span>
                  <Cell defaultValue={String(t.students)} type="number" min="0" align="right"
                    ariaLabel="Продаж за поток"
                    onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) onPatch(t.id, { students: Math.round(n) }) }} />
                </div>
                <span className="flex flex-col text-left text-[13px] font-semibold tnum text-pos sm:text-right">
                  <span className="text-[11px] font-medium text-ink-3 sm:hidden">Выручка за поток</span>
                  <span>+{money(t.gross_base)} {cur}</span>
                </span>
                <IconBtn onClick={() => onDelete(t.id)} label={`Удалить тариф ${t.name}`} danger><TrashIcon /></IconBtn>
              </div>
            ))}
          </div>
        </div>
      </div>
      <button onClick={onAdd} aria-label="Добавить тариф"
        className="m-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary sm:min-h-0 sm:h-7 sm:px-2.5">
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
  return (
    <div className="rounded-lg border border-border bg-card">
      <SectionHead title="Расходы курса"
        totals={<>расходы <b className="font-semibold text-foreground">{money(data.cost_monthly)} {cur}</b> / мес</>} />
      <div className="border-t border-line-2">
        <div>
          <div className="course-cost-grid hidden items-center gap-x-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3 sm:grid">
            <span>Статья</span><span>Тип</span><span className="text-right">Сумма</span>
            <span className="text-right">/мес в базе</span><span />
          </div>
          <div className="divide-y divide-line-2">
            {data.costs.map((c: CourseCost) => (
              <div key={c.id} className="course-cost-grid group grid items-center gap-3 px-3 py-3 sm:gap-x-2 sm:py-1">
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <Cell defaultValue={c.name} ariaLabel="Статья"
                    onCommit={(v) => onPatch(c.id, { name: v.trim() || "Расход" })} />
                </div>
                <div className="flex min-w-0 flex-col gap-1 sm:block">
                  <span className="text-[11px] font-medium text-ink-3 sm:hidden">Тип</span>
                  <Select value={c.kind} onValueChange={(v) => onPatch(c.id, { kind: v })}>
                    <SelectTrigger className="min-h-11 w-full text-[12px] sm:min-h-0 sm:h-7" aria-label="Тип"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">фикс/мес</SelectItem>
                      <SelectItem value="per_student">на ученика</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-end">
                  <span className="text-[11px] font-medium text-ink-3 sm:hidden">Сумма</span>
                  <div className="flex items-center gap-1">
                  <Cell defaultValue={String(c.amount)} type="number" step="any" min="0.01" align="right"
                    ariaLabel="Сумма" className="w-20 min-w-0"
                    onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) onPatch(c.id, { amount: n }) }} />
                  <CurrencySelect value={c.currency} onChange={(v) => onPatch(c.id, { currency: v })}
                    ariaLabel={`Валюта расхода ${c.name}`}
                    className="min-h-11 w-[72px] text-[12px] sm:min-h-0 sm:h-7" />
                  </div>
                </div>
                <span className="flex flex-col text-left text-[13px] tnum text-neg sm:text-right">
                  <span className="text-[11px] font-medium text-ink-3 sm:hidden">В месяц</span>
                  <span>−{money(c.monthly_base)} {cur}</span>
                </span>
                <IconBtn onClick={() => onDelete(c.id)} label={`Удалить расход ${c.name}`} danger><TrashIcon /></IconBtn>
              </div>
            ))}
          </div>
        </div>
      </div>
      <button onClick={onAdd} aria-label="Добавить статью"
        className="m-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary sm:min-h-0 sm:h-7 sm:px-2.5">
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
    if (!window.confirm("Удалить тариф из модели курса?")) return
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
    if (!window.confirm("Удалить статью расходов из модели курса?")) return
    await api.delete(`/course/costs/${id}`)
    await reload()
  }

  const patchConfig = (body: Record<string, unknown>) =>
    api.patch("/course/config", body).then(load)

  if (!data) return <PageSkeleton label="Загружаю экономику курса" />
  const cur = data.base_currency

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <SectionHelp route="/course" title="Курс" defaultOpen={false}>
          Песочница запуска: меняйте тарифы, продажи и расходы, чтобы проверить
          прибыльность. Эти расчёты не влияют на основной cash-flow прогноз.
        </SectionHelp>
        <div className="ml-auto flex w-full flex-none items-center justify-between gap-2 text-[12.5px] text-ink-2 sm:w-auto sm:justify-start">
          <span>Новый поток</span>
          <Select value={String(data.cohort_months)} onValueChange={(v) => patchConfig({ cohort_months: Number(v) })}>
            <SelectTrigger className="min-h-11 w-44 text-[12.5px] sm:min-h-0 sm:h-8" aria-label="Периодичность потока"><SelectValue /></SelectTrigger>
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

      <CourseVerdict data={data} />

      <TariffsTable data={data} onPatch={patchTariff} onDelete={delTariff} onAdd={addTariff} />
      <CostsTable data={data} onPatch={patchCost} onDelete={delCost} onAdd={addCost} />

      {/* footer */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-[12.5px]">
        <span className="tnum text-ink-3">
          {data.students_total} учеников · {money(data.net_per_cohort)} {cur} за поток
          ({cohortLabel(data.cohort_months)})
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="min-h-11 sm:min-h-0 sm:h-8"
          onClick={() => { setShowCourse(false); navigate("/") }}>
          Скрыть вкладку «Курс»
        </Button>
      </div>
    </div>
  )
}
