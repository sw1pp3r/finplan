import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useSearchParams } from "react-router-dom"
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from "radix-ui"
import { api, type Summary, type WishItem, type Wishes as WishesData } from "@/lib/api"
import { verdictOf, type Verdict } from "@/lib/aggregates"
import { refreshCurrencies } from "@/lib/currencies"
import { fallbackImage } from "@/lib/wishImage"
import { reportActionError } from "@/lib/actionFeedback"
import { money } from "@/lib/format"
import { BaseAside } from "@/components/BaseAside"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useReturnFocus } from "@/components/ui/use-return-focus"
import { CurrencySelect } from "@/components/CurrencySelect"
import { SectionHelp } from "@/components/SectionHelp"
import { PageSkeleton } from "@/components/PageSkeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Check, CheckCircle2, LayoutGrid, List, LoaderCircle, Maximize2, Pencil, Plus, RotateCcw, Sparkles, Trash2, X,
} from "lucide-react"

type ImgResp = {
  ok: boolean
  image_url: string | null
  image_source?: string | null
  reason?: "no_results" | "download_failed" | null
}
type WishView = "list" | "board" | "completed"
type WishNotice = {
  message: string
  target: "list" | "completed"
  action: string
}
type WishCelebration = {
  id: number
  name: string
}

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
  3: "row-span-2 sm:row-span-3",
  6: "row-span-3 sm:row-span-6",
  7: "row-span-3 sm:row-span-7",
  8: "row-span-4 sm:row-span-8",
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
  const requestedView = searchParams.get("view")
  const view: WishView = requestedView === "board"
    ? "board"
    : requestedView === "completed"
      ? "completed"
      : "list"
  const setView = useCallback((v: WishView) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v === "list") next.delete("view")
        else next.set("view", v)
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
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [showAllList, setShowAllList] = useState(false)
  const [busyWishId, setBusyWishId] = useState<number | null>(null)
  const [completionNotice, setCompletionNotice] = useState<WishNotice | null>(null)
  const [pendingCompletion, setPendingCompletion] = useState<WishItem | null>(null)
  const [celebration, setCelebration] = useState<WishCelebration | null>(null)
  const cinemaDialogRef = useRef<HTMLDivElement>(null)
  const cinemaCloseRef = useRef<HTMLButtonElement>(null)
  const cinemaTriggerRef = useRef<HTMLElement | null>(null)
  const completionTriggerRef = useRef<HTMLElement | null>(null)
  const celebrationStartTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (completionNotice?.target === view) setCompletionNotice(null)
  }, [view, completionNotice])
  useEffect(() => {
    if (!celebration) return
    const timer = window.setTimeout(() => setCelebration(null), 1800)
    return () => window.clearTimeout(timer)
  }, [celebration])
  useEffect(() => () => {
    if (celebrationStartTimerRef.current !== null) {
      window.clearTimeout(celebrationStartTimerRef.current)
    }
  }, [])

  const load = useCallback(async () => {
    const [w, s] = await Promise.all([
      api.get<WishesData>("/wishes"),
      api.get<Summary>("/summary"),
    ])
    setData(w); setSummary(s)
  }, [])
  useEffect(() => { void load() }, [load])

  // фуллскрин «кинозал»
  const enterFull = useCallback((trigger?: HTMLElement) => {
    if (trigger) cinemaTriggerRef.current = trigger
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
    const appRoot = document.getElementById("root")
    const previousInert = appRoot?.inert ?? false
    document.body.style.overflow = "hidden"
    if (appRoot) appRoot.inert = true
    requestAnimationFrame(() => cinemaCloseRef.current?.focus())
    return () => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("fullscreenchange", onFsChange)
      document.body.style.overflow = prevOverflow
      if (appRoot) appRoot.inert = previousInert
      requestAnimationFrame(() => cinemaTriggerRef.current?.focus())
    }
  }, [fullscreen, editing, exitFull])

  const trapCinemaFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return
    const focusable = cinemaDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

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

  const completeWish = useCallback((wish: WishItem) => {
    if (document.activeElement instanceof HTMLElement) {
      completionTriggerRef.current = document.activeElement
    }
    setPendingCompletion(wish)
  }, [])

  const confirmCompletion = useCallback(async () => {
    const wish = pendingCompletion
    if (!wish) return
    setBusyWishId(wish.id)
    try {
      await api.post(`/wishes/${wish.id}/complete`, {})
      await load()
      setPendingCompletion(null)
      if (celebrationStartTimerRef.current !== null) {
        window.clearTimeout(celebrationStartTimerRef.current)
      }
      celebrationStartTimerRef.current = window.setTimeout(() => {
        setCelebration({ id: Date.now(), name: wish.name })
        celebrationStartTimerRef.current = null
      }, 170)
      setCompletionNotice({
        message: `Покупка «${wish.name}» сохранена в истории`,
        target: "completed",
        action: "Открыть историю",
      })
    } catch {
      // api показывает единое сообщение об ошибке; диалог остаётся открыт для повторной попытки
    } finally {
      setBusyWishId(null)
    }
  }, [load, pendingCompletion])

  const restoreWish = useCallback(async (wish: WishItem) => {
    setBusyWishId(wish.id)
    try {
      await api.post(`/wishes/${wish.id}/restore`, {})
      await load()
      setCompletionNotice({
        message: `Покупка «${wish.name}» возвращена в активный список`,
        target: "list",
        action: "Открыть список",
      })
    } finally {
      setBusyWishId(null)
    }
  }, [load])

  if (!data || !summary) {
    return <PageSkeleton label="Загружаю покупки" />
  }

  const empty = data.items.length === 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHelp route="/wishes" title="Покупки" defaultOpen={false}>
          Планируемые покупки не участвуют в прогнозе. В списке удобно менять параметры,
          на доске — сравнивать покупки визуально. Купленные позиции сохраняются в отдельной истории.
        </SectionHelp>
        <Button onClick={() => setAdding(true)} className="min-h-11 shrink-0 sm:min-h-9">
          <Plus className="size-4" /> Добавить покупку
        </Button>
      </div>

      {view !== "completed" && (
        <>
          {/* ---- одна продуктовая сводка вместо панели из четырёх KPI ---- */}
          <section className="grid gap-4 rounded-lg border border-border bg-card px-5 py-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">Можно позволить сейчас</p>
              <p className="mt-1 text-xl font-semibold tracking-tight">
                <span className="text-pos">{affordableCount} из {data.items.length}</span> покупок уже по карману
              </p>
              <p className="mt-1 text-sm text-ink-3">без просадки ниже подушки безопасности</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-line-2 pt-3 text-sm sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
              <span className="text-ink-3">Свободно</span>
              <strong className="text-right tabular-nums">{money(Math.max(0, headroom))} {cur}</strong>
              <span className="text-ink-3">Весь список</span>
              <strong className="text-right tabular-nums">{money(data.total)} {cur}</strong>
            </div>
          </section>

          {/* ---- сколько денег нужно по приоритетам (by_priority) ---- */}
          <PriorityBreakdown
            byPriority={data.by_priority}
            total={data.total}
            cur={cur}
            open={showBreakdown}
            onToggle={() => setShowBreakdown((value) => !value)}
          />
        </>
      )}

      {completionNotice && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-pos-soft px-4 py-3 text-sm text-pos"
        >
          <CheckCircle2 className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 font-medium">{completionNotice.message}</span>
          <button
            type="button"
            onClick={() => setView(completionNotice.target)}
            className="min-h-8 shrink-0 rounded-md px-2.5 font-semibold underline-offset-4 hover:underline"
          >
            {completionNotice.action}
          </button>
        </div>
      )}

      {/* ---- тулбар вида ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">
          {view === "board"
            ? "Доска покупок"
            : view === "completed"
              ? "История покупок"
              : "Список покупок"}
          <span aria-hidden className="ml-2 text-sm font-medium text-ink-3">
            {view === "board"
              ? "— визуально"
              : view === "completed"
                ? "— уже куплено"
                : "— по приоритетам"}
          </span>
        </h2>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          {view === "board" && !empty && (
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={(e) => enterFull(e.currentTarget)} title="Открыть кинозал">
              <Maximize2 className="size-4" /> Кинозал
            </Button>
          )}
          <div className="grid w-full grid-cols-3 gap-1 rounded-[9px] border border-border bg-card-2 p-[3px] sm:flex sm:w-auto">
            <SegButton on={view === "board"} onClick={() => setView("board")}>
              <LayoutGrid className="size-[15px]" /> Доска
            </SegButton>
            <SegButton on={view === "list"} onClick={() => setView("list")}>
              <List className="size-[15px]" /> Список
            </SegButton>
            <SegButton
              on={view === "completed"}
              onClick={() => setView("completed")}
              ariaLabel={`Куплено, ${data.completed_items.length}`}
            >
              <CheckCircle2 className="size-[15px]" />
              Куплено
              {data.completed_items.length > 0 && (
                <span aria-hidden className="tabular-nums text-[11px] opacity-70">
                  {data.completed_items.length}
                </span>
              )}
            </SegButton>
          </div>
        </div>
      </div>

      {/* ===================== СПИСОК ===================== */}
      {view === "list" && (
        empty ? (
          <div className="rounded-lg border border-border bg-bg-soft px-8 py-16 text-center text-sm text-muted-foreground">
            <p>В активном списке пока пусто — добавьте первую покупку.</p>
            {data.completed_items.length > 0 && (
              <Button variant="outline" className="mt-4 min-h-11" onClick={() => setView("completed")}>
                Открыть историю покупок
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-2 shadow-sm">
            <div className="hidden grid-cols-[minmax(0,1fr)_130px_170px_120px] items-center gap-4 px-4 pb-2 pt-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-3 sm:grid">
              <span>Покупка</span>
              <span>Стоимость</span>
              <span className="hidden sm:block">Срок</span>
              <span>Приоритет</span>
            </div>
            <div>
              {(showAllList ? sorted : sorted.slice(0, 8)).map((w) => (
                <ListRow
                  key={w.id} w={w} cur={cur}
                  verdict={verdictOf(w.amount_base, headroom, cushion)}
                  onWhen={async (t) => {
                    await api.patch(`/wishes/${w.id}`, { target_date: whenTypeToDate(t) })
                    await load()
                  }}
                  onEdit={() => setEditing(w)}
                  onDelete={() => api.delete(`/wishes/${w.id}`).then(load)}
                  onComplete={() => completeWish(w)}
                  busy={busyWishId === w.id}
                />
              ))}
            </div>
            {sorted.length > 8 && (
              <div className="border-t border-line-2 p-2">
                <Button
                  variant="ghost"
                  className="min-h-11 w-full sm:min-h-9"
                  onClick={() => setShowAllList((value) => !value)}
                  aria-expanded={showAllList}
                >
                  {showAllList ? "Показать меньше" : `Показать ещё ${sorted.length - 8}`}
                </Button>
              </div>
            )}
          </div>
        )
      )}

      {/* ===================== ДОСКА ===================== */}
      {view === "board" && (
        <div className="board-scope relative isolate -mx-4 overflow-clip rounded-lg sm:-mx-6 lg:-mx-9">
          <div className="relative z-10 px-3 py-6 sm:px-4">
            {empty ? (
              <div className="mx-auto max-w-2xl rounded-3xl border bg-muted/40 px-8 py-16 text-center">
                <div className="board-display text-2xl">Доска покупок пока пустая</div>
                <p className="mt-3 text-sm board-muted">
                  Добавьте покупки — и они появятся здесь с картинками.
                </p>
              </div>
            ) : (
                <Gallery
                  items={sorted} cur={cur}
                  headroom={headroom} cushion={cushion} onEdit={setEditing} onMove={move}
                  onComplete={completeWish} busyWishId={busyWishId}
                />
            )}
          </div>
        </div>
      )}

      {view === "completed" && (
        <CompletedArchive
          items={data.completed_items}
          cur={cur}
          busyWishId={busyWishId}
          onRestore={restoreWish}
        />
      )}

      {/* полноэкранный «кинозал» */}
      {fullscreen && createPortal(
        <div ref={cinemaDialogRef} role="dialog" aria-modal="true" aria-labelledby="wish-cinema-title"
          onKeyDown={trapCinemaFocus} className="board-fs isolate fixed inset-0 z-[60] flex flex-col overflow-hidden">
          <div className="board-aura" aria-hidden />
          <div
            className="relative z-10 flex items-center justify-between gap-4 border-b px-4 py-2.5 sm:px-6"
            style={{ borderColor: "var(--board-line)" }}
          >
            <div className="flex min-w-0 items-baseline gap-4">
              <span id="wish-cinema-title" className="board-display text-lg">Доска покупок</span>
              <span className="hidden truncate text-xs board-muted sm:inline">
                Всего: {data.items.length} · {affordableCount} по карману · {money(data.total)} {cur}
              </span>
            </div>
            <button
              ref={cinemaCloseRef}
              onClick={exitFull}
              aria-label="Закрыть кинозал"
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm text-white/90 transition-colors hover:bg-white hover:text-zinc-950"
              style={{ borderColor: "var(--board-line)" }}
            >
              Свернуть <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[0.65rem] font-sans">Esc</kbd>
            </button>
          </div>
          <div className="relative z-10 flex-1 overflow-y-auto p-2.5 sm:p-3">
            <Gallery
              items={sorted} cur={cur}
              headroom={headroom} cushion={cushion}
              onEdit={(wish) => { exitFull(); setEditing(wish) }} onMove={move}
              onComplete={completeWish} busyWishId={busyWishId}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* добавление покупки */}
      {adding && (
        <WishForm
          cur={cur}
          onClose={() => setAdding(false)}
          onSaved={async () => { await load(); await refreshCurrencies() }}
        />
      )}

      {/* полный редактор покупки */}
      {editing && (
        <CardEditor
          wish={editing}
          canUp={sorted.findIndex((w) => w.id === editing.id) > 0}
          canDown={sorted.findIndex((w) => w.id === editing.id) < sorted.length - 1}
          onMove={(dir) => move(editing.id, dir)}
          onClose={() => setEditing(null)} onChanged={load}
        />
      )}

      <CompletionDialog
        wish={pendingCompletion}
        busy={pendingCompletion ? busyWishId === pendingCompletion.id : false}
        onClose={() => setPendingCompletion(null)}
        onConfirm={confirmCompletion}
        returnFocusRef={completionTriggerRef}
      />

      {celebration && (
        <WishCelebrationEffect key={celebration.id} name={celebration.name} />
      )}
    </div>
  )
}

// --------------------------- подтверждение покупки ---------------------------
function CompletionDialog({ wish, busy, onClose, onConfirm, returnFocusRef }: {
  wish: WishItem | null
  busy: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  returnFocusRef: React.RefObject<HTMLElement | null>
}) {
  return (
    <AlertDialogPrimitive.Root
      open={Boolean(wish)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="wish-completion-overlay fixed inset-0 z-[80] bg-zinc-950/50 backdrop-blur-[2px]" />
        <AlertDialogPrimitive.Content
          aria-modal="true"
          onCloseAutoFocus={(event) => {
            if (returnFocusRef.current?.isConnected) {
              event.preventDefault()
              returnFocusRef.current.focus()
            }
          }}
          className="wish-completion-dialog fixed left-1/2 top-1/2 z-[81] w-[calc(100%-2rem)] max-w-[420px] overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="px-6 pb-5 pt-6">
            <span className="grid size-11 place-items-center rounded-xl bg-pos-soft text-pos">
              <CheckCircle2 className="size-5" strokeWidth={2.2} />
            </span>
            <AlertDialogPrimitive.Title className="mt-4 text-xl font-semibold tracking-[-0.02em]">
              Отметить как купленную?
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description asChild>
              <div className="mt-2 text-sm leading-6 text-ink-3">
                <p>
                  «<strong className="font-semibold text-foreground">{wish?.name}</strong>» переместится
                  в историю покупок.
                </p>
                <p className="mt-3 flex items-center gap-2 text-xs">
                  <RotateCcw className="size-3.5 shrink-0" />
                  При необходимости покупку можно вернуть в активный список.
                </p>
              </div>
            </AlertDialogPrimitive.Description>
          </div>
          <div className="grid grid-cols-2 gap-2 bg-bg-soft px-6 py-4">
            <AlertDialogPrimitive.Cancel asChild>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 bg-background"
                disabled={busy}
              >
                Не сейчас
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                type="button"
                className="min-h-11 bg-pos text-white hover:bg-pos/90 dark:text-zinc-950"
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault()
                  void onConfirm()
                }}
              >
                {busy ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Сохраняю…
                  </>
                ) : (
                  <>
                    <Check className="size-4" />
                    Да, куплено
                  </>
                )}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

const WISH_CONFETTI = [
  [-154, -116, -520, 0, "#15803D"], [-116, -166, 420, 30, "#EAB308"],
  [-74, -128, -360, 65, "#0EA5E9"], [-30, -182, 520, 10, "#F43F5E"],
  [20, -154, -440, 55, "#22C55E"], [68, -186, 380, 25, "#F59E0B"],
  [112, -142, -520, 75, "#3B82F6"], [158, -104, 460, 45, "#EC4899"],
  [-184, -54, 380, 90, "#F59E0B"], [-136, -38, -460, 20, "#0EA5E9"],
  [-92, -74, 540, 100, "#22C55E"], [-42, -54, -380, 45, "#F43F5E"],
  [42, -68, 460, 85, "#EAB308"], [94, -82, -520, 15, "#3B82F6"],
  [142, -42, 420, 105, "#22C55E"], [188, -58, -460, 60, "#EC4899"],
  [-166, 24, -420, 70, "#3B82F6"], [-112, 54, 520, 110, "#F43F5E"],
  [-58, 32, -380, 35, "#22C55E"], [-12, 74, 460, 95, "#F59E0B"],
  [52, 46, -520, 50, "#0EA5E9"], [108, 68, 400, 115, "#EC4899"],
  [156, 28, -460, 80, "#EAB308"], [188, 62, 540, 40, "#22C55E"],
] as const

function WishCelebrationEffect({ name }: { name: string }) {
  return createPortal(
    <div
      data-testid="wish-celebration"
      className="pointer-events-none fixed inset-0 z-[90] overflow-hidden"
      aria-hidden="true"
    >
      <div className="absolute left-1/2 top-[42%]">
        {WISH_CONFETTI.map(([x, y, rotate, delay, color], index) => (
          <span
            key={`${x}-${y}`}
            className={`wish-confetti-piece ${index % 3 === 0 ? "rounded-full" : "rounded-[2px]"}`}
            style={{
              "--wish-confetti-x": `${x}px`,
              "--wish-confetti-y": `${y}px`,
              "--wish-confetti-rotate": `${rotate}deg`,
              animationDelay: `${delay}ms`,
              backgroundColor: color,
            } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="wish-celebration-badge absolute left-1/2 top-[42%] flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-2xl bg-zinc-950 px-5 py-4 text-white shadow-2xl dark:bg-zinc-50 dark:text-zinc-950">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
          <Check className="size-5" strokeWidth={2.5} />
        </span>
        <span className="min-w-0">
          <strong className="block text-sm font-semibold">Покупка отмечена как купленная</strong>
          <span className="block max-w-64 truncate text-xs text-zinc-300 dark:text-zinc-600">{name}</span>
        </span>
      </div>
    </div>,
    document.body,
  )
}

// --------------------------- история покупок ---------------------------
const COMPLETED_DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

function completedDateLabel(value: string | null): string {
  if (!value) return "Дата не указана"
  return COMPLETED_DATE.format(new Date(`${value}T00:00:00Z`))
}

function CompletedArchive({ items, cur, busyWishId, onRestore }: {
  items: WishItem[]
  cur: string
  busyWishId: number | null
  onRestore: (wish: WishItem) => void
}) {
  if (items.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-bg-soft px-8 py-16 text-center">
        <CheckCircle2 className="mx-auto size-6 text-ink-3" />
        <h3 className="mt-3 text-base font-semibold">Здесь пока пусто</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-3">
          Отмечайте купленные позиции галочкой — здесь сохранится дата покупки.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="completed-wishes-title" className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-line-2 px-5 py-4">
        <div>
          <h3 id="completed-wishes-title" className="text-[15px] font-semibold tracking-tight">
            Личная история
          </h3>
          <p className="mt-0.5 text-[13px] text-ink-3">
            Купленные позиции сохраняются здесь и не участвуют в финансовом плане.
          </p>
        </div>
      </div>

      <div role="list">
        {items.map((wish) => {
          const src = wish.image_url || fallbackImage(wish.category, wish.name)
          const busy = busyWishId === wish.id
          return (
            <div
              key={wish.id}
              role="listitem"
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-4 [&+&]:border-t [&+&]:border-line-2 sm:grid-cols-[minmax(0,1fr)_140px_180px_auto]"
            >
              <div className="flex min-w-0 items-center gap-3">
                {src ? (
                  <img src={src} alt="" className="size-11 shrink-0 rounded-md border border-border object-cover" />
                ) : (
                  <span className="grid size-11 shrink-0 place-items-center rounded-md bg-pos-soft text-pos">
                    <Check className="size-4" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-semibold tracking-tight">{wish.name}</p>
                  {wish.category && <p className="mt-0.5 truncate text-xs text-ink-3">{wish.category}</p>}
                </div>
              </div>

              <div className="whitespace-nowrap text-right sm:text-left">
                <span className="block text-sm font-semibold tabular-nums">
                  {money(wish.amount)} {wish.currency}
                </span>
                {wish.currency !== cur && <BaseAside cur={cur} value={wish.amount_base} />}
              </div>

              <div className="col-span-full flex items-center gap-2 text-[13px] text-ink-3 sm:col-span-1">
                <CheckCircle2 className="size-4 shrink-0 text-pos" />
                <time dateTime={wish.completed_at ?? undefined}>
                  {completedDateLabel(wish.completed_at)}
                </time>
              </div>

              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onRestore(wish)}
                aria-label={`Вернуть покупку ${wish.name} в активный список`}
                className="col-span-full min-h-11 justify-center sm:col-span-1 sm:min-h-8"
              >
                <RotateCcw className="size-4" />
                {busy ? "Возвращаю…" : "Вернуть"}
              </Button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// --------------------------- разбивка по приоритетам ---------------------------
const PRIO_META: { key: string; label: string; bar: string }[] = [
  { key: "high", label: "Высокий приоритет", bar: "bg-pos" },
  { key: "medium", label: "Средний приоритет", bar: "bg-warn" },
  { key: "low", label: "Низкий приоритет", bar: "bg-ink-3" },
]
function PriorityBreakdown({ byPriority, total, cur, open, onToggle }: {
  byPriority: Record<string, number>; total: number; cur: string
  open: boolean; onToggle: () => void
}) {
  const rows = PRIO_META.map((m) => ({ ...m, v: byPriority[m.key] ?? 0 })).filter((r) => r.v > 0)
  if (rows.length === 0) return null
  const mx = Math.max(1, ...rows.map((r) => r.v))
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-semibold tracking-tight">Структура списка</h2>
          <p className="truncate text-[12.5px] text-ink-3 tabular-nums">{money(total)} {cur} по приоритетам</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "Скрыть структуру списка" : "Показать структуру списка"}
          className="min-h-11 shrink-0 rounded-md border border-border px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-card-2 sm:min-h-9"
        >
          {open ? "Скрыть" : "Показать"}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-line-2 px-5 py-4">
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto]">
              <span className="truncate text-[13px] text-ink-2">{r.label}</span>
              <span className="h-2 overflow-hidden rounded-[5px] bg-card-2">
                <i className={`block h-full rounded-[5px] ${r.bar}`} style={{ width: `${(r.v / mx * 100).toFixed(0)}%` }} />
              </span>
              <span className="min-w-[64px] whitespace-nowrap text-right text-[13.5px] font-semibold tabular-nums">{money(r.v)} {cur}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// --------------------------- сегмент-кнопка ---------------------------
function SegButton({ on, onClick, ariaLabel, children }: {
  on: boolean; onClick: () => void; ariaLabel?: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={ariaLabel}
      className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors sm:min-h-8 sm:px-3 ${
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
function ListRow({ w, cur, verdict, onWhen, onEdit, onDelete, onComplete, busy }: {
  w: WishItem; cur: string; verdict: Verdict
  onWhen: (t: WhenType) => void
  onEdit: () => void; onDelete: () => void; onComplete: () => void; busy: boolean
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
          <SelectTrigger size="sm" className="h-8 w-full text-[13px]" aria-label={`Срок покупки ${w.name}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {WHEN_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <span className="text-[13px] text-ink-2">{PRIORITY.find((p) => p.value === w.priority)?.label}</span>

      <div className="col-span-full flex items-center justify-end gap-1 border-t border-line-2 pt-3 opacity-100 transition-opacity sm:pointer-events-none sm:absolute sm:right-3 sm:top-1/2 sm:col-span-auto sm:-translate-y-1/2 sm:border-t-0 sm:bg-card-2 sm:pl-3 sm:pt-0 sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100">
        <button
          onClick={onComplete}
          disabled={busy}
          aria-label={`Отметить покупку ${w.name} как купленную`}
          title="Отметить как купленную"
          className="grid size-11 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-pos hover:bg-pos-soft hover:text-pos disabled:opacity-50 sm:size-8"
        ><Check className="size-[15px]" /></button>
        <button
          onClick={onEdit} disabled={busy} aria-label={`Редактировать покупку ${w.name}`} title="Редактировать покупку"
          className="grid size-11 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground sm:size-8"
        ><Pencil className="size-[15px]" /></button>
        <button
          onClick={onDelete} disabled={busy} aria-label={`Удалить покупку ${w.name}`} title="Удалить"
          className="grid size-11 place-items-center rounded-lg border border-border bg-card text-ink-2 transition-colors hover:border-neg hover:bg-neg-soft hover:text-neg sm:size-8"
        ><Trash2 className="size-[15px]" /></button>
      </div>
    </div>
  )
}

// --------------------------- доска (галерея) ---------------------------
function Gallery({ items, cur, headroom, cushion, onEdit, onMove, onComplete, busyWishId }: {
  items: WishItem[]; cur: string; headroom: number; cushion: number
  onEdit: (w: WishItem) => void
  onMove: (id: number, dir: "up" | "down") => void
  onComplete: (w: WishItem) => void
  busyWishId: number | null
}) {
  return (
    <div className="grid auto-rows-[72px] grid-cols-2 gap-2.5 [grid-auto-flow:dense] sm:auto-rows-[clamp(78px,11vh,150px)] sm:grid-cols-12 sm:gap-3">
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
            onComplete={() => onComplete(w)}
            busy={busyWishId === w.id}
          />
        )
      })}
    </div>
  )
}

// --------------------------- плитка доски ---------------------------
function WishCard({
  w, cur, index, total, big, tiny, verdict, colCls, rowCls, onEdit, onMove, onComplete, busy,
}: {
  w: WishItem; cur: string; index: number; total: number; big: boolean; tiny: boolean
  verdict: Verdict; colCls: string; rowCls: string; onEdit: () => void
  onMove: (dir: "up" | "down") => void
  onComplete: () => void; busy: boolean
}) {
  const src = w.image_url || fallbackImage(w.category, w.name)
  return (
    <article
      className={`group board-rise flex flex-col ${colCls} ${rowCls} [content-visibility:visible] [contain-intrinsic-size:auto_360px] sm:[content-visibility:auto]`}
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

        <div className="absolute right-2.5 top-2.5 flex gap-1 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
          <button
            onClick={onComplete}
            disabled={busy}
            aria-label={`Отметить покупку ${w.name} как купленную`}
            title="Отметить как купленную"
            className="touch-target grid h-11 w-11 place-items-center rounded-full board-glass text-sm text-white hover:bg-white/20 disabled:opacity-50 sm:h-8 sm:w-8"
          ><Check className="size-[15px]" /></button>
          <button
            onClick={onEdit} disabled={busy} aria-label={`Редактировать покупку ${w.name}`} title="Редактировать покупку"
            className="touch-target grid h-11 w-11 place-items-center rounded-full board-glass text-sm text-white hover:bg-white/20 sm:h-8 sm:w-8"
          ><Pencil className="size-[15px]" /></button>
        </div>

        <div className="absolute left-2.5 top-2.5 flex gap-1 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
          <button
            onClick={() => onMove("up")} disabled={index === 0} aria-label="Поднять покупку выше" title="Поднять выше"
            className="touch-target grid h-11 w-11 place-items-center rounded-full board-glass text-sm text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30 sm:h-8 sm:w-8"
          >↑</button>
          <button
            onClick={() => onMove("down")} disabled={index === total - 1} aria-label="Опустить покупку ниже" title="Опустить ниже"
            className="touch-target grid h-11 w-11 place-items-center rounded-full board-glass text-sm text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30 sm:h-8 sm:w-8"
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

// --------------------------- добавление покупки ---------------------------
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
  const [autoImage, setAutoImage] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pickingImage, setPickingImage] = useState(false)
  const close = useReturnFocus(onClose)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || amount === "") return
    setBusy(true)
    try {
      const created = await api.post<{ id: number }>("/wishes", {
        name: name.trim(),
        amount: Number(amount),
        currency,
        priority,
        target_date: whenTypeToDate(when),
        category: null,
      })
      if (autoImage) {
        setPickingImage(true)
        try {
          const image = await api.post<ImgResp>(
            `/wishes/${created.id}/image/auto`,
            {},
            { feedback: false },
          )
          if (!image.ok) {
            reportActionError(
              image.reason === "no_results"
                ? "Покупка сохранена без картинки: подходящего фото не нашлось."
                : "Покупка сохранена, но картинку не удалось скачать.",
            )
          }
        } catch {
          reportActionError("Покупка сохранена, но автоподбор картинки сейчас недоступен.")
        } finally {
          setPickingImage(false)
        }
      }
      await onSaved()
      close()
    } finally { setBusy(false) }
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) close() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <DialogPrimitive.Content asChild aria-describedby={undefined}>
          <form
            onSubmit={save}
            className="fixed inset-x-0 bottom-0 z-[71] mx-auto w-full max-w-md overflow-hidden rounded-t-3xl bg-background shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
          >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-[30px] place-items-center rounded-lg bg-accent-soft text-primary">
              <Plus className="size-4" />
            </span>
            <DialogPrimitive.Title asChild>
              <h4 className="text-base font-semibold tracking-tight">Новая покупка</h4>
            </DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Close asChild>
            <button type="button" className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-muted sm:size-8" aria-label="Закрыть">
              <X className="size-4" />
            </button>
          </DialogPrimitive.Close>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Например, MacBook Pro 16″" aria-label="Название покупки" autoFocus required />
          </Field>
          <div className="grid grid-cols-[1fr_130px] gap-3">
            <Field label="Стоимость">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)}
                type="number" step="any" min="0.01" placeholder="0" aria-label="Стоимость покупки"
                required className="tabular-nums" />
            </Field>
            <Field label="Валюта">
              <CurrencySelect value={currency} onChange={setCurrency} ariaLabel="Валюта покупки" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Срок">
              <Select value={when} onValueChange={(v) => setWhen(v as WhenType)}>
                <SelectTrigger className="w-full" aria-label="Срок покупки"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WHEN_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Приоритет">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full" aria-label="Приоритет покупки"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-bg-soft px-3.5 py-3">
            <input
              type="checkbox"
              checked={autoImage}
              onChange={(event) => setAutoImage(event.target.checked)}
              aria-label="Подобрать картинку автоматически"
              className="mt-0.5 size-4 accent-foreground"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-3.5" />
                Подобрать картинку автоматически
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                Найдём свободное фото по названию. Свою картинку можно поставить позже.
              </span>
            </span>
          </label>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-4">
          <DialogPrimitive.Close asChild>
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9">Отмена</Button>
          </DialogPrimitive.Close>
          <div className="flex-1" />
          <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy || !name.trim() || amount === ""}>
            {pickingImage ? "Подбираю картинку…" : busy ? "Сохраняю…" : "Сохранить"}
          </Button>
        </div>
      </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      {children}
    </div>
  )
}

// --------------------------- полный редактор покупки ---------------------------
function CardEditor({ wish, canUp, canDown, onMove, onClose, onChanged }: {
  wish: WishItem; canUp: boolean; canDown: boolean
  onMove: (dir: "up" | "down") => Promise<void> | void
  onClose: () => void; onChanged: () => Promise<void> | void
}) {
  const [name, setName] = useState(wish.name)
  const [amount, setAmount] = useState(String(wish.amount))
  const [currency, setCurrency] = useState(wish.currency)
  const [targetDate, setTargetDate] = useState(wish.target_date ?? "")
  const [priority, setPriority] = useState<WishItem["priority"]>(wish.priority)
  const [category, setCategory] = useState(wish.category ?? "")
  const [note, setNote] = useState(wish.note ?? "")
  const [lastSaved, setLastSaved] = useState({
    name: wish.name,
    amount: wish.amount,
    currency: wish.currency,
    target_date: wish.target_date,
    priority: wish.priority,
    category: wish.category,
    note: wish.note,
  })
  const [detailsSaved, setDetailsSaved] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [url, setUrl] = useState("")
  const [size, setSize] = useState(wish.card_size || "auto")
  const [imageUrl, setImageUrl] = useState(wish.image_url)
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const close = useReturnFocus(onClose)
  const previewSrc = imageUrl || fallbackImage(category, name)
  const amountNumber = Number(amount)
  const detailsValid = (
    name.trim().length > 0 &&
    amount !== "" &&
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    currency.trim().length > 0
  )
  const detailsDirty = (
    name.trim() !== lastSaved.name ||
    amountNumber !== lastSaved.amount ||
    currency !== lastSaved.currency ||
    (targetDate || null) !== lastSaved.target_date ||
    priority !== lastSaved.priority ||
    (category.trim() || null) !== lastSaved.category ||
    (note.trim() || null) !== lastSaved.note
  )

  async function persistDetails(): Promise<boolean> {
    if (!detailsValid) {
      setDetailsError("Заполните название, стоимость и валюту покупки.")
      return false
    }
    if (!detailsDirty) return true

    const payload = {
      name: name.trim(),
      amount: amountNumber,
      currency,
      target_date: targetDate || null,
      priority,
      category: category.trim() || null,
      note: note.trim() || null,
    }
    setBusy("details")
    setDetailsError(null)
    setDetailsSaved(false)
    try {
      await api.patch(`/wishes/${wish.id}`, payload, { feedback: false })
      await refreshCurrencies()
      await onChanged()
      setLastSaved(payload)
      setDetailsSaved(true)
      return true
    } catch {
      setDetailsError("Не удалось сохранить параметры. Проверьте соединение и попробуйте ещё раз.")
      return false
    } finally {
      setBusy(null)
    }
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault()
    await persistDetails()
  }

  async function setAutomatically() {
    if (detailsDirty && !await persistDetails()) return
    setBusy("auto")
    try {
      const r = await api.post<ImgResp>(
        `/wishes/${wish.id}/image/auto`,
        {},
        { feedback: false },
      )
      if (r.ok && r.image_url) {
        setImageUrl(r.image_url)
        try { await onChanged() }
        catch { reportActionError("Картинка сохранена, но карточку не удалось обновить. Обновите страницу.") }
      } else {
        reportActionError(
          r.reason === "no_results"
            ? "Подходящего свободного фото не нашлось. Можно вставить ссылку или загрузить файл."
            : "Не удалось скачать найденную картинку. Попробуйте ещё раз.",
        )
      }
    } catch {
      reportActionError("Автоподбор сейчас недоступен. Попробуйте ещё раз или добавьте свою картинку.")
    } finally {
      setBusy(null)
    }
  }

  async function setByUrl() {
    const u = url.trim()
    if (!u) return
    setBusy("url")
    try {
      const r = await api.post<ImgResp>(`/wishes/${wish.id}/image/url`, { url: u })
      if (r.ok) {
        if (r.image_url) setImageUrl(r.image_url)
        setUrl("")
        try { await onChanged() }
        catch { reportActionError("Картинка сохранена, но карточку не удалось обновить. Обновите страницу.") }
      } else reportActionError("Не удалось скачать картинку по этой ссылке.")
    } catch {
      // api показывает единое сообщение об ошибке действия
    } finally { setBusy(null) }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy("upload")
    try {
      const form = new FormData()
      form.append("file", f)
      const r = await api.upload<ImgResp>(`/wishes/${wish.id}/image/upload`, form)
      if (r.ok) {
        if (r.image_url) setImageUrl(r.image_url)
        try { await onChanged() }
        catch { reportActionError("Картинка сохранена, но карточку не удалось обновить. Обновите страницу.") }
      } else reportActionError("Не удалось загрузить файл.")
    } catch {
      // api показывает единое сообщение об ошибке действия
    } finally {
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

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) close() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <DialogPrimitive.Content asChild aria-describedby={undefined}>
          <div className="fixed inset-x-0 bottom-0 z-[71] mx-auto max-h-[calc(100dvh-1rem)] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-background shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-w-[560px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-background px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title asChild>
              <h4 className="text-base font-semibold tracking-tight">Редактировать покупку</h4>
            </DialogPrimitive.Title>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{name.trim() || "Без названия"}</p>
          </div>
          <DialogPrimitive.Close asChild>
            <button className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-muted sm:size-8" aria-label="Закрыть">
              <X className="size-4" />
            </button>
          </DialogPrimitive.Close>
        </div>

        <form onSubmit={saveDetails}>
          <div className="space-y-4 px-5 py-4">
            <h5 className="text-sm font-semibold">Параметры покупки</h5>
            <Field label="Название">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Название покупки"
                maxLength={120}
                required
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
              <Field label="Стоимость">
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0.01"
                  aria-label="Стоимость покупки"
                  className="tabular-nums"
                  required
                />
              </Field>
              <Field label="Валюта">
                <CurrencySelect
                  value={currency}
                  onChange={setCurrency}
                  ariaLabel="Валюта покупки"
                  className="w-full"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Срок">
                <Input
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  type="date"
                  aria-label="Срок покупки"
                />
              </Field>
              <Field label="Приоритет">
                <Select value={priority} onValueChange={(value) => setPriority(value as WishItem["priority"])}>
                  <SelectTrigger className="w-full" aria-label="Приоритет покупки">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Категория">
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Категория покупки"
                maxLength={80}
                placeholder="Например, техника"
              />
            </Field>
            <Field label="Заметка">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Заметка о покупке"
                maxLength={300}
                placeholder="Зачем нужна покупка или что важно учесть"
                className="min-h-[84px] w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              />
            </Field>
            {detailsError && (
              <p role="alert" className="text-sm text-neg">{detailsError}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
            <span
              role="status"
              className={`min-w-0 flex-1 text-xs ${detailsSaved && !detailsDirty ? "text-pos" : "text-muted-foreground"}`}
            >
              {detailsSaved && !detailsDirty
                ? "Изменения сохранены"
                : detailsDirty
                  ? "Есть несохранённые изменения"
                  : "Все параметры можно изменить здесь"}
            </span>
            <Button type="submit" disabled={!detailsDirty || !detailsValid || !!busy}>
              {busy === "details" ? "Сохраняю…" : "Сохранить изменения"}
            </Button>
          </div>
        </form>

        <div className="space-y-3 px-5 py-4">
          <h5 className="text-sm font-semibold">Картинка</h5>
          <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3">
            <div className="relative aspect-square overflow-hidden rounded-xl bg-card-2">
              {previewSrc ? (
                <img src={previewSrc} alt="" className="size-full object-cover" />
              ) : (
                <Sparkles className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-ink-3" />
              )}
            </div>
            <div className="min-w-0">
              <Button
                type="button"
                className="w-full whitespace-normal text-center leading-5"
                disabled={!!busy}
                onClick={setAutomatically}
                aria-label={imageUrl ? "Подобрать другую картинку автоматически" : "Подобрать картинку автоматически"}
              >
                {busy === "auto" ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Ищу фото…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    {imageUrl ? "Подобрать другую" : "Подобрать автоматически"}
                  </>
                )}
              </Button>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                По названию, только Public Domain и CC0.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            или своя
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="flex gap-2">
            <input
              value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void setByUrl() }}
              aria-label="Ссылка на картинку"
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
          <h5 className="text-sm font-semibold">Формат карточки</h5>
          <div className="flex flex-wrap gap-1.5">
            {SIZE_OPTIONS.map((o) => (
              <button
                key={o.key} onClick={() => chooseSize(o.key)} disabled={!!busy}
                aria-pressed={size === o.key}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                  size === o.key ? "border-foreground bg-foreground text-background" : "hover:bg-muted"
                }`}
              >{o.label}</button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Формат задаёт пропорцию кадра на доске.</p>
        </div>

        <div className="space-y-2 border-t px-5 py-4">
          <h5 className="text-sm font-semibold">Порядок на доске</h5>
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
