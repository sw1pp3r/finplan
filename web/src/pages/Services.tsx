import { useCallback, useEffect, useState } from "react"
import { Cell, IconBtn } from "@/components/InlineCell"
import {
  api, type ServiceListItem, type ServiceSummary, type ServiceTariffRow, type ServiceCostRow,
} from "@/lib/api"
import { refreshCurrencies } from "@/lib/currencies"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CurrencySelect } from "@/components/CurrencySelect"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

const KIND_LABEL: Record<ServiceCostRow["kind"], string> = {
  fixed: "фикс/мес",
  per_client: "на клиента",
  per_unit: "за юниты",
}

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

/* ── section head with right-aligned totals in the header line ─── */
function SectionHead({ title, totals }: { title: string; totals: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 px-3 py-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
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

function SummaryStrip({ data }: { data: ServiceSummary }) {
  const cur = data.base_currency
  const tone = summaryTone(data.net_monthly, data.required_monthly_income)
  const Item = ({ label, value, sub, cls }: { label: string; value: React.ReactNode; sub?: string; cls?: string }) => (
    <div className="min-w-0 flex-1 px-4 py-2.5 first:pl-0 last:pr-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className={cn("mt-0.5 truncate text-[15px] font-semibold tnum", cls)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-ink-3">{sub}</div>}
    </div>
  )
  return (
    <div className="flex flex-wrap divide-x divide-line-2 rounded-lg border border-border bg-card px-4">
      <Item label="MRR" value={`${money(data.mrr)} ${cur}`} sub={`${data.clients_total} клиентов`} />
      <Item label="COGS" value={`−${money(data.cogs_monthly)} ${cur}`} cls="text-neg"
        sub={`фикс ${money(data.fixed_monthly)} · клиент ${money(data.per_client_monthly)} · юниты ${money(data.per_unit_monthly)}`} />
      <Item label="Прибыль/мес" value={signed(data.net_monthly, cur)} cls={TONE_NUM[tone]}
        sub={`нужно ≥ ${money(data.required_monthly_income)} ${cur}`} />
      <Item label="Маржа" value={data.margin_pct === null ? "—" : `${Math.round(data.margin_pct * 100)}%`}
        sub={`${signed(data.net_vs_required, cur)} до breakeven`}
        cls={data.margin_pct === null ? undefined : (data.margin_pct >= 0 ? "text-pos" : "text-neg")} />
    </div>
  )
}

/* ── tariffs matrix ───────────────────────────────────────────── */
function TariffsTable({ summary, onPatch, onDelete, onAdd }: {
  summary: ServiceSummary
  onPatch: (id: number, body: Record<string, unknown>) => void
  onDelete: (id: number) => void
  onAdd: () => void
}) {
  const cur = summary.base_currency
  const perUnitCosts = summary.costs.filter((c) => c.kind === "per_unit")
  const gridCols = `minmax(0,1.4fr) 100px 90px ${perUnitCosts.map(() => "110px").join(" ")} 110px 32px`

  const patchUsage = (t: ServiceTariffRow, costId: number, raw: string) => {
    const usage = { ...t.usage }
    const v = Number(raw)
    if (Number.isFinite(v) && v > 0) usage[String(costId)] = v
    else delete usage[String(costId)]
    onPatch(t.id, { usage })
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <SectionHead title="Тарифы" totals={<>MRR <b className="font-semibold text-foreground">{money(summary.mrr)} {cur}</b></>} />
      <div className="overflow-x-auto border-t border-line-2">
        <div className="min-w-full">
          <div className="grid items-center gap-x-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3"
            style={{ gridTemplateColumns: gridCols }}>
            <span>Тариф</span>
            <span className="text-right">Цена</span>
            <span className="text-right">Клиенты</span>
            {perUnitCosts.map((c) => (
              <span key={c.id} className="truncate text-right" title={`${c.name}, ${c.unit_label ?? "юнитов"}/кл/мес`}>
                {c.name}, {c.unit_label ?? "юн."}/кл
              </span>
            ))}
            <span className="text-right">Маржа/кл</span>
            <span />
          </div>
          <div className="divide-y divide-line-2">
            {summary.tariffs.map((t) => (
              <div key={t.id}
                className="group grid items-center gap-x-2 px-3 py-1"
                style={{ gridTemplateColumns: gridCols }}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <Cell defaultValue={t.name} ariaLabel="Тариф" className="min-w-0 flex-1"
                    onCommit={(v) => onPatch(t.id, { name: v.trim() || "Тариф" })} />
                  <label className="flex flex-none items-center gap-1 text-[10px] font-semibold text-ink-3" title="BYO — клиент со своим ключом; fixed/per_client расходы всё равно считаются">
                    <input type="checkbox" checked={t.is_byo} aria-label="BYO"
                      onChange={(e) => onPatch(t.id, { is_byo: e.target.checked })}
                      className="h-3 w-3 rounded-sm border-border accent-primary" />
                    BYO
                  </label>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <Cell defaultValue={String(t.price)} type="number" step="any" min="0.01" align="right"
                    ariaLabel="Цена" className="w-16"
                    onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) onPatch(t.id, { price: n }) }} />
                  <CurrencySelect value={t.currency} onChange={(v) => onPatch(t.id, { currency: v })}
                    className="h-7 w-[72px] text-[12px]" />
                </div>
                <Cell defaultValue={String(t.clients)} type="number" min="0" align="right"
                  ariaLabel="Клиенты"
                  onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) onPatch(t.id, { clients: Math.round(n) }) }} />
                {perUnitCosts.map((c) => (
                  <Cell key={c.id} defaultValue={String(t.usage?.[String(c.id)] ?? "")} type="number" min="0" step="any"
                    align="right" ariaLabel={`Юниты: ${c.name}`} placeholder="0"
                    onCommit={(v) => patchUsage(t, c.id, v)} />
                ))}
                <span className={cn("text-right text-[13px] font-semibold tnum", t.net_per_client >= 0 ? "text-pos" : "text-neg")}>
                  {signed(t.net_per_client, cur)}
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
      {!summary.tariffs.length && (
        <p className="px-3 pb-2 text-[12.5px] text-muted-foreground">
          Добавь хотя бы один тариф, чтобы увидеть экономику.
        </p>
      )}
    </div>
  )
}

/* ── costs matrix ─────────────────────────────────────────────── */
function CostsTable({ summary, onPatch, onDelete, onAdd }: {
  summary: ServiceSummary
  onPatch: (id: number, body: Record<string, unknown>) => void
  onDelete: (id: number) => void
  onAdd: () => void
}) {
  const gridCols = "minmax(0,1.3fr) 140px 128px 76px minmax(0,1fr) 32px"
  return (
    <div className="rounded-lg border border-border bg-card">
      <SectionHead title="Расходы сервиса"
        totals={<>COGS <b className="font-semibold text-foreground">{money(summary.cogs_monthly)} {summary.base_currency}</b></>} />
      <div className="overflow-x-auto border-t border-line-2">
        <div className="min-w-full">
          <div className="grid items-center gap-x-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3"
            style={{ gridTemplateColumns: gridCols }}>
            <span>Статья</span><span>Тип</span><span className="text-right">Сумма</span>
            <span className="text-right">за N юн.</span><span>Юнит-лейбл</span><span />
          </div>
          <div className="divide-y divide-line-2">
            {summary.costs.map((c) => {
              const perUnit = c.kind === "per_unit"
              return (
                <div key={c.id} className="group grid items-center gap-x-2 px-3 py-1"
                  style={{ gridTemplateColumns: gridCols }}>
                  <Cell defaultValue={c.name} ariaLabel="Статья"
                    onCommit={(v) => onPatch(c.id, { name: v.trim() || "Расход" })} />
                  <Select value={c.kind} onValueChange={(v) => onPatch(c.id, { kind: v })}>
                    <SelectTrigger className="h-7 w-full text-[12px]" aria-label="Тип"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">{KIND_LABEL.fixed}</SelectItem>
                      <SelectItem value="per_client">{KIND_LABEL.per_client}</SelectItem>
                      <SelectItem value="per_unit">{KIND_LABEL.per_unit}</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center justify-end gap-1">
                    <Cell defaultValue={String(c.amount)} type="number" step="any" min="0.01" align="right"
                      ariaLabel="Сумма" className="w-16"
                      onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) onPatch(c.id, { amount: n }) }} />
                    <CurrencySelect value={c.currency} onChange={(v) => onPatch(c.id, { currency: v })}
                      className="h-7 w-[72px] text-[12px]" />
                  </div>
                  <Cell defaultValue={String(c.unit_size || 1)} type="number" min="1" step="any" align="right"
                    ariaLabel="За N юнитов" className={cn(!perUnit && "pointer-events-none opacity-40")}
                    onCommit={(v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) onPatch(c.id, { unit_size: n }) }} />
                  <Cell defaultValue={c.unit_label ?? ""} ariaLabel="Юнит-лейбл" placeholder="роликов"
                    className={cn(!perUnit && "pointer-events-none opacity-40")}
                    onCommit={(v) => onPatch(c.id, { unit_label: v.trim() || null })} />
                  <IconBtn onClick={() => onDelete(c.id)} label="Удалить расход" danger><TrashIcon /></IconBtn>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <button onClick={onAdd} aria-label="Добавить статью"
        className="m-1.5 inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-primary hover:bg-accent-soft hover:text-primary">
        <PlusIcon /> статья
      </button>
      {!summary.costs.length && (
        <p className="px-3 pb-2 text-[12.5px] text-muted-foreground">
          Пока без расходов — вся выручка идёт в прибыль.
        </p>
      )}
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────── */
export default function Services() {
  const [services, setServices] = useState<ServiceListItem[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [summary, setSummary] = useState<ServiceSummary | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState("")

  const loadList = useCallback(async () => {
    const list = await api.get<ServiceListItem[]>("/services")
    setServices(list)
    setSelected((cur) => (cur !== null && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null))
  }, [])
  useEffect(() => { void loadList() }, [loadList])

  const loadSummary = useCallback(async () => {
    if (selected === null) { setSummary(null); return }
    setSummary(await api.get<ServiceSummary>(`/services/${selected}/summary`))
  }, [selected])
  useEffect(() => { void loadSummary() }, [loadSummary])

  const reloadSummary = () => loadSummary().then(() => refreshCurrencies())

  const addService = async (preset: string | null) => {
    const body = preset ? { name: "", preset } : { name: "Новый сервис" }
    const { id } = await api.post<{ id: number }>("/services", body)
    await loadList()
    setSelected(id)
  }

  const renameService = async () => {
    if (selected === null) return
    const name = renameVal.trim()
    if (!name) { setRenaming(false); return }
    await api.patch(`/services/${selected}`, { name })
    setRenaming(false)
    await loadList()
  }

  const deleteService = async () => {
    if (selected === null) return
    if (!confirm("Удалить сервис вместе с тарифами и расходами?")) return
    await api.delete(`/services/${selected}`)
    setSelected(null)
    await loadList()
  }

  const addTariff = async () => {
    if (selected === null || !summary) return
    await api.post(`/services/${selected}/tariffs`, {
      name: "Тариф", price: 100, currency: summary.base_currency, clients: 0, is_byo: false, usage: {},
    })
    await reloadSummary()
  }
  const patchTariff = async (id: number, body: Record<string, unknown>) => {
    if (selected === null) return
    await api.patch(`/services/${selected}/tariffs/${id}`, body)
    await reloadSummary()
  }
  const delTariff = async (id: number) => {
    if (selected === null) return
    await api.delete(`/services/${selected}/tariffs/${id}`)
    await reloadSummary()
  }

  const addCost = async () => {
    if (selected === null || !summary) return
    await api.post(`/services/${selected}/costs`, {
      name: "Статья", amount: 1, currency: summary.base_currency, kind: "fixed", unit_size: 1, unit_label: null,
    })
    await reloadSummary()
  }
  const patchCost = async (id: number, body: Record<string, unknown>) => {
    if (selected === null) return
    await api.patch(`/services/${selected}/costs/${id}`, body)
    await reloadSummary()
  }
  const delCost = async (id: number) => {
    if (selected === null) return
    await api.delete(`/services/${selected}/costs/${id}`)
    await reloadSummary()
  }

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        Сервисы
      </h1>

      {/* selector row */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
        {services.length > 0 && (
          renaming ? (
            <div className="flex items-center gap-2">
              <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                className="h-8 w-56" autoFocus aria-label="Название сервиса" />
              <Button size="sm" className="h-8" onClick={renameService}>Сохранить</Button>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setRenaming(false)}>Отмена</Button>
            </div>
          ) : (
            <>
              <Select value={selected !== null ? String(selected) : ""}
                onValueChange={(v) => setSelected(Number(v))}>
                <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Сервис" /></SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button onClick={() => { setRenaming(true); setRenameVal(services.find((s) => s.id === selected)?.name ?? "") }}
                aria-label="Переименовать сервис" title="Переименовать"
                className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground">
                <EditIcon />
              </button>
              <button onClick={deleteService} aria-label="Удалить сервис" title="Удалить сервис"
                className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-ink-2 transition-colors hover:border-neg hover:bg-neg-soft hover:text-neg">
                <TrashIcon />
              </button>
            </>
          )
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-8" onClick={() => addService(null)}>+ Пустой</Button>
        <Button variant="outline" size="sm" className="h-8" onClick={() => addService("trendwatcher")}>+ TrendWatcher (пресет)</Button>
      </div>

      {!services.length && (
        <div className="rounded-lg border border-border bg-card px-6 py-10 text-center shadow-sm">
          <p className="text-sm text-ink-2">Пока нет ни одного сервиса.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => addService(null)}>+ Пустой</Button>
            <Button size="sm" onClick={() => addService("trendwatcher")}>+ TrendWatcher (пресет)</Button>
          </div>
        </div>
      )}

      {summary && (
        <>
          {summary.missing_rates.length > 0 && (
            <div className="rounded-lg bg-warn-soft px-3 py-1.5 text-[12.5px] text-warn">
              Нет курса: {summary.missing_rates.join(", ")} — строки посчитаны как 0.
              Добавь курс в Настройках → Курсы валют.
            </div>
          )}

          <SummaryStrip data={summary} />

          <TariffsTable summary={summary} onPatch={patchTariff} onDelete={delTariff} onAdd={addTariff} />
          <CostsTable summary={summary} onPatch={patchCost} onDelete={delCost} onAdd={addCost} />
        </>
      )}
    </div>
  )
}
