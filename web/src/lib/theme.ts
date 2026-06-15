import { useSyncExternalStore } from "react"

// Тёмная тема: класс `.dark` на <html>, выбор в localStorage('finplan-theme').
// По умолчанию — светлая. Тумблер-луна в шапке переключает.

export type Theme = "light" | "dark"
const KEY = "finplan-theme"
const listeners = new Set<() => void>()

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light"
  } catch {
    return "light"
  }
}

function apply(t: Theme) {
  const root = document.documentElement
  root.classList.toggle("dark", t === "dark")
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* ignore */
  }
  apply(t)
  listeners.forEach((l) => l())
}

export function toggleTheme() {
  setTheme(read() === "dark" ? "light" : "dark")
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Реактивно отдаёт текущую тему. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "light")
}

// Применить сохранённую тему как можно раньше (импортируется в main.tsx).
if (typeof document !== "undefined") apply(read())
