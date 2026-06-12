import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { api, type Account, type LastSnapshot, type SnapshotHistory, type SnapshotPrefill } from "@/lib/api"
import { ddmm, money, todayIso } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

export default function Snapshot() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [last, setLast] = useState<LastSnapshot | null>(null)
  const [history, setHistory] = useState<SnapshotHistory | null>(null)
  const [values, setValues] = useState<Record<number, string>>({})
  const [takenAt, setTakenAt] = useState(todayIso())
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  // префилл «Сейчас» последним известным остатком по каждому счёту (даже если счёт
  // выпал из последнего снимка) — чтобы ничего не обнулялось молча
  const seedFromPrefill = useCallback(async () => {
    const pf = await api.get<SnapshotPrefill>("/snapshots/prefill")
    const seed: Record<number, string> = {}
    for (const it of pf.items) seed[it.account_id] = String(it.amount)
    setValues(seed)
  }, [])

  const load = useCallback(async () => {
    const [accs, lastSnap, hist] = await Promise.all([
      api.get<Account[]>("/accounts"),
      api.get<LastSnapshot>("/snapshots/last"),
      api.get<SnapshotHistory>("/snapshots/history"),
    ])
    setAccounts(accs)
    setLast(lastSnap)
    setHistory(hist)
    await seedFromPrefill()
  }, [seedFromPrefill])

  useEffect(() => { void load() }, [load])

  const lastAmount = (id: number) =>
    last?.items.find((i) => i.account_id === id)?.amount

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
    await api.post("/snapshots", { taken_at: takenAt, items })
    navigate("/")
  }

  const cur = history?.base_currency ?? ""
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
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editing ? `Редактирую снимок за ${ddmm(takenAt)}` : "Снимок остатков"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {editing ? (
              <>Правлю прошлый снимок — поля заполнены его строками. </>
            ) : (
              <>Поля уже заполнены последними известными остатками — поправь, что изменилось. </>
            )}
            {!editing && last?.taken_at && <>Прошлый снимок: {ddmm(last.taken_at)}.</>}
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
                    <TableHead className="w-32 text-right">Прошлый</TableHead>
                    <TableHead className="w-40 text-right">Сейчас</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((a, idx) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="text-muted-foreground">{a.currency}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {lastAmount(a.id) !== undefined ? money(lastAmount(a.id)!) : "—"}
                      </TableCell>
                      <TableCell>
                        <Input
                          autoFocus={idx === 0}
                          inputMode="decimal"
                          className="text-right tabular-nums"
                          placeholder={lastAmount(a.id) !== undefined ? money(lastAmount(a.id)!) : ""}
                          value={values[a.id] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center gap-3">
                <Input type="date" className="w-40" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} />
                <Button type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить снимок"}</Button>
                {editing && (
                  <Button type="button" variant="ghost" onClick={() => void newSnapshot()}>
                    ← Новый снимок на сегодня
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Счетов пока нет — заведи их в <Link className="underline underline-offset-4" to="/settings">Настройках</Link>.
            </p>
          )}
        </CardContent>
      </Card>

      {histRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">История снимков</CardTitle>
            <p className="text-sm text-muted-foreground">остаток в {cur} на каждую дату — нажми строку, чтобы отредактировать</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Дата</TableHead>
                  <TableHead className="text-right">Всего, {cur}</TableHead>
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
                    <TableCell className="text-right font-medium tabular-nums">{money(r.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.delta == null
                        ? <span className="text-muted-foreground">—</span>
                        : <span className={r.delta >= 0 ? "text-emerald-600" : "text-red-600"}>
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
            <CardTitle className="text-base">Тренд расходов по неделям</CardTitle>
            <p className="text-sm text-muted-foreground">
              падение остатка между снимками ({cur}) и среднее за 4 периода
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
                    `${money(Number(value))} ${cur}`,
                    name === "avg" ? "среднее (4 пер.)" : "за период",
                  ]}
                  labelFormatter={(label) => ddmm(String(label))}
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
                />
                <Bar dataKey="burn" fill="var(--foreground)" fillOpacity={0.18} isAnimationActive={false} />
                <Line type="monotone" dataKey="avg" stroke="#dc2626" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
