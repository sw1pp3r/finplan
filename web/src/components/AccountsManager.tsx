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

export function AccountsManager({
  onChanged,
  defaultOpen = true,
}: {
  onChanged?: () => void
  defaultOpen?: boolean
}) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [open, setOpen] = useState(defaultOpen)
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
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Управление счетами</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {accounts.length
              ? `${accounts.length} активных · добавление и архив`
              : "Добавь первый счёт — он появится в записи баланса"}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 shrink-0 sm:min-h-9"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Скрыть" : "Управлять"}
        </Button>
      </CardHeader>
      {open && <CardContent className="flex flex-col gap-4">
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <Select value={preset} onValueChange={pickPreset}>
            <SelectTrigger className="min-h-11 w-48 sm:min-h-9" aria-label="Шаблон счёта"><SelectValue placeholder="Выбери счёт…" /></SelectTrigger>
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
              placeholder="Название счёта" aria-label="Название нового счёта" className="min-h-11 w-44 sm:min-h-9" autoFocus />
          )}
          <CurrencySelect value={currency} onChange={setCurrency} ariaLabel="Валюта нового счёта" />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="min-h-11 w-28 sm:min-h-9" aria-label="Тип нового счёта"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="submit" variant="secondary" className="min-h-11 sm:min-h-9"
            disabled={!preset || (preset === "custom" && !customName.trim())}>
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
                    <Button size="sm" variant="ghost" className="min-h-11 text-muted-foreground sm:min-h-8"
                      onClick={() => void archive(a.id)}>архив</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>}
    </Card>
  )
}
