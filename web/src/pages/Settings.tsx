import { useCallback, useEffect, useState } from "react"
import { api, type Account, type Rates, type Ref, type Settings as SettingsData } from "@/lib/api"
import { ACCOUNT_PRESETS, ACCOUNT_TYPES } from "@/lib/constants"
import { refreshCurrencies } from "@/lib/currencies"
import { ddmm } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CurrencySelect } from "@/components/CurrencySelect"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableRow,
} from "@/components/ui/table"

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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={add} className="flex items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новое значение" className="w-56" />
          <Button type="submit" variant="secondary" disabled={!name.trim()}>Добавить</Button>
        </form>
        {items.length > 0 && (
          <Table>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-500"
                      onClick={() => api.delete(`/${path}/${it.id}`).then(load)}>✕</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function AccountsManager() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [preset, setPreset] = useState("")
  const [customName, setCustomName] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [type, setType] = useState("bank")

  const load = useCallback(() => api.get<Account[]>("/accounts").then(setAccounts), [])
  useEffect(() => { void load() }, [load])

  function pickPreset(v: string) {
    setPreset(v)
    const found = ACCOUNT_PRESETS.flatMap((g) => g.items).find((p) => p.name === v)
    if (found) { setCurrency(found.currency); setType(found.type) }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const name = preset === "custom" ? customName.trim() : preset
    if (!name) return
    await api.post("/accounts", { name, currency, type })
    setPreset(""); setCustomName("")
    void load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Счета</CardTitle>
        <p className="text-sm text-muted-foreground">Что входит в баланс. Архивные счёта исчезают из снимка, но история остаётся.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <Select value={preset} onValueChange={pickPreset}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Выбери счёт…" /></SelectTrigger>
            <SelectContent>
              {ACCOUNT_PRESETS.map((g) => (
                <SelectGroup key={g.group}>
                  <SelectLabel>{g.group}</SelectLabel>
                  {g.items.map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                </SelectGroup>
              ))}
              <SelectGroup>
                <SelectLabel>Другое</SelectLabel>
                <SelectItem value="custom">Своё название…</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {preset === "custom" && (
            <Input value={customName} onChange={(e) => setCustomName(e.target.value)}
              placeholder="Название счёта" className="w-44" autoFocus />
          )}
          <CurrencySelect value={currency} onChange={setCurrency} />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="submit" variant="secondary" disabled={!preset || (preset === "custom" && !customName.trim())}>
            Добавить счёт
          </Button>
        </form>
        {accounts.length > 0 && (
          <Table>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{a.currency}</TableCell>
                  <TableCell className="text-muted-foreground">{a.type}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="text-muted-foreground"
                      onClick={() => api.delete(`/accounts/${a.id}`).then(load)}>архив</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function FxManager({ base }: { base: string }) {
  const [data, setData] = useState<Rates | null>(null)
  const [currency, setCurrency] = useState("")
  const [rate, setRate] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api.get<Rates>("/rates").then(setData), [])
  useEffect(() => { void load() }, [load])

  async function addRate(e: React.FormEvent) {
    e.preventDefault()
    if (!currency.trim() || rate === "") return
    await api.post("/fx", { currency: currency.trim().toUpperCase(), rate_to_base: Number(rate) })
    setCurrency(""); setRate("")
    void load()
    void refreshCurrencies()  // новая валюта появится во всех дропдаунах
  }

  async function refresh() {
    setBusy(true)
    try { await api.post("/fx/refresh", {}) } finally { setBusy(false) }
    void load()
    void refreshCurrencies()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Курсы валют</CardTitle>
        <p className="text-sm text-muted-foreground">
          Всё приводится к базовой ({base}). Фиат тянется автоматически раз в сутки; крипту и экзотику задавай вручную (1 единица = сколько {base}).
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data && data.missing.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Без курса: {data.missing.join(", ")} — задай вручную ниже или нажми «Обновить курсы». Пока считаются по нулю.
          </div>
        )}
        <form onSubmit={addRate} className="flex flex-wrap items-center gap-2">
          <CurrencySelect value={currency} onChange={setCurrency} />
          <span className="text-sm text-muted-foreground">1 =</span>
          <Input value={rate} onChange={(e) => setRate(e.target.value)} type="number" step="any"
            placeholder="курс" className="w-28" />
          <span className="text-sm text-muted-foreground">{base}</span>
          <Button type="submit" variant="secondary" disabled={!currency.trim() || rate === ""}>Сохранить курс</Button>
          <Button type="button" variant="ghost" onClick={refresh} disabled={busy}>
            {busy ? "Обновляю…" : "Обновить курсы"}
          </Button>
        </form>
        {data && data.rates.length > 0 && (
          <Table>
            <TableBody>
              {data.rates.map((r) => (
                <TableRow key={r.currency}>
                  <TableCell className="font-medium">{r.currency}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {r.is_base ? "база" : r.rate_to_base != null ? `1 = ${r.rate_to_base} ${base}` : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{r.rate_date ? ddmm(r.rate_date) : ""}</TableCell>
                  <TableCell className="text-right">
                    {r.is_base
                      ? <Badge variant="secondary">база</Badge>
                      : r.rate_to_base == null
                        ? <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">нет курса</Badge>
                        : r.used ? <Badge variant="outline">в обороте</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(() => api.get<SettingsData>("/settings").then(setSettings), [])
  useEffect(() => { void load() }, [load])

  async function save(e: React.FormEvent<HTMLFormElement>) {
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

  if (!settings) return <div className="py-20 text-center text-sm text-muted-foreground">Загрузка…</div>
  const cur = settings.base_currency

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Параметры прогноза</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cushion">Подушка, {cur}</Label>
              <Input id="cushion" name="cushion" type="number" step="any" defaultValue={settings.cushion} className="w-40" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="horizon">Горизонт, дней</Label>
              <Input id="horizon" name="horizon_days" type="number" defaultValue={settings.horizon_days} className="w-32" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="burn">Burn вручную, {cur}/нед</Label>
              <Input id="burn" name="manual_burn_weekly" type="number" step="any"
                defaultValue={settings.manual_burn_weekly ?? ""} className="w-40" />
            </div>
            <Button type="submit">{saved ? "Сохранено ✓" : "Сохранить"}</Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Подушка — минимально допустимый остаток, ниже которого срабатывает gap-предупреждение.
            Burn вручную используется, пока снимков меньше четырёх; дальше считается из их дельт.
          </p>
        </CardContent>
      </Card>

      <AccountsManager />

      <FxManager base={cur} />

      <div className="grid gap-6 lg:grid-cols-2">
        <RefManager title="Направления дохода" path="directions" hint="Фриланс, Консалтинг — для атрибуции поступлений." />
        <RefManager title="Категории расходов" path="categories" hint="Жильё, Налоги — для разметки предстоящих расходов." />
      </div>
    </div>
  )
}
