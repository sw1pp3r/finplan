export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—"
  return Math.round(v).toLocaleString("ru-RU")
}

export function ddmm(iso: string | null | undefined): string {
  if (!iso) return "—"
  const [, m, d] = iso.split("-")
  return `${d}.${m}`
}

/** Следующее наступление обязательства начиная с today (клэмп конца месяца). */
export function nextOccurrence(dueIso: string, recurrence: string, todayIso: string): string {
  if (recurrence === "once" || dueIso >= todayIso) return dueIso
  if (recurrence === "weekly") {
    const due = new Date(dueIso + "T00:00:00")
    for (let n = 1; n < 600; n++) {
      const iso = new Date(due.getTime() + n * 7 * 86400_000).toISOString().slice(0, 10)
      if (iso >= todayIso) return iso
    }
    return dueIso
  }
  const step = recurrence === "monthly" ? 1 : 12
  const due = new Date(dueIso + "T00:00:00")
  for (let n = 1; n < 600; n++) {
    const y = due.getFullYear() + Math.floor((due.getMonth() + step * n) / 12)
    const m = (due.getMonth() + step * n) % 12
    const lastDay = new Date(y, m + 1, 0).getDate()
    const d = new Date(y, m, Math.min(due.getDate(), lastDay))
    const iso = d.toISOString().slice(0, 10)
    if (iso >= todayIso) return iso
  }
  return dueIso
}

export const todayIso = () => new Date().toISOString().slice(0, 10)

const MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
]

/** "2026-06" → "Июнь 2026". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-")
  const name = MONTHS_RU[Number(m) - 1]
  if (!name) return ym
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`
}
