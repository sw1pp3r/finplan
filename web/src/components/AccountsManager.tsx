import { useCallback, useEffect, useState } from "react"
import { api, type Account } from "@/lib/api"
import { ACCOUNT_PRESETS, ACCOUNT_TYPES } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CurrencySelect } from "@/components/CurrencySelect"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"

export function AccountsManager({ onChanged }: { onChanged?: () => void }) {
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
    void load(); onChanged?.()
  }

  async function archive(id: number) {
    await api.delete(`/accounts/${id}`)
    void load(); onChanged?.()
  }

  return (
    <Card id="accounts" data-coach="accounts" className="scroll-mt-20">
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
                      onClick={() => void archive(a.id)}>архив</Button>
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
