import { useMemo, useState } from "react"
import { api, type Summary } from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { monthLabel, todayIso } from "@/lib/format"

// ─────────────────────────────────────────────────────────────────────────────
// Полноэкранный онбординг finplan. Монтируется App.tsx на пустой БД.
//   PART A — welcome + мини-превью демо-дашборда (числа Артёма).
//   PART B — мастер из 5 шагов: валюта → счета → доходы → расходы → готово.
// Скип доступен на каждом шаге; прогресс-рейл сверху и в сайдбаре.
//   onDone() закрывает онбординг (финиш, «пропустить», «посмотреть демо»).
// ─────────────────────────────────────────────────────────────────────────────

// Пресеты валют — RUB · USD · EUR первыми, остальное через «свою».
const CUR_PRESET = ["RUB", "USD", "EUR"] as const
const CUR_SYM: Record<string, string> = { RUB: "₽", USD: "$", EUR: "€", USDT: "₮", GBP: "£" }
const CUR_NAME: Record<string, string> = {
  RUB: "Рубль", USD: "Доллар США", EUR: "Евро", USDT: "Tether", GBP: "Фунт",
}
const sym = (c: string) => CUR_SYM[c] ?? c

// Период повтора → API recurrence. «once» = разовый (в прогноз как один платёж).
const PERIODS = [
  { value: "monthly", label: "ежемесячно" },
  { value: "weekly", label: "еженедельно" },
  { value: "yearly", label: "ежегодно" },
  { value: "once", label: "разово" },
] as const
type Recurrence = (typeof PERIODS)[number]["value"]

// Множители «к месяцу» — только для локального превью сумм (бэкенд считает сам).
const PER_MUL: Record<Recurrence, number> = { weekly: 4.333, monthly: 1, yearly: 1 / 12, once: 0 }

// Грубые курсы для превью сводок в мастере (бэкенд использует реальные /rates).
const PREVIEW_RATE: Record<string, number> = { USD: 1, USDT: 1, EUR: 1.08, RUB: 0.0105, GBP: 1.27 }

type AcctRow = { id: number; name: string; cur: string; bal: number }
type FlowRow = { id: number; name: string; amount: number; cur: string; period: Recurrence }

let _uid = 1
const uid = () => _uid++

const groupNum = (n: number) =>
  Math.round(n).toLocaleString("ru-RU").replace(/\u00A0/g, "\u202F")
const parseNum = (s: string) => parseInt(s.replace(/[^\d]/g, ""), 10) || 0

// ─────────────────────────────────────────────────────────────────────────────
// icons
// ─────────────────────────────────────────────────────────────────────────────

function IcPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function IcX({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
function IcCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12l5 5L20 6" />
    </svg>
  )
}
function IcInfo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
    </svg>
  )
}
function IcShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" />
    </svg>
  )
}
function IcLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 16 L9 10 L13 13 L20 5" /><path d="M4 20h16" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// shared small UI
// ─────────────────────────────────────────────────────────────────────────────

const inputCls =
  "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground " +
  "placeholder:text-ink-3 transition-colors focus:border-primary focus:outline-none " +
  "focus:ring-[3px] focus:ring-accent-soft"

function btn(kind: "primary" | "ghost" | "text") {
  const base =
    "inline-flex h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-lg " +
    "px-[18px] text-sm font-medium transition-[filter,colors,border-color] disabled:cursor-not-allowed disabled:opacity-50"
  if (kind === "primary")
    return base + " border border-primary bg-primary text-primary-foreground shadow-sm hover:brightness-105"
  if (kind === "ghost")
    return base + " border border-border bg-card text-foreground hover:border-ink-3"
  return base + " border border-transparent bg-transparent text-ink-3 hover:text-foreground"
}

/** Селект валюты: пресеты RUB·USD·EUR + текущее значение (если кастом) + «своя…». */
function CurPicker({ value, onChange, className }: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const codes = [...CUR_PRESET]
  if (!codes.includes(value as (typeof CUR_PRESET)[number])) codes.push(value as never)
  return (
    <div className={"relative " + (className ?? "")}>
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === "__add") {
            const code = (window.prompt("Код валюты (например, GBP, PLN, AED):", "") || "")
              .trim().toUpperCase()
            if (code) onChange(code)
            return
          }
          onChange(e.target.value)
        }}
        className={inputCls + " cursor-pointer appearance-none pr-7"}
      >
        {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value="__add">+ своя…</option>
      </select>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  )
}

function MoneyInput({ symbol, value, onChange }: {
  symbol: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div className="relative flex items-center">
      <span className="pointer-events-none absolute left-3 text-sm font-medium text-ink-3">{symbol}</span>
      <input
        inputMode="numeric"
        value={groupNum(value)}
        onChange={(e) => onChange(parseNum(e.target.value))}
        className={inputCls + " pl-7 text-left font-medium tnum"}
      />
    </div>
  )
}

function HintCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[11px] border border-border bg-card p-4">
      <div className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">
        <IcInfo className="h-[15px] w-[15px] text-primary" />{title}
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}

function TotalCard({ label, value, note, tone }: {
  label: string
  value: string
  note: React.ReactNode
  tone?: "pos" | "neg"
}) {
  const valTone = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-foreground"
  return (
    <div className="rounded-[11px] border border-border bg-card-2 p-[17px]">
      <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
      <span className={"mt-1.5 block text-[30px] font-semibold tracking-[-0.03em] tnum " + valTone}>
        {value}
      </span>
      <div className="mt-1.5 text-[12px] leading-snug text-ink-3">{note}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// component
// ─────────────────────────────────────────────────────────────────────────────

const STEPS = [
  { title: "Базовая валюта", sub: "В этой валюте finplan показывает общий баланс и прогноз. Остальные суммы приводятся к ней автоматически." },
  { title: "Счета и остатки", sub: "Добавьте счета, которыми пользуетесь. Их остатки — стартовая точка прогноза." },
  { title: "Регулярные поступления", sub: "Гонорары, выручка продукта, консалтинг. Нерегулярные доходы можно добавить и пометить разовыми." },
  { title: "Регулярные расходы", sub: "Аренда, инфраструктура, подписки и быт. Это самая предсказуемая часть прогноза." },
  { title: "Прогноз построен", sub: "" },
]

type RunwayPreview = { months: number | null; until: string | null }

export default function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"welcome" | "wizard">("welcome")
  const [step, setStep] = useState(1) // 1..5
  const [saving, setSaving] = useState(false)
  const [runway, setRunway] = useState<RunwayPreview | null>(null)

  const [base, setBase] = useState("USD")
  const [name, setName] = useState("")
  const [accounts, setAccounts] = useState<AcctRow[]>([
    { id: uid(), name: "", cur: "USD", bal: 0 },
  ])
  const [income, setIncome] = useState<FlowRow[]>([
    { id: uid(), name: "", amount: 0, cur: "USD", period: "monthly" },
  ])
  const [expense, setExpense] = useState<FlowRow[]>([
    { id: uid(), name: "", amount: 0, cur: "USD", period: "monthly" },
  ])

  // ── previews (local, грубо к базовой валюте) ───────────────────────────────
  const toBase = (amt: number, cur: string) =>
    (amt * (PREVIEW_RATE[cur] ?? 1)) / (PREVIEW_RATE[base] ?? 1)
  const fmtBase = (v: number) => (v < 0 ? "−" : "") + sym(base) + groupNum(Math.abs(v))

  const acctTotal = useMemo(
    () => accounts.reduce((a, x) => a + toBase(x.bal, x.cur), 0),
    [accounts, base],
  )
  const incomeMonthly = useMemo(
    () => income.reduce((a, x) => a + toBase(x.amount, x.cur) * PER_MUL[x.period], 0),
    [income, base],
  )
  const expenseMonthly = useMemo(
    () => expense.reduce((a, x) => a + toBase(x.amount, x.cur) * PER_MUL[x.period], 0),
    [expense, base],
  )
  const free = incomeMonthly - expenseMonthly

  // ── persistence per step (real API) ────────────────────────────────────────

  async function saveCurrency() {
    const body: Record<string, unknown> = { base_currency: base }
    if (name.trim()) body.display_name = name.trim()
    await api.patch("/settings", body)
    void refreshCurrencies()
  }

  async function saveAccounts() {
    const rows = accounts.filter((a) => a.name.trim())
    if (!rows.length) return
    const items: { account_id: number; amount: number }[] = []
    for (const a of rows) {
      const created = await api.post<{ id: number }>("/accounts", {
        name: a.name.trim(), currency: a.cur, type: "bank",
      })
      if (a.bal) items.push({ account_id: created.id, amount: a.bal })
    }
    if (items.length) await api.post("/snapshots", { taken_at: todayIso(), items })
    void refreshCurrencies()
  }

  async function saveIncome() {
    const rows = income.filter((r) => r.name.trim() && r.amount)
    for (const r of rows) {
      await api.post("/inflows", {
        amount: r.amount,
        currency: r.cur,
        expected_date: todayIso(),
        recurrence: r.period,
        probability: "confirmed",
        counterparty: r.name.trim(),
      })
    }
    void refreshCurrencies()
  }

  async function saveExpense() {
    const rows = expense.filter((r) => r.name.trim() && r.amount)
    for (const r of rows) {
      await api.post("/obligations", {
        name: r.name.trim(),
        amount: r.amount,
        currency: r.cur,
        due_date: todayIso(),
        recurrence: r.period,
        recurrence_end: null,
        category: null,
        status: "planned",
      })
    }
    void refreshCurrencies()
  }

  async function loadRunway() {
    try {
      const s = await api.get<Summary>("/summary")
      const breach = s.scenarios.base.cushion_breach_date
      if (!breach) { setRunway({ months: null, until: null }); return }
      const days = (new Date(breach).getTime() - new Date(todayIso()).getTime()) / 86400_000
      setRunway({ months: Math.max(0, Math.round(days / 30.44)), until: breach })
    } catch {
      setRunway({ months: null, until: null })
    }
  }

  // ── navigation ─────────────────────────────────────────────────────────────

  const SAVERS: Record<number, () => Promise<void>> = {
    1: saveCurrency, 2: saveAccounts, 3: saveIncome, 4: saveExpense,
  }

  async function go(next: number, { persist }: { persist: boolean }) {
    if (persist && SAVERS[step]) {
      setSaving(true)
      try { await SAVERS[step]() } finally { setSaving(false) }
    }
    if (next === 5) await loadRunway()
    setStep(next)
    window.scrollTo(0, 0)
  }

  function back() {
    if (step === 1) { setPhase("welcome"); window.scrollTo(0, 0); return }
    setStep((s) => s - 1)
    window.scrollTo(0, 0)
  }

  // ── row mutators ───────────────────────────────────────────────────────────

  const setFlow = (
    list: FlowRow[], set: (v: FlowRow[]) => void, id: number, patch: Partial<FlowRow>,
  ) => set(list.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="grid min-h-screen grid-cols-1 bg-background text-foreground md:grid-cols-[248px_1fr]">
      {/* sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-1 border-r border-border bg-bg-soft px-3.5 py-5 md:flex">
        <div className="flex items-center gap-2.5 px-2 pb-5 pt-1.5">
          <span className="grid h-[29px] w-[29px] flex-none place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <IcLogo className="h-4 w-4" />
          </span>
          <span className="text-base font-semibold tracking-[-0.02em]">finplan</span>
        </div>
        {["Дашборд", "Баланс", "Доходы", "Расходы", "Мечты"].map((n) => (
          <span key={n}
            className="pointer-events-none flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-2 opacity-40">
            {n}
          </span>
        ))}
        <div className="flex-1" />
        <div className="rounded-[10px] border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md bg-accent-soft text-primary">
              <IcShield className="h-3.5 w-3.5" />
            </span>
            <span className="text-[12.5px] font-semibold">Настройка</span>
            <span className="ml-auto text-[11.5px] text-ink-3">
              {phase === "welcome" ? "Не начата" : `Шаг ${step} из 5`}
            </span>
          </div>
          <div className="h-[5px] overflow-hidden rounded-[3px] bg-line-2">
            <i className="block h-full rounded-[3px] bg-primary transition-[width] duration-300"
              style={{ width: phase === "welcome" ? "0%" : `${(step / 5) * 100}%` }} />
          </div>
        </div>
      </aside>

      {/* main */}
      <main className="flex h-screen flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-[18px] md:px-10">
          <button onClick={onDone} className="text-[13px] font-medium text-ink-3 transition-colors hover:text-ink-2">
            Пропустить настройку →
          </button>
        </div>

        <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col justify-center px-6 pb-14 pt-8 md:px-10">
          {phase === "welcome" ? (
            <Welcome onStart={() => { setPhase("wizard"); setStep(1); window.scrollTo(0, 0) }} onDemo={onDone} />
          ) : (
            <section className="mx-auto w-full max-w-[920px]">
              {/* head + rail */}
              <div className="mb-[22px]">
                <div className="mb-[18px] flex items-center gap-3.5">
                  <div className="flex flex-1 gap-1.5">
                    {STEPS.map((_, i) => {
                      const n = i + 1
                      return (
                        <i key={n}
                          className={
                            "h-[5px] flex-1 rounded-[3px] transition-colors " +
                            (n < step ? "bg-primary/50" : n === step ? "bg-primary" : "bg-border")
                          } />
                      )
                    })}
                  </div>
                  <span className="whitespace-nowrap text-[13px] font-medium text-ink-3">
                    Шаг <b className="font-semibold text-foreground">{step}</b> из 5
                  </span>
                </div>
                <h2 className="text-[27px] font-semibold leading-[1.1] tracking-[-0.03em]">
                  {STEPS[step - 1].title}
                </h2>
                {STEPS[step - 1].sub && (
                  <p className="mt-[7px] max-w-[54ch] text-[15px] text-ink-2">{STEPS[step - 1].sub}</p>
                )}
              </div>

              {/* body */}
              {step === 1 && (
                <div className="rounded-[11px] border border-border bg-card p-6 shadow-sm">
                  <div className="mb-5 border-b border-line-2 pb-5">
                    <label htmlFor="ob-name" className="mb-1.5 block text-[13px] font-medium text-ink-2">Как вас зовут?</label>
                    <input
                      id="ob-name" value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="Ваше имя" maxLength={120}
                      className={inputCls + " max-w-sm"}
                    />
                    <p className="mt-1.5 text-[12px] text-ink-3">Показывается в боковой панели. Можно пропустить и задать позже в Настройках.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {CUR_PRESET.map((c) => {
                      const on = base === c
                      return (
                        <button key={c} type="button" onClick={() => setBase(c)}
                          className={
                            "flex items-center gap-3 rounded-[11px] border p-4 text-left transition-colors " +
                            (on
                              ? "border-primary bg-accent-soft ring-[3px] ring-accent-soft"
                              : "border-border bg-card hover:border-ink-3")
                          }>
                          <span className={
                            "grid h-[38px] w-[38px] flex-none place-items-center rounded-lg border text-lg font-semibold " +
                            (on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card-2 text-foreground")
                          }>
                            {sym(c)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold tracking-[-0.01em]">{c}</span>
                            <span className="block text-[12.5px] text-ink-3">{CUR_NAME[c]}</span>
                          </span>
                          <span className={
                            "grid h-5 w-5 flex-none place-items-center rounded-full border " +
                            (on ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent")
                          }>
                            <IcCheck className="h-3 w-3" />
                          </span>
                        </button>
                      )
                    })}

                    {!CUR_PRESET.includes(base as (typeof CUR_PRESET)[number]) && (
                      <button type="button"
                        className="flex items-center gap-3 rounded-[11px] border border-primary bg-accent-soft p-4 text-left ring-[3px] ring-accent-soft">
                        <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-lg border border-primary bg-primary text-lg font-semibold text-primary-foreground">
                          {sym(base)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{base}</span>
                          <span className="block text-[12.5px] text-ink-3">{CUR_NAME[base] ?? "Валюта"}</span>
                        </span>
                        <span className="grid h-5 w-5 flex-none place-items-center rounded-full border border-primary bg-primary text-primary-foreground">
                          <IcCheck className="h-3 w-3" />
                        </span>
                      </button>
                    )}

                    <button type="button"
                      onClick={() => {
                        const code = (window.prompt("Код валюты (например, GBP, PLN, AED):", "") || "")
                          .trim().toUpperCase()
                        if (code) setBase(code)
                      }}
                      className="flex items-center gap-3 rounded-[11px] border border-dashed border-border bg-card p-4 text-left text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary">
                      <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-lg border border-border bg-card-2 text-ink-3">
                        <IcPlus className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold">Добавить свою</span>
                        <span className="block text-[12.5px] text-ink-3">любая другая валюта</span>
                      </span>
                    </button>
                  </div>
                  <p className="mt-4 text-[12px] text-ink-3">
                    Базовую валюту можно изменить позже в настройках — прогноз пересчитается автоматически.
                  </p>
                </div>
              )}

              {step === 2 && (
                <div className="rounded-[11px] border border-border bg-card p-6 shadow-sm">
                  <div className="grid items-start gap-5 lg:grid-cols-[1fr_296px]">
                    <div>
                      <div className="hidden grid-cols-[38px_1fr_116px_150px_36px] gap-3 px-0.5 pb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3 lg:grid">
                        <span /><span>Счёт</span><span>Валюта</span><span>Остаток</span><span />
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {accounts.map((a) => (
                          <div key={a.id}
                            className="grid grid-cols-[1fr_36px] items-center gap-3 lg:grid-cols-[38px_1fr_116px_150px_36px]">
                            <span className="hidden h-[38px] w-[38px] place-items-center rounded-lg border border-border bg-card-2 text-[15px] font-semibold text-ink-2 lg:grid">
                              {sym(a.cur)}
                            </span>
                            <input
                              value={a.name}
                              onChange={(e) => setAccounts(accounts.map((x) => x.id === a.id ? { ...x, name: e.target.value } : x))}
                              placeholder="Название счёта"
                              className={inputCls + " col-span-1 lg:col-span-1"}
                            />
                            <div className="hidden lg:block">
                              <CurPicker value={a.cur}
                                onChange={(v) => setAccounts(accounts.map((x) => x.id === a.id ? { ...x, cur: v } : x))} />
                            </div>
                            <div className="hidden lg:block">
                              <MoneyInput symbol={sym(a.cur)} value={a.bal}
                                onChange={(n) => setAccounts(accounts.map((x) => x.id === a.id ? { ...x, bal: n } : x))} />
                            </div>
                            <button type="button" aria-label="Удалить"
                              onClick={() => setAccounts(accounts.filter((x) => x.id !== a.id))}
                              className="grid h-9 w-9 place-items-center rounded-lg border border-transparent text-ink-3 transition-colors hover:bg-neg-soft hover:text-neg">
                              <IcX className="h-4 w-4" />
                            </button>
                            {/* compact: cur + bal on a new line */}
                            <div className="col-span-2 grid grid-cols-[116px_1fr] gap-3 lg:hidden">
                              <CurPicker value={a.cur}
                                onChange={(v) => setAccounts(accounts.map((x) => x.id === a.id ? { ...x, cur: v } : x))} />
                              <MoneyInput symbol={sym(a.cur)} value={a.bal}
                                onChange={(n) => setAccounts(accounts.map((x) => x.id === a.id ? { ...x, bal: n } : x))} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <button type="button"
                        onClick={() => setAccounts([...accounts, { id: uid(), name: "", cur: base, bal: 0 }])}
                        className="mt-3.5 inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-border px-3.5 text-sm font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary">
                        <IcPlus className="h-[15px] w-[15px]" />Добавить счёт
                      </button>
                    </div>
                    <aside className="flex flex-col gap-3.5">
                      <TotalCard label="Итого по счетам" value={fmtBase(acctTotal)}
                        note={`${accounts.length} ${plural(accounts.length, "счёт", "счёта", "счетов")} · в базовой валюте (${base})`} />
                      <HintCard title="Зачем это нужно">
                        Остатки на счетах — отметка «сегодня» на графике прогноза. От неё finplan считает, на сколько хватит денег.
                      </HintCard>
                    </aside>
                  </div>
                </div>
              )}

              {(step === 3 || step === 4) && (() => {
                const isIncome = step === 3
                const list = isIncome ? income : expense
                const set = isIncome ? setIncome : setExpense
                const monthly = isIncome ? incomeMonthly : expenseMonthly
                return (
                  <div className="rounded-[11px] border border-border bg-card p-6 shadow-sm">
                    <div className="grid items-start gap-5 lg:grid-cols-[1fr_296px]">
                      <div>
                        <div className="hidden grid-cols-[1fr_118px_82px_140px_34px] gap-3 px-0.5 pb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3 lg:grid">
                          <span>{isIncome ? "Источник" : "Статья"}</span>
                          <span>Сумма</span><span>Валюта</span><span>Период</span><span />
                        </div>
                        <div className="flex flex-col gap-2.5">
                          {list.map((r) => (
                            <div key={r.id}
                              className="grid grid-cols-[1fr_34px] items-center gap-3 lg:grid-cols-[1fr_118px_82px_140px_34px]">
                              <input
                                value={r.name}
                                onChange={(e) => setFlow(list, set, r.id, { name: e.target.value })}
                                placeholder={isIncome ? "Источник" : "Статья"}
                                className={inputCls}
                              />
                              <div className="hidden lg:block">
                                <MoneyInput symbol={sym(r.cur)} value={r.amount}
                                  onChange={(n) => setFlow(list, set, r.id, { amount: n })} />
                              </div>
                              <div className="hidden lg:block">
                                <CurPicker value={r.cur} onChange={(v) => setFlow(list, set, r.id, { cur: v })} />
                              </div>
                              <div className="hidden lg:block">
                                <PeriodPicker value={r.period}
                                  onChange={(v) => setFlow(list, set, r.id, { period: v })} />
                              </div>
                              <button type="button" aria-label="Удалить"
                                onClick={() => set(list.filter((x) => x.id !== r.id))}
                                className="grid h-9 w-9 place-items-center rounded-lg border border-transparent text-ink-3 transition-colors hover:bg-neg-soft hover:text-neg">
                                <IcX className="h-4 w-4" />
                              </button>
                              <div className="col-span-2 grid grid-cols-[1fr_82px_120px] gap-3 lg:hidden">
                                <MoneyInput symbol={sym(r.cur)} value={r.amount}
                                  onChange={(n) => setFlow(list, set, r.id, { amount: n })} />
                                <CurPicker value={r.cur} onChange={(v) => setFlow(list, set, r.id, { cur: v })} />
                                <PeriodPicker value={r.period}
                                  onChange={(v) => setFlow(list, set, r.id, { period: v })} />
                              </div>
                            </div>
                          ))}
                        </div>
                        <button type="button"
                          onClick={() => set([...list, { id: uid(), name: "", amount: 0, cur: base, period: "monthly" }])}
                          className="mt-3.5 inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-border px-3.5 text-sm font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary">
                          <IcPlus className="h-[15px] w-[15px]" />
                          {isIncome ? "Добавить доход" : "Добавить расход"}
                        </button>
                      </div>
                      <aside className="flex flex-col gap-3.5">
                        <TotalCard
                          label={isIncome ? "Доходы в месяц" : "Расходы в месяц"}
                          value={fmtBase(monthly)}
                          note="приведено к месяцу и базовой валюте" />
                        {isIncome ? (
                          <HintCard title="Совет">
                            Достаточно крупных статей. Мелочи можно объединить в одну строку — на точность прогноза это почти не влияет.
                          </HintCard>
                        ) : (
                          <div className="rounded-[11px] border border-border bg-card-2 p-[17px]">
                            <span className="text-[12.5px] font-medium text-ink-2">Свободно в месяц</span>
                            <span className={"mt-1.5 block text-[30px] font-semibold tracking-[-0.03em] tnum " + (free >= 0 ? "text-pos" : "text-neg")}>
                              {(free >= 0 ? "+" : "") + fmtBase(free)}
                            </span>
                            <div className="mt-3 flex flex-col gap-2 border-t border-line-2 pt-3 text-[13px]">
                              <div className="flex items-center justify-between">
                                <span className="text-ink-2">Доходы</span>
                                <b className="font-semibold tnum">{fmtBase(incomeMonthly)}</b>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-ink-2">Расходы</span>
                                <b className="font-semibold tnum">−{fmtBase(expenseMonthly)}</b>
                              </div>
                            </div>
                          </div>
                        )}
                      </aside>
                    </div>
                  </div>
                )
              })()}

              {step === 5 && (
                <Finish runway={runway} bal={fmtBase(acctTotal)} inc={fmtBase(incomeMonthly)}
                  free={(free >= 0 ? "+" : "") + fmtBase(free)} onDone={onDone}
                  onBack={() => setStep(4)} />
              )}

              {/* footer */}
              {step !== 5 && (
                <div className="mt-1 flex items-center gap-2.5">
                  <button onClick={back} className={btn("ghost")} disabled={saving}>
                    {step === 1 ? "К началу" : "Назад"}
                  </button>
                  <div className="flex-1" />
                  <button onClick={() => go(step + 1, { persist: false })} className={btn("text")} disabled={saving}>
                    Пропустить шаг
                  </button>
                  <button onClick={() => go(step + 1, { persist: true })} className={btn("primary")} disabled={saving}>
                    {saving ? "Сохраняю…" : step === 4 ? "К результату" : "Далее"}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PART A — welcome
// ─────────────────────────────────────────────────────────────────────────────

function Welcome({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-[54px]">
      <div>
        <span className="mb-[18px] inline-flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-primary">
          <span className="h-px w-[18px] rounded bg-primary" />Добро пожаловать
        </span>
        <h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.032em] text-balance">
          Так выглядит finplan, когда знает о ваших деньгах
        </h1>
        <p className="mt-[18px] max-w-[46ch] text-base leading-relaxed text-ink-2">
          Рабочий стол справа заполнен данными реального фрилансера — Артёма, который строит продукты на ИИ.
          Осмотритесь спокойно, а когда будете готовы — соберём ваш прогноз за пять коротких шагов.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button onClick={onStart} className={btn("primary") + " h-[46px] px-[22px] text-[15px]"}>
            Настроить под себя
          </button>
          <button onClick={onDemo} className={btn("ghost") + " h-[46px] px-[22px] text-[15px]"}>
            Посмотреть демо
          </button>
        </div>
        <div className="mt-6 flex max-w-[42ch] items-start gap-2.5 text-[13px] leading-snug text-ink-3">
          <IcShield className="mt-0.5 h-4 w-4 flex-none text-pos" />
          <span>Ничего не подключается автоматически. Вы вводите только то, что хотите, и можете пропустить любой шаг.</span>
        </div>
      </div>

      {/* mini demo dashboard preview */}
      <div className="relative order-first max-w-[440px] lg:order-none lg:max-w-none">
        <span className="absolute -top-3 left-5 z-10 inline-flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-[5px] text-[11px] font-semibold text-background shadow-sm">
          <i className="h-1.5 w-1.5 rounded-full bg-pos" />Демо · данные примера
        </span>
        <div className="rounded-2xl border border-border bg-card p-[18px] shadow-[0_2px_4px_rgba(40,30,15,.04),0_20px_48px_-24px_rgba(40,30,15,.26)] [transform:rotate(-1.1deg)] transition-transform hover:[transform:rotate(0deg)]">
          <div className="rounded-[11px] border border-line-2 bg-card-2 px-4 py-[15px]">
            <span className="mb-[11px] inline-flex items-center gap-1.5 rounded-full bg-pos-soft py-[3px] pl-[7px] pr-2.5">
              <i className="h-1.5 w-1.5 rounded-full bg-pos" />
              <span className="whitespace-nowrap text-[11px] font-semibold text-pos">Отличный запас</span>
            </span>
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-3">Запас хода</div>
            <div className="mt-0.5 whitespace-nowrap leading-none">
              <b className="text-[30px] font-semibold tracking-[-0.03em] text-pos tnum">≈ 14</b>
              <span className="ml-1.5 text-sm font-medium text-ink-2">мес</span>
            </div>
            <div className="mt-1 text-xs text-ink-2">
              денег хватает до <b className="font-semibold text-foreground">августа 2027</b>
            </div>
          </div>
          <div className="mt-3.5 grid grid-cols-3 gap-2.5">
            {[
              { l: "Баланс", v: "$18 400", tone: "" },
              { l: "Доходы / мес", v: "$6 200", tone: "" },
              { l: "Свободно", v: "+$2 100", tone: "text-pos" },
            ].map((f) => (
              <div key={f.l} className="rounded-[9px] border border-line-2 bg-card px-3 py-2.5">
                <div className="text-[10.5px] text-ink-3">{f.l}</div>
                <div className={"mt-0.5 text-[15px] font-semibold tracking-[-0.02em] tnum " + f.tone}>{f.v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-[9px] border border-line-2 bg-card px-3 pb-1.5 pt-2.5">
            <div className="mb-1 text-[11px] text-ink-3">Прогноз баланса · 12 месяцев</div>
            <svg viewBox="0 0 300 70" preserveAspectRatio="none" className="block h-auto w-full">
              <defs>
                <linearGradient id="ob-pva" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--green)" stopOpacity="0.18" />
                  <stop offset="1" stopColor="var(--green)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M6,26 C36,22 54,32 86,28 C116,24 146,38 178,36 C206,34 250,46 294,50 L294,66 L6,66 Z" fill="url(#ob-pva)" />
              <path d="M6,26 C36,22 54,32 86,28 C116,24 146,38 178,36 C206,34 250,46 294,50"
                fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" />
              <circle cx="294" cy="50" r="3.4" fill="var(--green)" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PART B — step 5 finish + runway preview
// ─────────────────────────────────────────────────────────────────────────────

function Finish({ runway, bal, inc, free, onDone, onBack }: {
  runway: RunwayPreview | null
  bal: string
  inc: string
  free: string
  onDone: () => void
  onBack: () => void
}) {
  const months = runway?.months ?? null
  const overHorizon = months == null
  const stateText = overHorizon ? "Большой запас"
    : months >= 14 ? "Отличный запас"
      : months >= 12 ? "Хороший запас" : "Запас тоньше"
  const until = runway?.until ? monthLabel(runway.until.slice(0, 7)) : null
  const thin = months != null && months < 12

  return (
    <div className="pb-1 pt-2 text-center">
      <div className="mx-auto mb-5 grid h-[60px] w-[60px] place-items-center rounded-2xl bg-pos-soft text-pos">
        <IcCheck className="h-[30px] w-[30px]" />
      </div>
      <h2 className="text-[28px] font-semibold tracking-[-0.03em]">Прогноз построен</h2>
      <p className="mx-auto mt-2 max-w-[46ch] text-[15.5px] text-ink-2">
        Готово. finplan собрал ваши счета, доходы и расходы — и посчитал, на сколько хватит денег.
      </p>

      <div className="mx-auto mt-6 max-w-[520px] rounded-2xl border border-border bg-card p-6 text-left shadow-[0_2px_4px_rgba(40,30,15,.04),0_20px_48px_-24px_rgba(40,30,15,.26)]">
        <div className="flex items-center justify-between gap-3.5">
          <span className={
            "inline-flex items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 " +
            (thin ? "bg-warn-soft" : "bg-pos-soft")
          }>
            <i className={"h-1.5 w-1.5 rounded-full " + (thin ? "bg-warn" : "bg-pos")} />
            <span className={"whitespace-nowrap text-xs font-semibold " + (thin ? "text-warn" : "text-pos")}>{stateText}</span>
          </span>
          <span className="text-[12px] text-ink-3">базовый сценарий</span>
        </div>
        <div className="mt-3.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-3">Запас хода</div>
        <div className="whitespace-nowrap leading-none">
          <b className={"text-[40px] font-semibold leading-none tracking-[-0.035em] tnum " + (thin ? "text-warn" : "text-pos")}>
            {overHorizon ? "12+" : `≈ ${months}`}
          </b>
          <span className="ml-2 text-[17px] font-medium text-ink-2">{overHorizon ? "месяцев" : "месяцев"}</span>
        </div>
        <div className="mt-2 text-sm text-ink-2">
          {overHorizon
            ? <>денег хватает дольше горизонта прогноза</>
            : <>при текущем ритме денег хватает до <b className="font-semibold text-foreground">{until ?? "—"}</b></>}
        </div>
        <div className="mt-[18px] flex gap-7 border-t border-line-2 pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="whitespace-nowrap text-[12px] text-ink-3">Баланс</span>
            <span className="whitespace-nowrap text-base font-semibold tnum">{bal}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="whitespace-nowrap text-[12px] text-ink-3">Доходы / мес</span>
            <span className="whitespace-nowrap text-base font-semibold tnum">{inc}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="whitespace-nowrap text-[12px] text-ink-3">Свободно / мес</span>
            <span className="whitespace-nowrap text-base font-semibold text-pos tnum">{free}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-center gap-3">
        <button onClick={onDone} className={btn("primary") + " h-[46px] px-[22px] text-[15px]"}>
          Открыть дашборд
        </button>
        <button onClick={onBack} className={btn("ghost") + " h-[46px] px-[22px] text-[15px]"}>
          Вернуться к настройке
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function PeriodPicker({ value, onChange }: { value: Recurrence; onChange: (v: Recurrence) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Recurrence)}
        className={inputCls + " cursor-pointer appearance-none pr-7"}
      >
        {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string) {
  const m = n % 100, d = n % 10
  if (m > 10 && m < 20) return many
  if (d === 1) return one
  if (d > 1 && d < 5) return few
  return many
}
