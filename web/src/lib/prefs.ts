import { useSyncExternalStore } from "react"

// Локальные предпочтения интерфейса (клиент-онли, без бэкенда).
// Видимость вкладки «Курс»: по умолчанию показана; скрытие — в localStorage.

const SHOW_COURSE_KEY = "finplan-show-course"
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

function readShowCourse() {
  return localStorage.getItem(SHOW_COURSE_KEY) !== "0" // дефолт — показывать
}

export function setShowCourse(on: boolean) {
  localStorage.setItem(SHOW_COURSE_KEY, on ? "1" : "0")
  emit()
}

/** Показывать ли вкладку «Курс». Реактивно: меняется сразу во всех местах. */
export function useShowCourse(): boolean {
  return useSyncExternalStore(subscribe, readShowCourse, () => true)
}
