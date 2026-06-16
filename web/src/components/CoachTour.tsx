import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLocation, useNavigate } from "react-router-dom"
import {
  COACH_STEPS, clearCelebrate, nextCoach, prevCoach, stopCoach, useCelebrate, useCoach, type CoachStep,
} from "@/lib/coach"

const CARD_W = 380
const VP_MARGIN = 16 // минимальный отступ карточки от края экрана
const GAP = 14 // зазор между подсветкой и карточкой
const SPOT_PAD = 8 // на сколько подсветка выходит за пределы цели

type Placement = "below" | "above" | "right" | "left"
type Spot = { top: number; left: number; width: number; height: number }
type View = { spot: Spot; top: number; left: number; placement: Placement; key: number }

// Раскладка одного шага: где нарисовать подсветку и куда поставить карточку. Карточка стоит
// РЯДОМ с целью и НЕ перекрывает подсветку. Подсветка = прямоугольник цели + SPOT_PAD; вокруг
// неё четыре «полосы» свободного места (снизу/сверху/справа/слева). Берём первую полосу, где
// карточка влезает целиком — тогда рамка обводит цель полностью. Если цель слишком высокая, а
// по бокам места нет (узкий/низкий экран), кладём карточку в полосу побольше и подрезаем
// подсветку ровно настолько, чтобы карточка гарантированно её не накрыла (рамка всё ещё
// обводит контрол сверху).
function layout(rect: DOMRect, cw: number, ch: number, idx: number): View {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const sTop = rect.top - SPOT_PAD
  const sBottom = rect.bottom + SPOT_PAD
  const sLeft = rect.left - SPOT_PAD
  const sRight = rect.right + SPOT_PAD
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const clampX = (x: number) => Math.min(Math.max(VP_MARGIN, x), vw - cw - VP_MARGIN)
  const clampY = (y: number) => Math.min(Math.max(VP_MARGIN, y), vh - ch - VP_MARGIN)
  const fullSpot: Spot = { top: sTop, left: sLeft, width: sRight - sLeft, height: sBottom - sTop }

  const roomBelow = vh - sBottom
  const roomAbove = sTop
  const roomRight = vw - sRight
  const roomLeft = sLeft
  const needV = ch + GAP + VP_MARGIN
  const needH = cw + GAP + VP_MARGIN

  // 1) карточка влезает целиком рядом с целью — подсветка обводит цель полностью
  if (roomBelow >= needV)
    return { spot: fullSpot, top: sBottom + GAP, left: clampX(cx - cw / 2), placement: "below", key: idx }
  if (roomAbove >= needV)
    return { spot: fullSpot, top: sTop - GAP - ch, left: clampX(cx - cw / 2), placement: "above", key: idx }
  if (roomRight >= needH)
    return { spot: fullSpot, top: clampY(cy - ch / 2), left: sRight + GAP, placement: "right", key: idx }
  if (roomLeft >= needH)
    return { spot: fullSpot, top: clampY(cy - ch / 2), left: sLeft - GAP - cw, placement: "left", key: idx }

  // 2) целиком никуда не лезет — кладём в полосу побольше, подсветку подрезаем с этой стороны
  if (roomBelow >= roomAbove) {
    const cappedBottom = Math.min(sBottom, vh - VP_MARGIN - ch - GAP)
    return {
      spot: { top: sTop, left: sLeft, width: sRight - sLeft, height: Math.max(48, cappedBottom - sTop) },
      top: cappedBottom + GAP, left: clampX(cx - cw / 2), placement: "below", key: idx,
    }
  }
  const cappedTop = Math.max(sTop, VP_MARGIN + ch + GAP)
  return {
    spot: { top: cappedTop, left: sLeft, width: sRight - sLeft, height: Math.max(48, sBottom - cappedTop) },
    top: cappedTop - GAP - ch, left: clampX(cx - cw / 2), placement: "above", key: idx,
  }
}

// Праздничный финал: конфетти + карточка «всё настроено». Живёт отдельно от тура, чтобы
// показаться уже после закрытия оверлея. Само-закрывается через несколько секунд.
function Celebration({ onDone }: { onDone: () => void }) {
  const colors = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899"]
  const pieces = useMemo(
    () =>
      Array.from({ length: 84 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        dur: 1.9 + Math.random() * 1.6,
        bg: colors[i % colors.length],
        rot: 360 + Math.random() * 540,
        size: 7 + Math.random() * 6,
        drift: (Math.random() * 2 - 1) * 16,
        round: Math.random() > 0.6,
      })),
    [],
  )
  useEffect(() => {
    const t = setTimeout(onDone, 6000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div
      data-coach-celebrate
      className="pointer-events-none fixed inset-0 z-[90] flex items-start justify-center overflow-hidden"
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          className="coach-confetti absolute top-0 block"
          style={{
            left: `${p.left}vw`,
            width: p.size,
            height: p.size,
            background: p.bg,
            borderRadius: p.round ? "50%" : 2,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            ["--drift" as string]: `${p.drift}vw`,
            ["--rot" as string]: `${p.rot}deg`,
          }}
        />
      ))}
      <div className="coach-celebrate-card pointer-events-auto mt-[20vh] w-[min(92vw,420px)] rounded-2xl border bg-background p-6 text-center shadow-2xl">
        <div className="text-4xl">🎉</div>
        <h3 className="mt-2 text-lg font-semibold">Готово! finplan настроен</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Базовая валюта, счета, снимок, расходы и доходы на месте — прогноз уже считается.
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Отлично
        </button>
      </div>
    </div>
  )
}

// Интерактивный коачмарк: ведёт на нужную вкладку, находит контрол по data-coach, мягко
// поднимает его под шапку, затемняет всё вокруг (spotlight через box-shadow), плавно переезжает
// между шагами и показывает карточку что/зачем/как. Оверлей НЕ перехватывает клики (кроме самой
// карточки) — подсвеченный контрол можно сразу заполнять/нажимать прямо во время тура.
export function CoachTour() {
  const idx = useCoach()
  const celebrate = useCelebrate()
  const navigate = useNavigate()
  const location = useLocation()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [ready, setReady] = useState(false)
  const [vp, setVp] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 0,
    h: typeof window !== "undefined" ? window.innerHeight : 0,
  }))
  const cardRef = useRef<HTMLDivElement>(null)

  // размеры вьюпорта для затемнения-«диафрагмы» (полосы дима тянутся до краёв экрана)
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const step: CoachStep | null = idx !== null ? COACH_STEPS[idx] : null

  // ведём на вкладку шага
  useEffect(() => {
    if (!step) return
    if (location.pathname !== step.route) navigate(step.route)
  }, [step, location.pathname, navigate])

  // на каждый новый шаг прячем карточку, пока не нашли и не «успокоили» цель
  useEffect(() => {
    setReady(false)
  }, [idx])

  // Подсветка цели через НЕПРЕРЫВНЫЙ ТРЕКИНГ (rAF-цикл), а не разовый замер.
  //
  // Почему так. Раньше rect мерили один раз и обновляли только по событиям scroll/resize/Resize-
  // Observer. Но контент НАД целью догружается асинхронно: на шаге «Расходы» блок breakeven и
  // «Обязательства» подтягивают `/summary` и `/obligations`, дорисовываются и толкают форму вниз —
  // БЕЗ события scroll/resize и без изменения размера самой формы. Подсветка застревала на старой
  // (более высокой) позиции формы — аккурат поверх «Ежемесячных расходов». На быстром headless это
  // не воспроизводилось, на реальном браузере с сетевой задержкой — стабильно.
  //
  // Теперь каждый кадр сверяем фактический rect цели и двигаем подсветку за ней. Что бы ни сдвинуло
  // цель (рефлоу, скролл, ресайз, анимация открытия формы) — рамка следует за ней в пределах кадра.
  useEffect(() => {
    if (!step || location.pathname !== step.route) return
    let cancelled = false
    let scrolled = false
    let raf = 0
    let last: DOMRect | null = null
    const find = () => document.querySelector<HTMLElement>(`[data-coach="${step.target}"]`)
    const differ = (a: DOMRect | null, b: DOMRect) =>
      !a || Math.abs(a.top - b.top) > 0.5 || Math.abs(a.left - b.left) > 0.5 ||
      Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5

    // цели ещё нет на этой странице → убираем устаревшую подсветку прошлого шага
    if (!find()) setRect(null)

    let stable = 0 // кадров подряд без сдвига цели
    let frames = 0
    let opened = false
    const tick = () => {
      if (cancelled) return
      const el = find()
      if (el) {
        // один раз, как только цель найдена и разложена: доскролливаем, если она за сгибом
        // (напр. «Счета» внизу Настроек). Форму во вьюпорте не трогаем — мгновенно, без smooth.
        if (!scrolled) {
          scrolled = true
          const r0 = el.getBoundingClientRect()
          if (r0.height > 0 && (r0.top < 0 || r0.bottom > window.innerHeight)) {
            el.scrollIntoView({ block: "center", behavior: "auto" })
          }
        }
        const r = el.getBoundingClientRect()
        if (r.height > 0) {
          if (differ(last, r)) {
            last = r
            setRect(r)
            stable = 0 // цель ещё едет (рефлоу/скролл/анимация) — ждём, пока встанет
          } else if (stable < 999) {
            stable++
          }
          // «открываем» подсветку (ready) только когда цель устаканилась ~6 кадров (≈100мс) —
          // тогда «диафрагма» раскрывается сразу на финальном месте, а не там, куда цель потом
          // уедет рефлоу. Фолбэк ~2с — на случай вечно «дышащей» цели.
          if (!opened && (stable >= 6 || frames > 120)) {
            opened = true
            setReady(true)
          }
        }
      }
      frames++
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [step, location.pathname])

  // меряем реальную высоту карточки и кладём её рядом с целью (до отрисовки → без скачка)
  useLayoutEffect(() => {
    if (idx === null || !rect || !cardRef.current) return
    setView(layout(rect, cardRef.current.offsetWidth, cardRef.current.offsetHeight, idx))
  }, [rect, idx])

  // закрытие тура — сброс
  useEffect(() => {
    if (idx === null) {
      setRect(null)
      setView(null)
    }
  }, [idx])

  // Esc закрывает тур
  useEffect(() => {
    if (idx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopCoach()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [idx])

  if (idx === null && !celebrate) return null

  const last = step ? idx === COACH_STEPS.length - 1 : false
  const cur = view && idx !== null && view.key === idx ? view : null
  const visible = ready && cur !== null
  const spot: Spot | null = cur
    ? cur.spot
    : rect
      ? { top: rect.top - SPOT_PAD, left: rect.left - SPOT_PAD, width: rect.width + SPOT_PAD * 2, height: rect.height + SPOT_PAD * 2 }
      : null
  const cardStyle: React.CSSProperties = cur
    ? { top: cur.top, left: cur.left, width: CARD_W }
    : { top: VP_MARGIN, left: VP_MARGIN, width: CARD_W }

  return createPortal(
    <>
      {/* оверлей тура: z-40 < z-50 у дропдаунов shadcn, чтобы открытые списки были видны поверх
          затемнения; pointer-events:none — клики проходят к подсвеченному контролу */}
      {step && idx !== null && (
        <div className="pointer-events-none fixed inset-0 z-40" data-coach-overlay>
          {/* Затемнение-«диафрагма»: дим из четырёх полос вокруг дырки. Дим ПОСТОЯННЫЙ (полосы
              всегда покрывают экран), анимируется только дырка — раскрывается на цели, когда шаг
              устаканился (visible), и схлопывается между шагами. Так нет ни мигания дима, ни рамки
              «не на том блоке»: дырка открывается только на финальной позиции цели. */}
          {(() => {
            const open = visible && spot
            // открыто → дырка = цель; закрыто → точка в центре цели (схлопывается «в себя») или
            // экрана, если цели нет ещё → плавная диафрагма.
            const cx = spot ? spot.left + spot.width / 2 : vp.w / 2
            const cy = spot ? spot.top + spot.height / 2 : vp.h / 2
            const h = open && spot ? spot : { top: cy, left: cx, width: 0, height: 0 }
            const hr = h.left + h.width
            const hb = h.top + h.height
            const E = "420ms cubic-bezier(0.4,0,0.2,1)"
            const tr = `top ${E}, left ${E}, width ${E}, height ${E}`
            const band: React.CSSProperties = { position: "fixed", background: "rgba(2,6,23,0.55)", transition: tr }
            return (
              <>
                <div className="pointer-events-none" style={{ ...band, top: 0, left: 0, width: vp.w, height: Math.max(0, h.top) }} />
                <div className="pointer-events-none" style={{ ...band, top: hb, left: 0, width: vp.w, height: Math.max(0, vp.h - hb) }} />
                <div className="pointer-events-none" style={{ ...band, top: h.top, left: 0, width: Math.max(0, h.left), height: h.height }} />
                <div className="pointer-events-none" style={{ ...band, top: h.top, left: hr, width: Math.max(0, vp.w - hr), height: h.height }} />
                <div
                  data-coach-spotlight
                  className="pointer-events-none fixed rounded-xl"
                  style={{
                    top: h.top, left: h.left, width: h.width, height: h.height,
                    outline: "2px solid var(--primary)", outlineOffset: 2,
                    opacity: open ? 1 : 0,
                    transition: `${tr}, opacity 220ms ease`,
                  }}
                />
              </>
            )
          })()}

          {/* карточка что/зачем/как: мягкий fade+rise при появлении и плавный переезд к новой
              позиции между шагами (top/left анимируются вместе с «диафрагмой») */}
          <div
            ref={cardRef}
            data-coach-card
            data-coach-placement={cur?.placement}
            role="dialog"
            aria-modal="false"
            className="fixed max-w-[92vw] rounded-xl border bg-background p-5 text-sm shadow-2xl"
            style={{
              ...cardStyle,
              // оверлей pointer-events:none, поэтому КАРТОЧКЕ возвращаем клики — иначе кнопки
              // «Сделал, дальше»/«Назад»/«Пропустить» мертвы. Только когда карточка видна, чтобы
              // в момент перехода (opacity 0) не перехватывать клики у подсвеченного контрола.
              pointerEvents: visible ? "auto" : "none",
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0) scale(1)" : "translateY(8px) scale(0.98)",
              transition:
                "opacity 240ms ease, transform 240ms cubic-bezier(0.4,0,0.2,1), " +
                "top 420ms cubic-bezier(0.4,0,0.2,1), left 420ms cubic-bezier(0.4,0,0.2,1)",
            }}
          >
            <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Настройка · шаг {idx + 1} из {COACH_STEPS.length}
            </div>
            <h3 className="text-base font-semibold">{step.title}</h3>
            <div className="mt-3 flex flex-col gap-2 text-muted-foreground">
              <p><span className="font-medium text-foreground">Что это.</span> {step.what}</p>
              <p><span className="font-medium text-foreground">Зачем.</span> {step.why}</p>
              <p><span className="font-medium text-foreground">Как.</span> {step.how}</p>
            </div>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={nextCoach}
                className="inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.99]"
              >
                {last ? "Готово 🎉" : "Сделал, дальше →"}
              </button>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={prevCoach}
                  disabled={idx === 0}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors enabled:hover:bg-muted disabled:opacity-40"
                >
                  ← Назад
                </button>
                <button
                  type="button"
                  onClick={stopCoach}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
                >
                  Пропустить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {celebrate && <Celebration onDone={clearCelebrate} />}
    </>,
    document.body,
  )
}
