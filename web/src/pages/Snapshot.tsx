import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import {
  api,
  type Account,
  type LastSnapshot,
  type Rates,
  type SnapshotHistory,
  type SnapshotPrefill,
} from "@/lib/api"
import { ddmm, money, todayIso } from "@/lib/format"
import { SectionHelp } from "@/components/SectionHelp"
import { AccountsManager } from "@/components/AccountsManager"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

// палитра для долей счетов в общем балансе (как в макете)
const SPLIT_COLORS = [
  "var(--accent)", "var(--green)", "var(--amber)", "var(--ink-3)", "var(--accent-2)",
]

const parseAmount = (raw: string) =>
  Number(raw.replace(/\s/g, "").replace(",", "."))

export default function Snapshot() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [last, setLast] = useState<LastSnapshot | null>(null)
  const [history, setHistory] = useState<SnapshotHistory | null>(null)
  const [rates, setRates] = useState<Rates | null>(null)
  const [values, setValues] = useState<Record<number, string>>({})
  const [takenAt, setTakenAt] = useState(todayIso())
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const triedFx = useRef(false)

  // префилл «Сейчас» последним известным остатком по каждому счёту (даже если счёт
  // выпал из последнего снимка) — чтобы ничего не обнулялось молча
  const seedFromPrefill = useCallback(async () => {
    const pf = await api.get<SnapshotPrefill>("/snapshots/prefill")
    const seed: Record<number, string> = {}
    for (const it of pf.items) seed[it.account_id] = String(it.amount)
    setValues(seed)
  }, [])

  const load = useCallback(async () => {
    const [accs, lastSnap, hist, rt] = await Promise.all([
      api.get<Account[]>("/accounts"),
      api.get<LastSnapshot>("/snapshots/last"),
      api.get<SnapshotHistory>("/snapshots/history"),
      api.get<Rates>("/rates"),
    ])
    setAccounts(accs)
    setLast(lastSnap)
    setHistory(hist)
    // у счётной валюты нет курса → счёт = 0 в базовой (BUG-007). Подтягиваем курсы
    // используемых валют один раз; если сеть/er-api не дали — остаёмся как есть.
    if (rt.missing && rt.missing.length > 0 && !triedFx.current) {
      triedFx.current = true
      try {
        await api.post("/fx/refresh", {})
        setRates(await api.get<Rates>("/rates"))
      } catch { setRates(rt) }
    } else {
      setRates(rt)
    }
    await seedFromPrefill()
  }, [seedFromPrefill])

  useEffect(() => { void load() }, [load])

  const base = rates?.base_currency ?? history?.base_currency ?? ""

  // currency → rate_to_base (1 единица валюты в базовой)
  const rateTo = useMemo(() => {
    const m = new Map<string, number>()
    if (base) m.set(base, 1)
    for (const r of rates?.rates ?? []) {
      if (r.rate_to_base != null) m.set(r.currency, r.rate_to_base)
    }
    return m
  }, [rates, base])

  const toBase = (amount: number, currency: string) =>
    amount * (rateTo.get(currency) ?? (currency === base ? 1 : 0))

  const lastAmount = (id: number) =>
    last?.items.find((i) => i.account_id === id)?.amount

  // текущее введённое значение по счёту (число; пусто → null)
  const enteredAmount = (id: number): number | null => {
    const raw = (values[id] ?? "").trim()
    if (raw === "") return null
    const n = parseAmount(raw)
    return Number.isFinite(n) ? n : null
  }

  // «Итого сейчас» = сумма введённых остатков, сконвертированных в базовую
  const totalNow = useMemo(() => {
    let sum = 0
    for (const a of accounts) {
      const v = enteredAmount(a.id)
      if (v !== null) sum += toBase(v, a.currency)
    }
    return sum
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, values, rateTo, base])

  // доли счетов в общем балансе (для боковой панели)
  const splits = useMemo(() => {
    const parts = accounts
      .map((a, i) => {
        const v = enteredAmount(a.id)
        return {
          id: a.id,
          name: a.name,
          base: v === null ? 0 : toBase(v, a.currency),
          color: SPLIT_COLORS[i % SPLIT_COLORS.length],
        }
      })
      .filter((p) => p.base > 0)
    return parts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, values, rateTo, base])

  // открыть прошлый снимок на редактирование — поля заполняются ровно его строками
  async function editSnapshot(d: string) {
    const snap = await api.get<LastSnapshot>(`/snapshots/${d}`)
    const seed: Record<number, string> = {}
    for (const it of snap.items) seed[it.account_id] = String(it.amount)
    setValues(seed)
    setTakenAt(d)
    setEditing(true)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // вернуться к свежему снимку на сегодня
  async function newSnapshot() {
    setTakenAt(todayIso())
    setEditing(false)
    await seedFromPrefill()
  }

  async function submitSnapshot(e: React.FormEvent) {
    e.preventDefault()
    const items = accounts
      .map((a) => ({ account_id: a.id, raw: (values[a.id] ?? "").replace(/\s/g, "").replace(",", ".") }))
      .filter((i) => i.raw !== "")
      .map((i) => ({ account_id: i.account_id, amount: Number(i.raw) }))
    if (!items.length) return
    setBusy(true)
    try {
      await api.post("/snapshots", { taken_at: takenAt, items })
      setEditing(false)
      await load()  // обновляем «Прошлый»/историю/итого + пере-сеем «Сейчас»
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } finally {
      setBusy(false)
    }
    // НЕ навигируем на дашборд: внезапный переход сбивал онбординг-тур (он на /balance,
    // тур возвращал назад → петля, «дальше не идёт») и просто удивлял. Остаёмся на месте.
  }

  const histRows = (history?.items ?? [])
    .map((it, i, arr) => ({ ...it, delta: i > 0 ? it.total - arr[i - 1].total : null }))
    .slice(-8)
    .reverse()

  // тренд расходов: burn за период = падение остатка между соседними снимками
  // (положительный = потрачено), + скользящее среднее за 4 периода
  const burnBase = (history?.items ?? [])
    .map((it, i, arr) => (i === 0 ? null : { date: it.date, burn: arr[i - 1].total - it.total }))
    .filter((x): x is { date: string; burn: number } => x !== null)
    .slice(-12)
  const burnSeries = burnBase.map((p, i, arr) => {
    const window = arr.slice(Math.max(0, i - 3), i + 1)
    return { ...p, avg: window.reduce((s, w) => s + w.burn, 0) / window.length }
  })

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <SectionHelp route="/snapshot" title="Баланс">
        Сколько денег на счетах прямо сейчас — это точка, от которой строится прогноз. Вписывайте остатки раз
        в неделю-две, баланс сейчас = старт прогноза. Счета можно завести прямо здесь.
      </SectionHelp>

      {/* ── Итого (T0) + раскладка по счетам ── */}
      <section className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
        <Card className="relative overflow-hidden">
          <span className="pointer-events-none absolute left-0 top-5 bottom-5 w-[3px] rounded bg-primary" />
          <CardContent className="py-6 pl-7">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">
              Итого на счетах
            </div>
            <div className="mt-1.5 text-4xl font-semibold tracking-tight tnum tabular-nums">
              ≈ {money(totalNow)} {base}
            </div>
            <p className="mt-2 max-w-[48ch] text-sm text-ink-2">
              Баланс сейчас = старт прогноза — отметка «сегодня», от которой{" "}
              <Link to="/" className="font-semibold text-primary hover:underline">
                кривая на дашборде
              </Link>{" "}
              считает запас хода.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full flex-col justify-center gap-3.5 py-5">
            {splits.length ? (
              <>
                <div className="flex flex-col gap-2.5">
                  {splits.map((p) => (
                    <div key={p.id} className="grid grid-cols-[14px_1fr_auto] items-center gap-2.5 text-sm">
                      <span className="h-2.5 w-2.5 rounded" style={{ background: p.color }} />
                      <span className="truncate text-ink-2">{p.name}</span>
                      <span className="text-xs text-ink-3 tnum tabular-nums">
                        {totalNow ? Math.round((p.base / totalNow) * 100) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex h-[7px] gap-0.5 overflow-hidden rounded">
                  {splits.map((p) => (
                    <i
                      key={p.id}
                      className="h-full rounded"
                      style={{
                        width: `${totalNow ? (p.base / totalNow) * 100 : 0}%`,
                        background: p.color,
                        opacity: 0.7,
                      }}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-3">
                Впиши остатки — увидишь, как распределён баланс по счетам.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Запись баланса сейчас ── */}
      <Card data-coach="snapshot">
        <CardHeader>
          <CardTitle className="text-base">
            {editing ? `Правлю баланс за ${ddmm(takenAt)}` : "Записать баланс сейчас"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {editing ? (
              <>Правлю прошлую запись — поля заполнены её строками. </>
            ) : (
              <>Поля уже заполнены последними известными остатками — поправь, что изменилось. </>
            )}
            {!editing && last?.taken_at && <>Прошлая запись: {ddmm(last.taken_at)}.</>}
          </p>
        </CardHeader>
        <CardContent>
          {accounts.length ? (
            <form onSubmit={submitSnapshot} className="flex flex-col gap-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Счёт</TableHead>
                    <TableHead className="w-20">Валюта</TableHead>
                    <TableHead className="w-28 text-right">Прошлый</TableHead>
                    <TableHead className="w-40 text-right">Сейчас</TableHead>
                    <TableHead className="w-36 text-right">В базовой</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((a, idx) => {
                    const entered = enteredAmount(a.id)
                    const sameCur = a.currency === base
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-ink-2">{a.currency}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {lastAmount(a.id) !== undefined ? money(lastAmount(a.id)!) : "—"}
                        </TableCell>
                        <TableCell>
                          <Input
                            autoFocus={idx === 0}
                            inputMode="decimal"
                            className="text-right tabular-nums tnum"
                            placeholder={lastAmount(a.id) !== undefined ? money(lastAmount(a.id)!) : ""}
                            value={values[a.id] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums tnum text-ink-3">
                          {entered === null
                            ? "—"
                            : sameCur
                              ? <span className="opacity-50">—</span>
                              : `≈ ${money(toBase(entered, a.currency))} ${base}`}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <div className="flex items-center gap-3">
                <Input type="date" className="w-40" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} />
                <Button type="submit" disabled={busy}>{busy ? "Сохраняю…" : saved ? "Записано ✓" : "Записать баланс"}</Button>
                {editing && (
                  <Button type="button" variant="ghost" onClick={() => void newSnapshot()}>
                    ← Новая запись на сегодня
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Счетов пока нет — заведи их ниже, в блоке «Счета», и они появятся здесь.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Управление счетами ── */}
      <AccountsManager onChanged={() => void load()} />

      {/* ── История + расход (вторичный блок) ── */}
      {histRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">История баланса</CardTitle>
            <p className="text-sm text-muted-foreground">
              остаток в {base} на каждую дату — нажми строку, чтобы отредактировать
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Дата</TableHead>
                  <TableHead className="text-right">Всего, {base}</TableHead>
                  <TableHead className="w-32 text-right">Изменение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {histRows.map((r) => (
                  <TableRow
                    key={r.date}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => void editSnapshot(r.date)}
                  >
                    <TableCell className="tabular-nums text-muted-foreground underline-offset-4 hover:underline">{ddmm(r.date)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums tnum">{money(r.total)}</TableCell>
                    <TableCell className="text-right tabular-nums tnum">
                      {r.delta == null
                        ? <span className="text-muted-foreground">—</span>
                        : <span className={r.delta >= 0 ? "text-pos" : "text-neg"}>
                            {r.delta >= 0 ? "+" : "−"}{money(Math.abs(r.delta))}
                          </span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {burnSeries.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Сколько тратится по неделям</CardTitle>
            <p className="text-sm text-muted-foreground">
              насколько падает сумма между записями ({base}) и среднее за 4 раза
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={burnSeries} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <XAxis
                  dataKey="date" tickFormatter={(d: string) => ddmm(d)} minTickGap={32}
                  tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => money(v)} width={64} tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)" tickLine={false} axisLine={false}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `${money(Number(value))} ${base}`,
                    name === "avg" ? "среднее (4 пер.)" : "за период",
                  ]}
                  labelFormatter={(label) => ddmm(String(label))}
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
                />
                <Bar dataKey="burn" fill="var(--foreground)" fillOpacity={0.18} isAnimationActive={false} />
                <Line type="monotone" dataKey="avg" stroke="var(--neg)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
