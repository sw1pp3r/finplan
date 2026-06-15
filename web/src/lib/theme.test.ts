import { describe, it, expect, beforeEach } from "vitest"
import { setTheme } from "./theme"

describe("theme", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark")
    localStorage.clear()
  })

  it("тумблер тёмной темы ставит класс .dark и пишет выбор в localStorage", () => {
    setTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(localStorage.getItem("finplan-theme")).toBe("dark")
  })

  it("обратно на светлую — снимает .dark", () => {
    setTheme("dark")
    setTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(localStorage.getItem("finplan-theme")).toBe("light")
  })
})
