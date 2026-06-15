import "@testing-library/jest-dom/vitest"
import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"

// jsdom с opaque-origin не отдаёт localStorage — простой in-memory полифилл.
if (!globalThis.localStorage) {
  const store = new Map<string, string>()
  const ls: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    key: (i) => Array.from(store.keys())[i] ?? null,
  }
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true })
  Object.defineProperty(window, "localStorage", { value: ls, configurable: true })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// jsdom не реализует эти API — нужны recharts / radix / тема.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || (RO as unknown as typeof ResizeObserver)

// recharts ResponsiveContainer измеряет размеры — отдаём ненулевые в jsdom.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 })
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 })

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn()
