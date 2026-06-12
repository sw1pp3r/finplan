import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { api, type Summary, type WishItem, type Wishes as WishesData } from "@/lib/api"
import { fallbackImage } from "@/lib/wishImage"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Tooltip as Hint, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type ImgResp = { ok: boolean; image_url: string | null }

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

type Verdict = { key: "ok" | "tight" | "far"; label: string; cls: string }
function verdictOf(amountBase: number, headroom: number, cushion: number): Verdict {
  if (amountBase <= headroom) return { key: "ok", label: "по карману", cls: "verdict-ok" }
  if (amountBase <= headroom * 1.5 || amountBase <= headroom + cushion)
    return { key: "tight", label: "впритык", cls: "verdict-tight" }
  return { key: "far", label: "не хватает", cls: "verdict-far" }
}

// Сетка-портфолио как у brunocis.co: 12-колоночный full-bleed грид, плитки гигантские
// (высота в vh), ряды бьются на крупные доли. Мелкий шаг (12 кол.) даёт и гигантов
// во весь экран, и аккуратные маленькие квадраты под мелкие желания. Размер = col + row.
const SIZE_OPTIONS: { key: string; label: string }[] = [
  { key: "auto", label: "Авто" },
  { key: "small", label: "Квадратик" },
  { key: "square", label: "Треть" },
  { key: "tall", label: "Высокая" },
  { key: "wide", label: "Две трети" },
  { key: "large", label: "Во весь экран" },
]
// статические классы (Tailwind JIT не видит вычисленные).
// Мобила: маленький квадрат — половина ширины (2 в ряд), остальное — во всю ширину.
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

// ритм как у brunocis: каждый ряд собирается ровно из 12 колонок с одинаковой высотой.
// Первая плитка — гигант во весь экран; дальше крупные доли.
const RHYTHM: { col: number; row: number }[] = [
  { col: 12, row: 8 },                          // ряд A — гигант во весь экран
  { col: 6, row: 7 }, { col: 6, row: 7 },       // ряд B — 50/50, высокие
  { col: 8, row: 6 }, { col: 4, row: 6 },       // ряд C — 66/33
  { col: 4, row: 6 }, { col: 8, row: 6 },       // ряд D — 33/66
  { col: 6, row: 6 }, { col: 6, row: 6 },       // ряд E — 50/50
]

function spanOf(w: WishItem, i: number): { col: number; row: number } {
  switch (w.card_size) {
    case "large": return { col: 12, row: 8 }
    case "wide": return { col: 8, row: 6 }
    case "tall": return { col: 4, row: 8 }
    case "square": return { col: 4, row: 6 }
    case "small": return { col: 3, row: 3 }
  }
  // мелкие желания (низкий приоритет) — аккуратный маленький квадрат
  if (w.priority === "low") return { col: 3, row: 3 }
  return RHYTHM[i % RHYTHM.length]
}

export default function Board() {
  const [data, setData] = useState<WishesData | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [editing, setEditing] = useState<WishItem | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const load = useCallback(async () => {
    const [w, s] = await Promise.all([api.get<WishesData>("/wishes"), api.get<Summary>("/summary")])
    setData(w); setSummary(s)
  }, [])
  useEffect(() => { void load() }, [load])

  // полноэкранный режим: оверлей + нативный Fullscreen API (best-effort)
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
      (a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (b.amount_base - a.amount_base),
    )
  }, [data])

  const affordableCount = useMemo(
    () => (data?.items ?? []).filter((w) => w.amount_base <= headroom).length,
    [data, headroom],
  )

  if (!data || !summary) {
    return <div className="py-24 text-center text-sm text-muted-foreground">Собираю доску…</div>
  }
  const empty = data.items.length === 0

  return (
    <div className="board-scope relative isolate -mt-8 -mb-8 ml-[calc(50%-50vw)] w-screen min-h-[calc(100svh-3.5rem)] overflow-clip">
      {/* hero */}
      <div className="relative z-10 mx-auto max-w-6xl px-6 pt-20 pb-12">
        <h1 className="board-display text-5xl leading-[0.95] sm:text-7xl" style={{ fontWeight: 700 }}>
          Доска желаний
        </h1>
        <p className="mt-6 max-w-xl text-[0.95rem] leading-relaxed board-muted">
          Каждое желание — крупным планом. Точка рядом с подписью греется по достижимости:{" "}
          <span className="font-medium text-emerald-600">по карману</span>,{" "}
          <span className="font-medium text-amber-600">впритык</span>,{" "}
          <span className="font-medium text-rose-600">не хватает</span>.
        </p>

        {/* ribbon */}
        <div className="mt-10 flex flex-wrap items-end gap-x-10 gap-y-4">
          <Stat value={String(data.items.length)} label={data.items.length === 1 ? "желание" : "желаний"} />
          <Stat value={`${money(data.total)} ${cur}`} label="суммарно" />
          <Stat
            value={String(affordableCount)} label="уже по карману" accent
            hint={
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">Что уже влезает в бюджет</p>
                <p>Желания дешевле свободных денег над подушкой ({money(Math.max(0, headroom))} {cur}).</p>
                <p className="text-muted-foreground tabular-nums">Сейчас таких: {affordableCount} из {data.items.length}.</p>
              </div>
            }
          />
          <Stat
            value={`${money(Math.max(0, headroom))} ${cur}`} label="свободно потратить"
            hint={
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">Сколько можно потратить</p>
                <p>Не пробивая подушку безопасности. По базовому сценарию:</p>
                <p className="tabular-nums">
                  минимум кэша {money(summary.scenarios.base.min_total)} − подушка {money(cushion)}
                </p>
                <p className="font-medium tabular-nums">= {money(Math.max(0, headroom))} {cur}</p>
              </div>
            }
          />
          {!empty && (
            <button
              onClick={enterFull}
              className="ml-auto inline-flex items-center gap-2 self-end rounded-full border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground hover:text-background"
              style={{ borderColor: "var(--board-line)" }}
              title="Раскрыть доску на весь экран"
            >
              <span aria-hidden>⛶</span> Во весь экран
            </button>
          )}
        </div>
      </div>

      {/* board — гигантские full-bleed плитки, мини-подписи снизу (как brunocis.co) */}
      <div className="relative z-10 px-3 pb-24 sm:px-4">
        {empty ? (
          <div className="mx-auto max-w-2xl rounded-3xl border bg-muted/40 px-8 py-16 text-center">
            <div className="board-display text-2xl">Доска пока пустая</div>
            <p className="mt-3 text-sm board-muted">Добавь желания во вкладке «Покупки» — и они оживут здесь картинками.</p>
          </div>
        ) : (
          <Gallery
            items={sorted}
            headroom={headroom} cushion={cushion} onEdit={setEditing}
          />
        )}
      </div>

      {/* полноэкранный режим — тёмный кинозал поверх шапки на весь вьюпорт */}
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
              items={sorted}
              headroom={headroom} cushion={cushion} onEdit={setEditing}
            />
          </div>
        </div>,
        document.body,
      )}

      {editing && <CardEditor wish={editing} onClose={() => setEditing(null)} onChanged={load} />}
    </div>
  )
}

// Галерея: full-bleed 6-колоночный грид гигантских плиток (высота рядов в vh),
// dense-flow добивает ряды. Каждая плитка — крупный кадр + мини-подпись снизу.
function Gallery({ items, headroom, cushion, onEdit }: {
  items: WishItem[]; headroom: number; cushion: number
  onEdit: (w: WishItem) => void
}) {
  return (
    <div className="grid auto-rows-[clamp(78px,11vh,150px)] grid-cols-2 gap-2.5 [grid-auto-flow:dense] sm:grid-cols-12 sm:gap-3">
      {items.map((w, i) => {
        const s = spanOf(w, i)
        return (
          <WishCard
            key={w.id} w={w} index={i}
            big={s.col >= 8 || s.row >= 7} tiny={s.row <= 3}
            colCls={COL[s.col]} rowCls={ROW[s.row]}
            verdict={verdictOf(w.amount_base, headroom, cushion)}
            onEdit={() => onEdit(w)}
          />
        )
      })}
    </div>
  )
}

function Stat({ value, label, accent, hint }: {
  value: string; label: string; accent?: boolean; hint?: React.ReactNode
}) {
  const inner = (
    <div className={hint ? "cursor-help" : undefined}>
      <div className={`board-display text-2xl tabular-nums sm:text-3xl ${accent ? "text-emerald-600" : ""}`}>{value}</div>
      <div className="mt-1 inline-flex items-center gap-1 text-[0.7rem] uppercase tracking-[0.18em] board-muted">
        {label}{hint && <span aria-hidden className="text-[0.9em] opacity-55">ⓘ</span>}
      </div>
    </div>
  )
  if (!hint) return inner
  return (
    <Hint>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Hint>
  )
}

// Плитка мечты (стиль brunocis): гигантский кадр заполняет ячейку грида, под ним —
// одна мини-строка: точка-достижимость · название (Playfair) · сумма справа.
// Углы почти острые, без скрима/прогресс-бара поверх кадра — фото чистое.
function WishCard({
  w, index, big, tiny, verdict, colCls, rowCls, onEdit,
}: {
  w: WishItem; index: number; big: boolean; tiny: boolean
  verdict: Verdict; colCls: string; rowCls: string; onEdit: () => void
}) {
  const src = w.image_url || fallbackImage(w.category, w.name)

  return (
    <article
      className={`group board-rise flex flex-col ${colCls} ${rowCls} [content-visibility:auto] [contain-intrinsic-size:auto_360px]`}
      style={{ animationDelay: `${Math.min(index, 10) * 0.035}s` }}
    >
      {/* крупный кадр — заполняет всю высоту ячейки минус подпись */}
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

        {/* кнопка редактора — на hover, в углу */}
        <div className="absolute right-2.5 top-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            onClick={onEdit} title="Картинка и формат карточки"
            className="grid h-8 w-8 place-items-center rounded-full board-glass text-sm text-white hover:bg-white/20"
          >✎</button>
        </div>
      </div>

      {/* мини-подпись под кадром — одна строка, жирное название */}
      <div className={`flex items-baseline gap-2 px-0.5 ${tiny ? "mt-1.5 text-xs" : big ? "mt-2 text-base sm:text-lg" : "mt-2 text-sm"}`}>
        <span className={`h-2 w-2 shrink-0 self-center rounded-full gem-${verdict.key}`} title={verdict.label} />
        <h3 className="board-display min-w-0 truncate font-bold">{w.name}</h3>
        <span className="board-muted ml-auto shrink-0 font-medium tabular-nums">
          {money(w.amount)} {w.currency}
        </span>
      </div>
    </article>
  )
}

// Редактор карточки: картинка (ссылка / загрузка файла) + формат плитки.
// Лёгкий оверлей — чтобы изменение формата было видно на доске позади. Портал в body (светлая тема).
function CardEditor({ wish, onClose, onChanged }: {
  wish: WishItem; onClose: () => void; onChanged: () => Promise<void> | void
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

        {/* картинка */}
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

        {/* формат карточки */}
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
      </div>
    </div>,
    document.body,
  )
}
