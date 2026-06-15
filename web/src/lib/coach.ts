import { useSyncExternalStore } from "react"

// Интерактивный онбординг: тур из шагов-коачмарков. Каждый шаг знает, на какой вкладке
// живёт целевой контрол (route), как его найти (target = data-coach) и что про него
// рассказать (что / зачем / как). Состояние тура — модульный стор с подписчиками, чтобы
// и чеклист на Дашборде, и оверлей в App работали с одним источником истины.

export type CoachStep = {
  route: string
  target: string // значение атрибута data-coach у подсвечиваемого элемента
  title: string
  what: string
  why: string
  how: string
}

export const COACH_STEPS: CoachStep[] = [
  {
    route: "/settings",
    target: "base-currency",
    title: "Базовая валюта",
    what: "Валюта, в которой finplan показывает все суммы и весь прогноз.",
    why: "Деньги на разных счетах (тенге, доллары, дирхамы) сводятся к одной валюте — иначе их не сложить.",
    how: "Выберите валюту, которой пользуетесь чаще всего. Остальное пересчитается по курсам автоматически.",
  },
  {
    route: "/settings",
    target: "accounts",
    title: "Счета",
    what: "Список мест, где лежат ваши деньги: банки, наличные, брокер, крипта.",
    why: "Из остатков по счетам складывается «сколько денег сейчас» — стартовая точка прогноза.",
    how: "Выберите счёт из списка или впишите своё название, укажите валюту и тип, нажмите «Добавить счёт». Курсы валют подтянутся сами.",
  },
  {
    route: "/snapshot",
    target: "snapshot",
    title: "Снимок остатков",
    what: "Сколько денег на каждом счёте прямо сейчас.",
    why: "Это «сегодня», от которого строится вся линия прогноза. Делайте новый снимок раз в неделю-две.",
    how: "Впишите текущие суммы по счетам и нажмите «Сохранить снимок». Поля уже заполнены прошлыми значениями.",
  },
  {
    route: "/plans",
    target: "expense-form",
    title: "Расходы",
    what: "Регулярные и разовые платежи: аренда, подписки, налоги, крупные траты.",
    why: "Они вычитаются из прогноза, поэтому заранее видно, когда денег станет мало.",
    how: "Впишите название, сумму, дату и как часто платёж повторяется, затем «Добавить».",
  },
  {
    route: "/income",
    target: "income-form",
    title: "Доходы",
    what: "Деньги на входе: то, что вы уже получили, и то, что ожидаете.",
    why: "Ожидаемые поступления попадают в прогноз с поправкой на вероятность — видно, хватит ли денег.",
    how: "На вкладке «Ожидается» впишите сумму и дату, а в «Повторе» выберите регулярный (зарплата, ретейнер) или разовый. Получили — жмите «получено».",
  },
]

let active: number | null = null
let celebrating = false // показываем конфетти-финал после последнего шага
const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function startCoach(step = 0) {
  celebrating = false
  active = Math.max(0, Math.min(step, COACH_STEPS.length - 1))
  emit()
}
export function stopCoach() {
  active = null
  emit()
}
export function nextCoach() {
  if (active === null) return
  if (active + 1 >= COACH_STEPS.length) {
    finishCoach() // последний шаг → празднуем
    return
  }
  active += 1
  emit()
}
export function prevCoach() {
  if (active === null || active === 0) return
  active -= 1
  emit()
}
/** Завершить тур с праздничным финалом (конфетти). */
export function finishCoach() {
  active = null
  celebrating = true
  emit()
}
/** Убрать конфетти-финал. */
export function clearCelebrate() {
  celebrating = false
  emit()
}

/** Активный шаг тура (индекс) или null, если тур закрыт. */
export function useCoach(): number | null {
  return useSyncExternalStore(subscribe, () => active, () => null)
}
/** Идёт ли праздничный финал после последнего шага. */
export function useCelebrate(): boolean {
  return useSyncExternalStore(subscribe, () => celebrating, () => false)
}
