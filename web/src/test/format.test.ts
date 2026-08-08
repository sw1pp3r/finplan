import { afterEach, describe, expect, it, vi } from "vitest"
import { addDaysIso, nextOccurrence, occurrencesInRange, todayIso } from "@/lib/format"

afterEach(() => {
  vi.useRealTimers()
})

describe("календарные даты не съезжают в UTC", () => {
  it("todayIso возвращает локальную дату после полуночи", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 24, 0, 30))
    expect(todayIso()).toBe("2026-07-24")
  })

  it("месячное повторение сохраняет локальный календарный день", () => {
    expect(nextOccurrence("2026-01-31", "monthly", "2026-03-01")).toBe("2026-03-31")
  })

  it("прибавляет дни как календарные, без сдвига через UTC", () => {
    expect(addDaysIso("2026-07-24", 30)).toBe("2026-08-23")
  })

  it("раскладывает все недельные повторы внутри окна и уважает дату окончания", () => {
    expect(occurrencesInRange(
      "2026-07-24", "weekly", "2026-07-24", "2026-08-23", "2026-08-08",
    )).toEqual([
      "2026-07-24",
      "2026-07-31",
      "2026-08-07",
    ])
  })

  it("месячные повторы не дрейфуют после короткого февраля", () => {
    expect(occurrencesInRange(
      "2026-01-31", "monthly", "2026-03-01", "2026-05-31", null,
    )).toEqual([
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ])
  })
})
