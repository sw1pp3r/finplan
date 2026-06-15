import { describe, it, expect } from "vitest"
import { incomePerMonth, monthSpan, regularMonthlyIncome, verdictOf } from "@/lib/aggregates"

// #23 — «Регулярный доход / мес»: FX-конверсия + нормализация всех повторов
describe("#23 regularMonthlyIncome", () => {
  const conv = (a: number, c: string) => ({ USD: 1, EUR: 1.1 }[c] ?? null) && a * ({ USD: 1, EUR: 1.1 }[c] as number)
  it("конвертирует валюту и нормализует weekly/monthly/yearly, игнорит once", () => {
    const rows = [
      { amount: 1000, currency: "EUR", recurrence: "monthly" }, // 1100/мес
      { amount: 100, currency: "USD", recurrence: "weekly" },   // 100*52/12 ≈ 433.33
      { amount: 12000, currency: "USD", recurrence: "yearly" }, // 1000/мес
      { amount: 500, currency: "USD", recurrence: "monthly" },  // 500/мес
      { amount: 9999, currency: "USD", recurrence: "once" },    // не считается
    ]
    expect(regularMonthlyIncome(rows, conv)).toBeCloseTo(1100 + 100 * 52 / 12 + 1000 + 500, 2)
  })
  it("раньше было бы 1500 (только monthly, без FX) — теперь больше", () => {
    const rows = [
      { amount: 1000, currency: "EUR", recurrence: "monthly" },
      { amount: 500, currency: "USD", recurrence: "monthly" },
    ]
    expect(regularMonthlyIncome(rows, conv)).toBeCloseTo(1600, 2) // 1100 + 500, не 1500
  })
})

// #24/#30 — среднее по календарному диапазону, а не по числу месяцев с доходом
describe("#24/#30 incomePerMonth over calendar span", () => {
  it("Jan & Apr 3000 → 6000/4мес = 1500, не 3000", () => {
    expect(incomePerMonth({ by_month: { "2026-01": 3000, "2026-04": 3000 }, expected: { by_month: {}, weighted: 0 } }))
      .toBeCloseTo(1500, 2)
  })
  it("Jan & Jun 3000 → 6000/6мес = 1000", () => {
    expect(incomePerMonth({ by_month: { "2026-01": 3000, "2026-06": 3000 }, expected: { by_month: {}, weighted: 0 } }))
      .toBeCloseTo(1000, 2)
  })
  it("monthSpan считает инклюзивно", () => {
    expect(monthSpan(["2026-01", "2026-04"])).toBe(4)
    expect(monthSpan(["2026-06"])).toBe(1)
  })
})

// #31 — фолбэк нового юзера: помесячное ожидаемое, не horizon-сумма weighted
describe("#31 incomePerMonth fallback for new user", () => {
  it("по месяцам ожидаемого, а не weighted (которое ×6)", () => {
    // ожидаемая зарплата 4000/мес развёрнута на 6 мес; weighted=24000 (horizon-сумма)
    const exp = { by_month: { "2026-06": 4000, "2026-07": 4000, "2026-08": 4000, "2026-09": 4000, "2026-10": 4000, "2026-11": 4000 }, weighted: 24000 }
    expect(incomePerMonth({ by_month: {}, expected: exp })).toBeCloseTo(4000, 2) // не 24000
  })
})

// #25 — достижимость при отрицательном headroom
describe("#25 verdictOf guards non-positive headroom", () => {
  it("headroom -3000 → любая покупка «не хватает» (включая 0)", () => {
    expect(verdictOf(0, -3000, 4000).key).toBe("far")
    expect(verdictOf(500, -3000, 4000).key).toBe("far")
    expect(verdictOf(1000, -3000, 4000).key).toBe("far")
  })
  it("положительный headroom работает как прежде", () => {
    expect(verdictOf(100, 1000, 4000).key).toBe("ok")
    expect(verdictOf(1200, 1000, 4000).key).toBe("tight")
    expect(verdictOf(9000, 1000, 4000).key).toBe("far")
  })
})
