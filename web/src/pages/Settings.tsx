import { useCallback, useEffect, useState } from "react"
import { api, isDemo, setDemo, type Rates, type Ref, type Settings as SettingsData } from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { ddmm } from "@/lib/format"
import { useShowCourse, setShowCourse } from "@/lib/prefs"
import { SectionHelp } from "@/components/SectionHelp"
import { InfoHint } from "@/components/InfoHint"
import { AccountsManager } from "@/components/AccountsManager"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CurrencySelect } from "@/components/CurrencySelect"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

// ── названия валют для подписей в таблице курсов ──────────────────────────────
const CUR_NAME: Record<string, string> = {
  USD: "Доллар США", EUR: "Евро", RUB: "Российский рубль", USDT: "Tether",
  GBP: "Фунт стерлингов", KZT: "Казахстанский тенге", AED: "Дирхам ОАЭ",
}
const SYM: Record<string, string> = { USD: "$", EUR: "€", RUB: "₽", USDT: "₮", GBP: "£" }
// пресеты базовой валюты, как в макете
const BASE_PRESETS: { code: string; label: string }[] = [
  { code: "RUB", label: "Рубли (RUB)" },
  { code: "USD", label: "Доллары (USD)" },
  { code: "EUR", label: "Евро (EUR)" },
]
const BASE_NOW: Record<string, string> = {
  USD: "долларах (USD)", EUR: "евро (EUR)", RUB: "рублях (RUB)",
}
const ADD = "__add__"

// ── мелкие строительные блоки в стиле макета ────────────────────────────────
function SectionHead({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-0.5 pb-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.07em] text-ink-3">{title}</h3>
      <p className="mt-1.5 max-w-[62ch] text-[13px] text-ink-2">{children}</p>
    </div>
  )
}

function Section({ title, head, children }: { title: string; head: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <SectionHead title={title}>{head}</SectionHead>
      {children}
    </section>
  )
}

// тумблер в духе макета (.switch)
function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="relative h-[27px] w-[46px] flex-none cursor-pointer rounded-full border transition-colors"
      style={{
        backgroundColor: on ? "var(--primary)" : "var(--line)",
        borderColor: on ? "var(--primary)" : "var(--line)",
      }}
    >
      <span
        className="absolute top-[3px] h-[21px] w-[21px] rounded-full bg-white shadow transition-transform"
        style={{ left: 3, transform: on ? "translateX(19px)" : "none" }}
      />
    </button>
  )
}

// ── курсы валют (auto + manual), API: /rates, /fx, /fx/refresh ───────────────
function FxTable({ base }: { base: string }) {
  const [data, setData] = useState<Rates | null>(null)
  const [adding, setAdding] = useState(false)
  const [currency, setCurrency] = useState("")
  const [rate, setRate] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api.get<Rates>("/rates").then(setData), [])
  useEffect(() => { void load() }, [load])

  async function addRate(e: React.FormEvent) {
    e.preventDefault()
    if (!currency.trim() || rate === "") return
    await api.post("/fx", { currency: currency.trim().toUpperCase(), rate_to_base: Number(rate) })
    setCurrency(""); setRate(""); setAdding(false)
    void load()
    void refreshCurrencies()
  }

  async function refresh() {
    setBusy(true)
    try { await api.post("/fx/refresh", {}) } finally { setBusy(false) }
    void load()
    void refreshCurrencies()
  }

  const cols = "grid-cols-[minmax(0,1fr)_150px_150px_40px]"

  return (
    <Card className="overflow-hidden p-2 pb-3">
      <div className="flex items-center justify-between gap-3 px-3.5 pb-1 pt-3">
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 transition-colors hover:text-foreground disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-pos" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 2l3 3-3 3" /><path d="M3 11V9a4 4 0 0 1 4-4h13" /><path d="M7 22l-3-3 3-3" /><path d="M21 13v2a4 4 0 0 1-4 4H4" />
          </svg>
          {busy ? "Обновляю…" : "Авто-обновление включено"}
        </button>
        <span className="text-[12.5px] text-ink-3">базовая — {base}</span>
      </div>

      <div className={`mx-1 grid ${cols} items-center gap-3.5 px-3.5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-3`}>
        <span>Валюта</span>
        <span>Курс к базовой</span>
        <span className="hidden sm:block">Обновлено</span>
        <span />
      </div>

      <div>
        {(data?.rates ?? []).map((r) => {
          const isBase = r.is_base
          return (
            <div
              key={r.currency}
              className={`mx-1 grid ${cols} items-center gap-3.5 rounded-[10px] px-3.5 py-2.5 transition-colors [box-shadow:inset_0_1px_0_var(--line-2)] first:[box-shadow:none] hover:bg-card-2`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] border border-border bg-card-2 text-[15px] font-semibold text-ink-2">
                  {SYM[r.currency] ?? r.currency[0]}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight">
                    {r.currency}
                    {isBase && (
                      <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-primary">базовая</span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-ink-3">{CUR_NAME[r.currency] ?? "Валюта"}</div>
                </div>
              </div>
              <span className="tnum whitespace-nowrap text-left text-[14.5px] font-semibold">
                {isBase
                  ? "1,00"
                  : r.rate_to_base != null
                    ? <>{r.rate_to_base.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} <span className="text-[12px] font-normal text-ink-3">{base}</span></>
                    : <span className="text-warn">нет курса</span>}
              </span>
              <span className={`tnum hidden whitespace-nowrap text-[13px] sm:block ${r.rate_date ? "text-ink-3" : "text-warn"}`}>
                {isBase ? "—" : r.rate_date ? ddmm(r.rate_date) : "вручную"}
              </span>
              <span />
            </div>
          )
        })}
      </div>

      {data && data.missing.length > 0 && (
        <p className="mx-1 mt-2 px-3.5 text-[12px] text-warn">
          Без курса: {data.missing.join(", ")} — добавьте вручную или нажмите «Авто-обновление». Пока считаются по нулю.
        </p>
      )}

      {adding ? (
        <form
          onSubmit={addRate}
          className={`mx-1 my-1.5 grid ${cols} items-center gap-3.5 rounded-[10px] bg-card px-3.5 py-2.5 [box-shadow:0_0_0_1px_var(--primary),0_0_0_4px_var(--accent-soft)]`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="whitespace-nowrap text-[13px] text-ink-3">1 =</span>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} type="number" step="any" placeholder="курс" className="h-9 w-24 tnum" />
            <span className="text-[13px] text-ink-3">{base}</span>
          </div>
          <span className="hidden text-[13px] text-warn sm:block">вручную</span>
          <span />
          <div className="col-span-full mt-2 flex items-center gap-2 border-t border-line-2 pt-3">
            <Button type="button" variant="ghost" onClick={() => { setAdding(false); setCurrency(""); setRate("") }}>Отмена</Button>
            <div className="flex-1" />
            <Button type="submit" disabled={!currency.trim() || rate === ""}>Сохранить</Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mx-1 mt-2 ml-1 inline-flex h-[38px] items-center gap-2 rounded-[9px] border border-dashed border-border px-3 text-[13.5px] font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary"
        >
          <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          Добавить валюту
        </button>
      )}
    </Card>
  )
}

// ── справочники (направления / категории), API: /directions, /categories ─────
function RefManager({ title, path, hint }: { title: string; path: string; hint?: string }) {
  const [items, setItems] = useState<Ref[]>([])
  const [name, setName] = useState("")
  const load = useCallback(() => api.get<Ref[]>(`/${path}`).then(setItems), [path])
  useEffect(() => { void load() }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await api.post(`/${path}`, { name: name.trim() })
    setName("")
    void load()
  }

  return (
    <Card className="p-4">
      <div className="mb-3">
        <div className="text-[14.5px] font-semibold">{title}</div>
        {hint && <p className="mt-1 text-[12.5px] text-ink-2">{hint}</p>}
      </div>
      <form onSubmit={add} className="mb-2 flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новое значение" className="h-9 flex-1" />
        <Button type="submit" variant="secondary" disabled={!name.trim()}>Добавить</Button>
      </form>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <span key={it.id} className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-card-2 py-1 pl-2.5 pr-1 text-[13px] text-ink-2">
              {it.name}
              <button
                type="button"
                aria-label={`Удалить ${it.name}`}
                onClick={() => void api.delete(`/${path}/${it.id}`).then(load)}
                className="grid h-5 w-5 place-items-center rounded-md text-ink-3 transition-colors hover:bg-neg-soft hover:text-neg"
              >✕</button>
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [rates, setRates] = useState<Rates | null>(null)
  const [saved, setSaved] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [baseBusy, setBaseBusy] = useState(false)
  const [baseErr, setBaseErr] = useState<string | null>(null)
  const showCourse = useShowCourse()
  const demo = isDemo()

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      api.get<SettingsData>("/settings"),
      api.get<Rates>("/rates"),
    ])
    setSettings(s)
    setRates(r)
  }, [])
  useEffect(() => { void load() }, [load])

  async function saveName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await api.patch("/settings", { display_name: String(fd.get("display_name") ?? "") })
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 1500)
    void load()
  }

  async function saveParams(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const body: Record<string, number> = {}
    for (const k of ["cushion", "horizon_days", "manual_burn_weekly"]) {
      const v = fd.get(k) as string
      if (v !== "") body[k] = Number(v)
    }
    await api.patch("/settings", body)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    void load()
  }

  async function changeBase(next: string) {
    if (!settings) return
    if (next === ADD) return // custom-ввод обрабатывается ниже отдельным контролом
    if (!next || next === settings.base_currency) return
    setBaseBusy(true); setBaseErr(null)
    try {
      await api.patch("/settings", { base_currency: next })
      await load()
      void refreshCurrencies()
    } catch {
      setBaseErr(`Сначала добавьте курс для ${next} в «Валютах и курсах» ниже — без него не пересчитать.`)
    } finally {
      setBaseBusy(false)
    }
  }

  function toggleDemo() {
    setDemo(!demo)
    location.reload() // перезапрашиваем все вкладки с новым заголовком X-Demo
  }

  if (!settings) return <div className="py-20 text-center text-sm text-muted-foreground">Загрузка…</div>
  const cur = settings.base_currency
  // в базовые предлагаем пресеты + текущую + любые конвертируемые (есть курс)
  const convertible = (rates?.rates ?? []).filter((r) => !r.is_base && r.rate_to_base != null).map((r) => r.currency)
  const baseOptions = Array.from(new Set([
    ...BASE_PRESETS.map((p) => p.code),
    cur,
    ...convertible,
  ]))
  const labelFor = (code: string) => BASE_PRESETS.find((p) => p.code === code)?.label ?? code

  return (
    <div className="mx-auto max-w-[880px]">
      <SectionHelp route="/settings" title="Настройки">
        Базовая валюта, курсы валют, счета и режим данных. Здесь же — параметры прогноза, справочники и видимость вкладки «Курс».
      </SectionHelp>

      <div className="mt-6">
        {/* ── профиль (имя) ──────────────────────────────────────────── */}
        <Section
          title="Профиль"
          head="Имя показывается в боковой панели. Можно изменить в любой момент."
        >
          <Card className="p-5">
            <form onSubmit={saveName} className="flex flex-wrap items-end gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="display_name" className="flex items-center gap-1.5 text-[13px]">Имя</Label>
                <Input
                  key={settings.display_name ?? ""}
                  id="display_name" name="display_name"
                  defaultValue={settings.display_name ?? ""}
                  placeholder="Ваше имя" className="w-64" maxLength={120}
                />
              </div>
              <Button type="submit">{nameSaved ? "Сохранено ✓" : "Сохранить"}</Button>
            </form>
          </Card>
        </Section>

        {/* ── базовая валюта ─────────────────────────────────────────── */}
        <Section
          title="Базовая валюта"
          head="Валюта, в которой finplan показывает общий баланс и запас хода. Все остальные суммы приводятся к ней автоматически."
        >
          <Card data-coach="base-currency" className="flex flex-row flex-wrap items-center gap-4 p-5">
            <div className="min-w-[200px] flex-1">
              <Label className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-ink-3">
                Базовая валюта
                <InfoHint>Валюта, в которой считается весь прогноз. Остальные суммы приводятся к ней по курсам.</InfoHint>
              </Label>
              <Select value={cur} onValueChange={changeBase} disabled={baseBusy}>
                <SelectTrigger className="h-[42px] w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {baseOptions.map((c) => <SelectItem key={c} value={c}>{labelFor(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="text-[13px] text-ink-2">
              Итог на дашборде сейчас в{" "}
              <b className="font-semibold text-foreground">{BASE_NOW[cur] ?? cur}</b>.
            </div>
            {baseErr && <p className="w-full text-[12px] text-neg">{baseErr}</p>}
            <p className="w-full text-[12px] text-ink-3">
              Нужна другая валюта базовой? Добавьте для неё курс ниже — и она появится в списке.
            </p>
          </Card>
        </Section>

        {/* ── валюты и курсы ─────────────────────────────────────────── */}
        <Section
          title="Валюты и курсы"
          head="Курс каждой валюты к базовой. Курсы обновляются автоматически раз в день — любой можно зафиксировать вручную."
        >
          <div id="rates" data-coach="rates" className="scroll-mt-20">
            <FxTable key={cur} base={cur} />
          </div>
        </Section>

        {/* ── демо-режим ─────────────────────────────────────────────── */}
        <Section
          title="Демо-режим"
          head="Витрина с данными примера. Реальные данные хранятся отдельно и не меняются, пока демо включено."
        >
          <Card className="flex flex-row items-center gap-5 p-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 text-[14.5px] font-semibold">
                Демонстрационные данные
                <span
                  className="rounded-[5px] px-2 py-0.5 text-[11px] font-semibold"
                  style={demo
                    ? { background: "var(--green-soft)", color: "var(--green)" }
                    : { background: "var(--card-2)", color: "var(--ink-3)" }}
                >
                  {demo ? "включено" : "выключено"}
                </span>
              </div>
              <p className="mt-1.5 max-w-[60ch] text-[12.5px] text-ink-2">
                При включении приложение показывает готовый пример. Реальные счета, доходы и расходы не меняются.
              </p>
            </div>
            <Toggle on={demo} onClick={toggleDemo} label="Демо-режим" />
          </Card>
        </Section>

        {/* ── счета ──────────────────────────────────────────────────── */}
        <Section
          title="Счета"
          head="Счета и остатки — точка отсчёта прогноза. Здесь же управляйте составом баланса."
        >
          <AccountsManager onChanged={load} />
        </Section>

        {/* ── параметры прогноза ─────────────────────────────────────── */}
        <Section
          title="Параметры прогноза"
          head="Подушка безопасности, горизонт и ручная оценка трат, пока снимков мало."
        >
          <Card className="p-5">
            <form onSubmit={saveParams} className="flex flex-wrap items-end gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="cushion" className="flex items-center gap-1.5 text-[13px]">
                  Подушка, {cur}
                  <InfoHint>Неприкосновенный остаток. Если прогноз падает ниже — finplan предупреждает.</InfoHint>
                </Label>
                <Input id="cushion" name="cushion" type="number" step="any" defaultValue={settings.cushion} className="w-40" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="horizon" className="flex items-center gap-1.5 text-[13px]">
                  На сколько вперёд считать, дней
                  <InfoHint>Длина прогноза. 180 — это полгода вперёд.</InfoHint>
                </Label>
                <Input id="horizon" name="horizon_days" type="number" defaultValue={settings.horizon_days} className="w-32" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="burn" className="flex items-center gap-1.5 text-[13px]">
                  Траты в неделю вручную, {cur}
                  <InfoHint>Пока снимков меньше четырёх, берём это число. Дальше finplan считает траты сам по снимкам.</InfoHint>
                </Label>
                <Input id="burn" name="manual_burn_weekly" type="number" step="any"
                  defaultValue={settings.manual_burn_weekly ?? ""} className="w-40" />
              </div>
              <Button type="submit">{saved ? "Сохранено ✓" : "Сохранить"}</Button>
            </form>
          </Card>
        </Section>

        {/* ── справочники ────────────────────────────────────────────── */}
        <Section
          title="Справочники"
          head="Метки направлений дохода и категорий расходов — чтобы видеть, откуда и куда идут деньги."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <RefManager title="Направления дохода" path="directions"
              hint="Фриланс, Консалтинг — чтобы видеть, откуда пришли деньги." />
            <RefManager title="Категории расходов" path="categories"
              hint="Жильё, налоги — чтобы группировать предстоящие расходы." />
          </div>
        </Section>

        {/* ── вкладка «Курс» ─────────────────────────────────────────── */}
        <Section
          title="Вкладка «Курс»"
          head="«Курс» — отдельная прикидка экономики обучения. На прогноз не влияет. Если не нужна — скройте её из меню."
        >
          <Card className="flex flex-row items-center gap-5 p-5">
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold">Показывать вкладку «Курс»</div>
              <p className="mt-1.5 text-[12.5px] text-ink-2">
                {showCourse ? "Вкладка показана в меню." : "Вкладка скрыта из меню."}
              </p>
            </div>
            <Toggle on={showCourse} onClick={() => setShowCourse(!showCourse)} label="Вкладка «Курс»" />
          </Card>
        </Section>
      </div>
    </div>
  )
}
