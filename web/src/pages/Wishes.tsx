import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useSearchParams } from "react-router-dom"
import { api, type Summary, type WishItem, type Wishes as WishesData } from "@/lib/api"
import { verdictOf, type Verdict } from "@/lib/aggregates"
import { refreshCurrencies } from "@/lib/currencies"
import { fallbackImage } from "@/lib/wishImage"
import { money } from "@/lib/format"
import { BaseAside } from "@/components/BaseAside"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CurrencySelect } from "@/components/CurrencySelect"
import { SectionHelp } from "@/components/SectionHelp"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LayoutGrid, List, Maximize2, Pencil, Plus, Trash2, X } from "lucide-react"

type ImgResp = { ok: boolean; image_url: string | null }

const PRIORITY = [
  { value: "high", label: "высокий" },
  { value: "medium", label: "средний" },
  { value: "low", label: "низкий" },
]
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

// ---- достижимость (общая для списка и доски) ----
// verdictOf вынесена в lib/aggregates и страхует НЕположительный headroom (#25).

// ---- «срок» как набор относительных типов (маппится на target_date) ----
type WhenType = "anytime" | "quarter" | "month"
const WHEN_OPTIONS: { value: WhenType; label: string }[] = [
  { value: "anytime", label: "в любой момент" },
  { value: "quarter", label: "в этом квартале" },
  { value: "month", label: "в этом месяце" },
]

function endOfMonthIso(d = new Date()): string {
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return end.toISOString().slice(0, 10)
}
function endOfQuarterIso(d = new Date()): string {
  const q = Math.floor(d.getMonth() / 3)
  const end = new Date(d.getFullYear(), q * 3 + 3, 0)
  return end.toISOString().slice(0, 10)
}
// какой тип сейчас выбран по target_date
function whenTypeOf(targetDate: string | null): WhenType {
  if (!targetDate) return "anytime"
  if (targetDate === endOfMonthIso()) return "month"
  if (targetDate === endOfQuarterIso()) return "quarter"
  // произвольная дата — отображаем как ближайший по смыслу тип
  const now = new Date().toISOString().slice(0, 10)
  if (targetDate <= endOfMonthIso() && targetDate >= now) return "month"
  if (targetDate <= endOfQuarterIso() && targetDate >= now) return "quarter"
  return "anytime"
}
function whenTypeToDate(t: WhenType): string | null {
  if (t === "month") return endOfMonthIso()
  if (t === "quarter") return endOfQuarterIso()
  return null
}

// ---------------- сетка доски (как brunocis.co), без изменений ----------------
const COL: Record<number, string> = {
  3: "col-span-1 sm:col-span-3",
  4: "col-span-2 sm:col-span-4",
  6: "col-span-2 sm:col-span-6",
  8: "col-span-2 sm:col-span-8",
  12: "col-span-2 sm:col-span-12",
}
const ROW: Record<number, string> = {
  3: "row-span-3", 6: "row-span-6", 7: "row-span-7", 8: "row-span-8",
}
const RHYTHM: { col: number; row: number }[] = [
  { col: 12, row: 8 },
  { col: 6, row: 7 }, { col: 6, row: 7 },
  { col: 8, row: 6 }, { col: 4, row: 6 },
  { col: 4, row: 6 }, { col: 8, row: 6 },
  { col: 6, row: 6 }, { col: 6, row: 6 },
]
function spanOf(w: WishItem, i: number): { col: number; row: number } {
  switch (w.card_size) {
    case "large": return { col: 12, row: 8 }
    case "wide": return { col: 8, row: 6 }
    case "tall": return { col: 4, row: 8 }
    case "square": return { col: 4, row: 6 }
    case "small": return { col: 3, row: 3 }
  }
  if (w.priority === "low") return { col: 3, row: 3 }
  return RHYTHM[i % RHYTHM.length]
}

const SIZE_OPTIONS: { key: string; label: string }[] = [
  { key: "auto", label: "Авто" },
  { key: "small", label: "Квадратик" },
  { key: "square", label: "Треть" },
  { key: "tall", label: "Высокая" },
  { key: "wide", label: "Две трети" },
  { key: "large", label: "Во весь экран" },
]

export default function Wishes() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get("view") === "board" ? "board" : "list"
  const setView = useCallback((v: "list" | "board") => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v === "board") next.set("view", "board")
        else next.delete("view")
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  const [data, setData] = useState<WishesData | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [editing, setEditing] = useState<WishItem | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const [w, s] = await Promise.all([
      api.get<WishesData>("/wishes"),
      api.get<Summary>("/summary"),
    ])
    setData(w); setSummary(s)
  }, [])
  useEffect(() => { void load() }, [load])

  // фуллскрин «кинозал»
  const enterFull = useCallback(() => {
    setFullscreen(true)
    document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])
  const exitFull = useCallback(() => {
    setFullscreen(false)
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !editing) exitFull() }
    const onFsChange = () => { if (!document.fullscreenElement) setFullscreen(false) }
    window.addEventListener("keydown", onKey)
    document.addEventListener("fullscreenchange", onFsChange)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("fullscreenchange", onFsChange)
      document.body.style.overflow = prevOverflow
    }
  }, [fullscreen, editing, exitFull])

  const headroom = (summary?.scenarios.base.min_total ?? 0) - (summary?.cushion ?? 0)
  const cushion = summary?.cushion ?? 0
  const cur = data?.base_currency ?? "USD"

  const sorted = useMemo(() => {
    if (!data) return [] as WishItem[]
    return [...data.items].sort(
      (a, b) =>
        (a.sort_order - b.sort_order) ||
        (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) ||
        (b.amount_base - a.amount_base),
    )
  }, [data])

  const move = useCallback(async (id: number, dir: "up" | "down") => {
    const ids = sorted.map((w) => w.id)
    const k = ids.indexOf(id)
    const j = dir === "up" ? k - 1 : k + 1
    if (k < 0 || j < 0 || j >= ids.length) return
    ;[ids[k], ids[j]] = [ids[j], ids[k]]
    await api.post("/wishes/reorder", { ids })
    await load()
  }, [sorted, load])

  const affordableCount = useMemo(
    () => (data?.items ?? []).filter((w) => w.amount_base <= headroom).length,
    [data, headroom],
  )

  if (!data || !summary) {
    return <div className="py-24 text-center text-sm text-muted-foreground">Загрузка…</div>
  }

  const empty = data.items.length === 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHelp route="/wishes" title="Мечты">
          То, ради чего стоит держать запас хода. Один список — два вида: «Список» по полочкам
          и «Доска» как карта вдохновения с картинками. В прогноз не входит, пока не нажмёте «В расходы».
        </SectionHelp>
        <Button onClick={() => setAdding(true)} className="shrink-0">
          <Plus className="size-4" /> Добавить желание
        </Button>
      </div>

      {/* ---- статы с тултипами ---- */}
      <section className="grid grid-cols-2 overflow-visible rounded-lg border border-border bg-card shadow-sm sm:grid-cols-4">
        <StatCell
          label="Желаний" value={String(data.items.length)} sub="в списке"
          tip="Сколько желаний сейчас в вашем списке — в обоих видах это один список."
        />
        <StatCell
          label="Суммарно" value={`${money(data.total)} ${cur}`} sub="стоимость всего списка"
          tip={`Сумма всех желаний, приведённая к базовой валюте (${cur}).`}
        />
        <StatCell
          label="Уже по карману" value={`${affordableCount} из ${data.items.length}`}
          sub="можно позволить сейчас" accent
          tip={
            <div className="space-y-1">
              <p className="font-medium text-foreground">Что уже влезает в бюджет</p>
              <p>Желания дешевле свободных денег над подушкой ({money(Math.max(0, headroom))} {cur}).</p>
            </div>
          }
        />
        <StatCell
          label="Свободно потратить" value={`${money(Math.max(0, headroom))} ${cur}`}
          sub="без вреда для прогноза"
          tip={
            <div className="space-y-1">
              <p className="font-medium text-foreground">Сколько можно потратить</p>
              <p>Не пробивая подушку безопасности. По базовому сценарию:</p>
              <p className="tabular-nums">
                минимум на счетах {money(summary.scenarios.base.min_total)} − подушка {money(cushion)}
              </p>
              <p className="font-medium tabular-nums">= {money(Math.max(0, headroom))} {cur}</p>
            </div>
          }
        />
      </section>

      {/* ---- сколько денег нужно по приоритетам (by_priority) ---- */}
      <PriorityBreakdown byPriority={data.by_priority} total={data.total} cur={cur} />

      {/* ---- тулбар вида ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold tracking-tight">
          {view === "board" ? "Доска желаний" : "Список желаний"}
          <span className="ml-2 text-sm font-medium text-ink-3">
            {view === "board" ? "— доска вдохновения" : "— по полочкам"}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {view === "board" && !empty && (
            <Button variant="outline" size="sm" onClick={enterFull} title="Открыть кинозал">
              <Maximize2 className="size-4" /> Кинозал
            </Button>
          )}
          <div className="flex gap-1 rounded-[9px] border border-border bg-card-2 p-[3px]">
            <SegButton on={view === "board"} onClick={() => setView("board")}>
              <LayoutGrid className="size-[15px]" /> Доска
            </SegButton>
            <SegButton on={view === "list"} onClick={() => setView("list")}>
              <List className="size-[15px]" /> Список
            </SegButton>
          </div>
        </div>
      </div>

      {/* ===================== СПИСОК ===================== */}
      {view === "list" && (
        empty ? (
          <div className="rounded-lg border border-border bg-bg-soft px-8 py-16 text-center text-sm text-muted-foreground">
            Пока пусто — добавьте то, что хотели бы купить.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-2 shadow-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_130px_170px_120px] items-center gap-4 px-4 pb-2 pt-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">
              <span>Желание</span>
              <span>Стоимость</span>
              <span className="hidden sm:block">Срок</span>
              <span>Приоритет</span>
            </div>
            <div>
              {sorted.map((w) => (
                <ListRow
                  key={w.id} w={w} cur={cur}
                  verdict={verdictOf(w.amount_base, headroom, cushion)}
                  onWhen={async (t) => {
                    await api.patch(`/wishes/${w.id}`, { target_date: whenTypeToDate(t) })
                    await load()
                  }}
                  onEdit={() => setEditing(w)}
                  onDelete={() => api.delete(`/wishes/${w.id}`).then(load)}
                />
              ))}
            </div>
          </div>
        )
      )}

      {/* ===================== ДОСКА ===================== */}
      {view === "board" && (
        <div className="board-scope relative isolate -mx-4 overflow-clip rounded-lg sm:-mx-6 lg:-mx-9">
          <div className="relative z-10 px-3 py-6 sm:px-4">
            {empty ? (
              <div className="mx-auto max-w-2xl rounded-3xl border bg-muted/40 px-8 py-16 text-center">
                <div className="board-display text-2xl">Доска пока пустая</div>
                <p className="mt-3 text-sm board-muted">
                  Добавьте желания — и они оживут здесь картинками.
                </p>
              </div>
            ) : (
              <Gallery
                items={sorted} cur={cur}
                headroom={headroom} cushion={cushion} onEdit={setEditing} onMove={move}
              />
            )}
          </div>
        </div>
      )}

      {/* полноэкранный «кинозал» */}
      {fullscreen && createPortal(
        <div className="board-fs isolate fixed inset-0 z-[60] flex flex-col overflow-hidden">
          <div className="board-aura" aria-hidden />
          <div
            className="relative z-10 flex items-center justify-between gap-4 border-b px-4 py-2.5 sm:px-6"
            style={{ borderColor: "var(--board-line)" }}
          >
            <div className="flex min-w-0 items-baseline gap-4">
              <span className="board-display text-lg">Доска желаний</span>
              <span className="hidden truncate text-xs board-muted sm:inline">
                {data.items.length} {data.items.length === 1 ? "мечта" : "мечты"} · {affordableCount} по карману · {money(data.total)} {cur}
              </span>
            </div>
            <button
              onClick={exitFull}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-foreground hover:text-background"
              style={{ borderColor: "var(--board-line)" }}
            >
              Свернуть <kbd className="rounded bg-black/5 px-1.5 py-0.5 text-[0.65rem] font-sans">Esc</kbd>
            </button>
          </div>
          <div className="relative z-10 flex-1 overflow-y-auto p-2.5 sm:p-3">
            <Gallery
              items={sorted} cur={cur}
              headroom={headroom} cushion={cushion} onEdit={setEditing} onMove={move}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* добавление желания */}
      {adding && (
        <WishForm
          cur={cur}
          onClose={() => setAdding(false)}
          onSaved={async () => { await load(); await refreshCurrencies() }}
        />
      )}

      {/* редактор карточки (картинка + формат + порядок) */}
      {editing && (
        <CardEditor
          wish={editing}
          canUp={sorted.findIndex((w) => w.id === editing.id) > 0}
          canDown={sorted.findIndex((w) => w.id === editing.id) < sorted.length - 1}
          onMove={(dir) => move(editing.id, dir)}
          onClose={() => setEditing(null)} onChanged={load}
        />
      )}
    </div>
  )
}

// --------------------------- разбивка по приоритетам ---------------------------
const PRIO_META: { key: string; label: string; bar: string }[] = [
  { key: "high", label: "Высокий приоритет", bar: "bg-pos" },
  { key: "medium", label: "Средний приоритет", bar: "bg-warn" },
  { key: "low", label: "Низкий приоритет", bar: "bg-ink-3" },
]
function PriorityBreakdown({ byPriority, total, cur }: {
  byPriority: Record<string, number>; total: number; cur: string
}) {
  const rows = PRIO_META.map((m) => ({ ...m, v: byPriority[m.key] ?? 0 })).filter((r) => r.v > 0)
  if (rows.length === 0) return null
  const mx = Math.max(1, ...rows.map((r) => r.v))
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[14.5px] font-semibold tracking-tight">Сколько денег нужно</h3>
        <span className="text-[12.5px] text-ink-3 tabular-nums">{money(total)} {cur} на всё</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-3">
            <span className="truncate text-[13px] text-ink-2">{r.label}</span>
            <span className="h-2 overflow-hidden rounded-[5px] bg-card-2">
              <i className={`block h-full rounded-[5px] ${r.bar}`} style={{ width: `${(r.v / mx * 100).toFixed(0)}%` }} />
            </span>
            <span className="min-w-[64px] whitespace-nowrap text-right text-[13.5px] font-semibold tabular-nums">{money(r.v)} {cur}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// --------------------------- стат-ячейка ---------------------------
function StatCell({ label, value, sub, tip, accent }: {
  label: string; value: string; sub: string
  tip: React.ReactNode; accent?: boolean
}) {
  return (
    <div className="border-l border-line-2 px-5 py-4 first:border-l-0 [&:nth-child(3)]:border-t [&:nth-child(3)]:border-line-2 sm:[&:nth-child(3)]:border-t-0 [&:nth-child(4)]:border-t [&:nth-child(4)]:border-line-2 sm:[&:nth-child(4)]:border-t-0 sm:[&:nth-child(odd)]:border-l">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
            {label}
            <span className="grid size-[15px] place-items-center rounded-full border border-border text-[10px] font-bold text-ink-3">?</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tip}</TooltipContent>
      </Tooltip>
      <div className={`mt-1.5 text-2xl font-semibold leading-none tabular-nums tracking-tight ${accent ? "text-pos" : ""}`}>
        {value}
      </div>
      <div className="mt-1 text-[11.5px] text-ink-3">{sub}</div>
    </div>
  )
}

// --------------------------- сегмент-кнопка ---------------------------
function SegButton({ on, onClick, children }: {
  on: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
        on ? "bg-card text-foreground shadow-sm" : "text-ink-3 hover:text-ink-2"
      }`}
    >
      {children}
    </button>
  )
}

const GEM: Record<Verdict["key"], string> = {
  ok: "gem-ok", tight: "gem-tight", far: "gem-far",
}

// --------------------------- строка списка ---------------------------
function ListRow({ w, cur, verdict, onWhen, onEdit, onDelete }: {
  w: WishItem; cur: string; verdict: Verdict
  onWhen: (t: WhenType) => void
  onEdit: () => void; onDelete: () => void
}) {
  const when = whenTypeOf(w.target_date)
  const src = w.image_url || fallbackImage(w.category, w.name)
  return (
    <div className="group relative mx-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] px-4 py-3 transition-colors hover:bg-card-2 sm:grid-cols-[minmax(0,1fr)_130px_170px_120px] [&+&]:shadow-[inset_0_1px_0_var(--line-2)]">
      <div className="flex min-w-0 items-center gap-3">
        {src ? (
          <img src={src} alt="" className="size-10 shrink-0 border border-border object-cover" />
        ) : (
          <span className="size-10 shrink-0 border border-border bg-card-2" />
        )}
        <span className={`size-[9px] shrink-0 rounded-full ${GEM[verdict.key]}`} title={verdict.label} />
        <span className="truncate text-[14.5px] font-semibold tracking-tight">{w.name}</span>
      </div>
      <div className="min-w-0 whitespace-nowrap">
        <span className="block text-[15px] font-semibold tabular-nums">{money(w.amount)} {w.currency}</span>
        {w.currency !== cur && <BaseAside cur={cur} value={w.amount_base} />}
      </div>
      <div className="hidden min-w-0 sm:block">
        <Select value={when} onValueChange={(v) => onWhen(v as WhenType)}>
          <SelectTrigger size="sm" className="h-8 w-full text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WHEN_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <span className="text-[13px] text-ink-2">{PRIORITY.find((p) => p.value === w.priority)?.label}</span>

      <div className="col-span-full flex items-center justify-end gap-1 border-t border-line-2 pt-3 opacity-100 transition-opacity sm:pointer-events-none sm:absolute sm:right-3 sm:top-1/2 sm:col-span-auto sm:-translate-y-1/2 sm:border-t-0 sm:bg-gradient-to-l sm:from-card-2 sm:from-70% sm:to-transparent sm:pl-8 sm:pt-0 sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100">
        <button
          onClick={onEdit} aria-label="Редактировать картинку и формат желания" title="Картинка и формат"
          className="grid size-8 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground"
        ><Pencil className="size-[15px]" /></button>
        <button
          onClick={onDelete} aria-label="Удалить желание" title="Удалить"
          className="grid size-8 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-neg hover:bg-neg-soft hover:text-neg"
        ><Trash2 className="size-[15px]" /></button>
      </div>
    </div>
  )
}

// --------------------------- доска (галерея) ---------------------------
function Gallery({ items, cur, headroom, cushion, onEdit, onMove }: {
  items: WishItem[]; cur: string; headroom: number; cushion: number
  onEdit: (w: WishItem) => void
  onMove: (id: number, dir: "up" | "down") => void
}) {
  return (
    <div className="grid auto-rows-[clamp(78px,11vh,150px)] grid-cols-2 gap-2.5 [grid-auto-flow:dense] sm:grid-cols-12 sm:gap-3">
      {items.map((w, i) => {
        const s = spanOf(w, i)
        return (
          <WishCard
            key={w.id} w={w} cur={cur} index={i} total={items.length}
            big={s.col >= 8 || s.row >= 7} tiny={s.row <= 3}
            colCls={COL[s.col]} rowCls={ROW[s.row]}
            verdict={verdictOf(w.amount_base, headroom, cushion)}
            onEdit={() => onEdit(w)}
            onMove={(dir) => onMove(w.id, dir)}
          />
        )
      })}
    </div>
  )
}

// --------------------------- плитка доски ---------------------------
function WishCard({
  w, cur, index, total, big, tiny, verdict, colCls, rowCls, onEdit, onMove,
}: {
  w: WishItem; cur: string; index: number; total: number; big: boolean; tiny: boolean
  verdict: Verdict; colCls: string; rowCls: string; onEdit: () => void
  onMove: (dir: "up" | "down") => void
}) {
  const src = w.image_url || fallbackImage(w.category, w.name)
  return (
    <article
      className={`group board-rise flex flex-col ${colCls} ${rowCls} [content-visibility:auto] [contain-intrinsic-size:auto_360px]`}
      style={{ animationDelay: `${Math.min(index, 10) * 0.035}s` }}
    >
      <div className={`wish-card v-${verdict.key} relative flex-1 overflow-hidden`}>
        {src ? (
          <img
            src={src} alt={w.name} loading="lazy" decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-[700ms] ease-out group-hover:scale-[1.045]"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                `radial-gradient(120% 90% at 20% 10%, oklch(0.6 0.19 ${(w.id * 47) % 360} / 0.95), transparent 60%),` +
                `radial-gradient(120% 90% at 90% 90%, oklch(0.62 0.17 ${(w.id * 83 + 120) % 360} / 0.9), transparent 60%),` +
                `oklch(0.26 0.06 275)`,
            }}
          />
        )}

        <div className="absolute right-2.5 top-2.5 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
          <button
            onClick={onEdit} aria-label="Редактировать картинку и формат карточки" title="Картинка и формат карточки"
            className="grid h-8 w-8 place-items-center rounded-full board-glass text-sm text-white hover:bg-white/20"
          ><Pencil className="size-[15px]" /></button>
        </div>

        <div className="absolute left-2.5 top-2.5 flex gap-1 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
          <button
            onClick={() => onMove("up")} disabled={index === 0} aria-label="Поднять желание выше" title="Поднять выше"
            className="grid h-8 w-8 place-items-center rounded-full board-glass text-sm text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
          >↑</button>
          <button
            onClick={() => onMove("down")} disabled={index === total - 1} aria-label="Опустить желание ниже" title="Опустить ниже"
            className="grid h-8 w-8 place-items-center rounded-full board-glass text-sm text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
          >↓</button>
        </div>
      </div>

      <div className={`flex items-baseline gap-2 px-0.5 ${tiny ? "mt-1.5 text-xs" : big ? "mt-2 text-base sm:text-lg" : "mt-2 text-sm"}`}>
        <span className={`h-2 w-2 shrink-0 self-center rounded-full ${GEM[verdict.key]}`} title={verdict.label} />
        <h3 className="board-display min-w-0 truncate" style={{ fontWeight: 600 }}>{w.name}</h3>
        <span className="board-muted ml-auto shrink-0 text-right font-medium tabular-nums">
          <span className="block">{money(w.amount)} {w.currency}</span>
          {w.currency !== cur && (
            <span className="block text-[0.78em] opacity-70">≈ {money(w.amount_base)} {cur}</span>
          )}
        </span>
      </div>
    </article>
  )
}

// --------------------------- добавление желания ---------------------------
function WishForm({ cur, onClose, onSaved }: {
  cur: string
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState(cur)
  const [priority, setPriority] = useState("medium")
  const [when, setWhen] = useState<WhenType>("anytime")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || amount === "") return
    setBusy(true)
    try {
      await api.post("/wishes", {
        name: name.trim(),
        amount: Number(amount),
        currency,
        priority,
        target_date: whenTypeToDate(when),
        category: null,
      })
      await onSaved()
      onClose()
    } finally { setBusy(false) }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <form
        onSubmit={save} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-background shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-[30px] place-items-center rounded-lg bg-accent-soft text-primary">
              <Plus className="size-4" />
            </span>
            <h4 className="text-base font-semibold tracking-tight">Новое желание</h4>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted" aria-label="Закрыть">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Например, MacBook Pro 16″" autoFocus required />
          </Field>
          <div className="grid grid-cols-[1fr_130px] gap-3">
            <Field label="Стоимость">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)}
                type="number" step="any" min="0.01" placeholder="0" required className="tabular-nums" />
            </Field>
            <Field label="Валюта">
              <CurrencySelect value={currency} onChange={setCurrency} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Срок">
              <Select value={when} onValueChange={(v) => setWhen(v as WhenType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WHEN_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Приоритет">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Картинку добавите на карточке через ✎ после создания.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
          <div className="flex-1" />
          <Button type="submit" disabled={busy || !name.trim() || amount === ""}>
            {busy ? "…" : "Сохранить"}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">{label}</label>
      {children}
    </div>
  )
}

// --------------------------- редактор карточки (картинка / формат / порядок) ---------------------------
function CardEditor({ wish, canUp, canDown, onMove, onClose, onChanged }: {
  wish: WishItem; canUp: boolean; canDown: boolean
  onMove: (dir: "up" | "down") => Promise<void> | void
  onClose: () => void; onChanged: () => Promise<void> | void
}) {
  const [url, setUrl] = useState("")
  const [size, setSize] = useState(wish.card_size || "auto")
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function setByUrl() {
    const u = url.trim()
    if (!u) return
    setBusy("url")
    try {
      const r = await api.post<ImgResp>(`/wishes/${wish.id}/image/url`, { url: u })
      if (r.ok) { await onChanged(); onClose() }
      else alert("Не удалось скачать картинку по этой ссылке.")
    } catch { alert("Ошибка при загрузке по ссылке.") } finally { setBusy(null) }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy("upload")
    try {
      const form = new FormData()
      form.append("file", f)
      const r = await api.upload<ImgResp>(`/wishes/${wish.id}/image/upload`, form)
      if (r.ok) { await onChanged(); onClose() }
      else alert("Не удалось загрузить файл.")
    } catch { alert("Ошибка загрузки файла.") } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function chooseSize(key: string) {
    setSize(key)
    setBusy("size")
    try { await api.patch(`/wishes/${wish.id}`, { card_size: key }); await onChanged() }
    finally { setBusy(null) }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-background shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">карточка мечты</div>
            <div className="truncate font-medium">{wish.name}</div>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted" aria-label="Закрыть">✕</button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Картинка</div>
          <div className="flex gap-2">
            <input
              value={url} onChange={(e) => setUrl(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void setByUrl() }}
              placeholder="Вставь ссылку на картинку (https://…)"
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <Button onClick={setByUrl} disabled={!url.trim() || !!busy}>{busy === "url" ? "…" : "Поставить"}</Button>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
            <Button variant="outline" size="sm" disabled={!!busy} onClick={() => fileRef.current?.click()}>
              {busy === "upload" ? "Загружаю…" : "Загрузить файл"}
            </Button>
            <span className="text-xs text-muted-foreground">картинка скачается и сохранится на сервере</span>
          </div>
        </div>

        <div className="space-y-2 border-t px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Формат карточки</div>
          <div className="flex flex-wrap gap-1.5">
            {SIZE_OPTIONS.map((o) => (
              <button
                key={o.key} onClick={() => chooseSize(o.key)} disabled={!!busy}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                  size === o.key ? "border-foreground bg-foreground text-background" : "hover:bg-muted"
                }`}
              >{o.label}</button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Формат задаёт пропорцию кадра на доске.</p>
        </div>

        <div className="space-y-2 border-t px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Порядок на доске</div>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={!canUp || !!busy} onClick={() => onMove("up")}>
              ↑ Поднять
            </Button>
            <Button variant="outline" size="sm" disabled={!canDown || !!busy} onClick={() => onMove("down")}>
              ↓ Опустить
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Можно и прямо на доске — наведи на карточку.</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
