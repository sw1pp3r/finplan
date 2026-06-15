// Чистые агрегаты дашборда/доходов/мечт. Вынесены из компонентов, чтобы покрыть
// тестами findings аудита (#23/#24/#25/#30/#31). Совпадают с бэкендовой нормализацией.

// нормализация повтора в месячный эквивалент (52 недели / 12 месяцев) — как app/service.py
export const MONTHLY_FACTOR: Record<string, number> = {
  weekly: 52 / 12,
  monthly: 1,
  yearly: 1 / 12,
}

/** Число календарных месяцев от самого раннего до самого позднего ключа "YYYY-MM" включительно. */
export function monthSpan(months: string[]): number {
  if (!months.length) return 1
  const idx = months.map((m) => {
    const [y, mo] = m.split("-").map(Number)
    return y * 12 + (mo - 1)
  })
  return Math.max(1, Math.max(...idx) - Math.min(...idx) + 1)
}

/**
 * #23 «Регулярный доход / мес»: FX-конвертация в базовую валюту И нормализация ВСЕХ
 * повторяющихся источников (weekly/monthly/yearly), а не суммирование сырых amount только
 * у monthly. Строки без курса пропускаются (как missing_rates).
 */
export function regularMonthlyIncome(
  rows: { amount: number; currency: string; recurrence: string }[],
  conv: (amount: number, currency: string) => number | null,
): number {
  return rows
    .filter((r) => r.recurrence !== "once")
    .reduce((acc, r) => {
      const base = conv(r.amount, r.currency)
      return base == null ? acc : acc + base * (MONTHLY_FACTOR[r.recurrence] ?? 1)
    }, 0)
}

/**
 * #24/#30/#31 «Доходы / мес»: среднее по КАЛЕНДАРНОМУ диапазону (пропущенные месяцы = 0),
 * а не делёж на число месяцев с доходом (завышало). Фолбэк для нового юзера без истории —
 * помесячное ожидаемое (среднее по месяцам пайплайна), НЕ horizon-сумма weighted (была ×6).
 */
export function incomePerMonth(income: {
  by_month: Record<string, number>
  expected: { by_month: Record<string, number>; weighted: number }
}): number | null {
  const months = Object.keys(income.by_month)
  if (months.length) {
    const sum = months.reduce((a, m) => a + income.by_month[m], 0)
    return sum / monthSpan(months)
  }
  const exp = Object.keys(income.expected.by_month)
  if (exp.length) {
    const sum = exp.reduce((a, m) => a + income.expected.by_month[m], 0)
    return sum / monthSpan(exp)
  }
  return null
}

export type Verdict = { key: "ok" | "tight" | "far"; label: string }

/**
 * #25 достижимость мечты: при НЕположительном headroom (прогноз ниже подушки — свободных
 * денег нет) любая покупка = «не хватает». Иначе прежние пороги. Раньше отрицательный
 * headroom давал «впритык» даже для нулевой покупки, противореча «Свободно потратить = 0».
 */
export function verdictOf(amountBase: number, headroom: number, cushion: number): Verdict {
  if (headroom <= 0) return { key: "far", label: "не хватает" }
  if (amountBase <= headroom) return { key: "ok", label: "по карману" }
  if (amountBase <= headroom * 1.5 || amountBase <= headroom + cushion)
    return { key: "tight", label: "впритык" }
  return { key: "far", label: "не хватает" }
}
