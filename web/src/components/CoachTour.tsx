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
  const cardRef = useRef<HTMLDivElement>(null)

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

  // ищем цель (страница может грузиться → поллим + MutationObserver), поднимаем её под шапку,
  // затем меряем. Пока тур открыт, следим за размером цели (ResizeObserver) — если пользователь
  // добавил счёт/строку и карточка-цель выросла, подсветка подстраивается.
  //
  // ВАЖНО: если цели ещё нет в DOM (перешли на новую вкладку, форма ещё не открылась) — СБРАСЫВАЕМ
  // rect в null. Иначе подсветка осталась бы на координатах ПРОШЛОГО шага (напр. снимок на /balance),
  // а на новой странице это случайное место (как раз поверх «Ежемесячных расходов»). Лучше показать
  // вуаль «ищем», чем рамку не на той карточке. Цель, появившуюся позже (авто-открытие формы),
  // ловит MutationObserver — без жёсткого тайм-аута на поиск.
  useEffect(() => {
    if (!step || location.pathname !== step.route) return
    let cancelled = false
    let done = false
    let tries = 0
    const find = () => document.querySelector<HTMLElement>(`[data-coach="${step.target}"]`)
    const remeasure = () => {
      const el = find()
      if (el && !cancelled) setRect(el.getBoundingClientRect())
    }
    const ro = new ResizeObserver(remeasure)

    // цели ещё нет на этой странице → убираем устаревшую подсветку прошлого шага
    if (!find()) setRect(null)

    const onFound = (el: HTMLElement) => {
      if (done || cancelled) return
      done = true
      mo.disconnect()
      ro.observe(el)
      // MutationObserver срабатывает в момент ВСТАВКИ узла — до раскладки getBoundingClientRect
      // может вернуть 0/частичный прямоугольник. Ждём кадр (раскладка применилась), затем меряем,
      // при необходимости доскролливаем (мгновенно, не smooth — иначе подсветка кадрами «едет»
      // через верх и кажется, что обведён не тот блок), и ещё кадр — итоговый замер. ready
      // выставляем только в самом конце: подсветка (gated на visible) появляется сразу на финальном
      // месте, без мелькания на чужом блоке.
      requestAnimationFrame(() => {
        if (cancelled) return
        // цель уже в зоне видимости (форма расходов/доходов авто-открывается на коротких
        // страницах прямо во вьюпорте) → НЕ скроллим, чтобы не было рывка; далеко за сгибом
        // (напр. «Счета» внизу Настроек) — мгновенный доскролл по центру.
        const r0 = el.getBoundingClientRect()
        const inView = r0.top >= 0 && r0.bottom <= window.innerHeight
        if (!inView) el.scrollIntoView({ block: "center", behavior: "auto" })
        requestAnimationFrame(() => {
          if (cancelled) return
          setRect(el.getBoundingClientRect())
          setReady(true)
        })
      })
    }
    const poll = () => {
      if (cancelled || done) return
      const el = find()
      if (el) onFound(el)
      else if (tries++ < 60) setTimeout(poll, 50)
    }
    // MutationObserver ловит цель, которая появляется позже маунта (форма расходов/доходов
    // авто-открывается эффектом уже после рендера страницы) — поллинг мог бы её пропустить.
    const mo = new MutationObserver(() => {
      const el = find()
      if (el) onFound(el)
    })
    mo.observe(document.body, { childList: true, subtree: true })
    poll()

    window.addEventListener("resize", remeasure)
    window.addEventListener("scroll", remeasure, true)
    return () => {
      cancelled = true
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener("resize", remeasure)
      window.removeEventListener("scroll", remeasure, true)
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
          {/* spotlight: подсветка целевого контрола + затемнение вокруг. Показываем ТОЛЬКО когда
              шаг «устаканился» (visible: цель найдена, доскроллена и измерена) — иначе на переходе
              между шагами/страницами рамка успевала мелькнуть не на том блоке. До этого — вуаль. */}
          {visible && spot ? (
            <div
              data-coach-spotlight
              className="pointer-events-none fixed rounded-xl"
              style={{
                top: spot.top,
                left: spot.left,
                width: spot.width,
                height: spot.height,
                boxShadow: "0 0 0 9999px rgba(2,6,23,0.55)",
                outline: "2px solid var(--primary)",
                outlineOffset: 2,
              }}
            />
          ) : (
            // пока цель ищется/доскролливается — общая вуаль, чтобы было видно, что тур активен
            <div className="pointer-events-none fixed inset-0 bg-[rgba(2,6,23,0.45)]" />
          )}

          {/* карточка что/зачем/как (появляется мягким fade+rise на каждом шаге) */}
          <div
            ref={cardRef}
            data-coach-card
            data-coach-placement={cur?.placement}
            role="dialog"
            aria-modal="false"
            className={`fixed max-w-[92vw] rounded-xl border bg-background p-5 text-sm shadow-2xl${
              visible ? " coach-card-in" : ""
            }`}
            style={cardStyle}
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
