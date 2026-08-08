export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—"
  return Math.round(v).toLocaleString("ru-RU")
}

export function ddmm(iso: string | null | undefined): string {
  if (!iso) return "—"
  const [, m, d] = iso.split("-")
  return `${d}.${m}`
}

function localCalendarIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function utcDateFromIso(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/** Прибавить календарные дни к YYYY-MM-DD, не пропуская дату из-за локального UTC offset. */
export function addDaysIso(iso: string, days: number): string {
  const date = utcDateFromIso(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Все наступления ряда внутри включительного календарного окна.
 * Месячные и годовые ряды всегда считаются от исходного дня, поэтому 31-е
 * не «прилипает» к 28-му после короткого февраля.
 */
export function occurrencesInRange(
  startIso: string,
  recurrence: string,
  fromIso: string,
  toIso: string,
  recurrenceEnd: string | null,
): string[] {
  const upperIso = recurrenceEnd && recurrenceEnd < toIso ? recurrenceEnd : toIso
  if (fromIso > upperIso || startIso > upperIso) return []
  if (recurrence === "once") {
    return startIso >= fromIso ? [startIso] : []
  }

  const start = utcDateFromIso(startIso)
  const from = utcDateFromIso(fromIso)
  const startYear = start.getUTCFullYear()
  const startMonth = start.getUTCMonth()
  const anchorDay = start.getUTCDate()
  let occurrenceAt: (index: number) => string
  let firstIndex: number

  if (recurrence === "weekly") {
    const elapsedDays = Math.floor((from.getTime() - start.getTime()) / 86_400_000)
    firstIndex = Math.max(0, Math.ceil(elapsedDays / 7))
    occurrenceAt = (index) => addDaysIso(startIso, index * 7)
  } else if (recurrence === "monthly") {
    const elapsedMonths = (
      (from.getUTCFullYear() - startYear) * 12
      + from.getUTCMonth()
      - startMonth
    )
    firstIndex = Math.max(0, elapsedMonths - 1)
    occurrenceAt = (index) => {
      const monthIndex = startMonth + index
      const year = startYear + Math.floor(monthIndex / 12)
      const month = ((monthIndex % 12) + 12) % 12
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      return new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay))).toISOString().slice(0, 10)
    }
  } else if (recurrence === "yearly") {
    firstIndex = Math.max(0, from.getUTCFullYear() - startYear - 1)
    occurrenceAt = (index) => {
      const year = startYear + index
      const lastDay = new Date(Date.UTC(year, startMonth + 1, 0)).getUTCDate()
      return new Date(Date.UTC(year, startMonth, Math.min(anchorDay, lastDay))).toISOString().slice(0, 10)
    }
  } else {
    return []
  }

  const dates: string[] = []
  for (let index = firstIndex; index < firstIndex + 5_000; index++) {
    const occurrence = occurrenceAt(index)
    if (occurrence > upperIso) break
    if (occurrence >= fromIso) dates.push(occurrence)
  }
  return dates
}

/** Следующее наступление обязательства начиная с today (клэмп конца месяца). */
export function nextOccurrence(dueIso: string, recurrence: string, todayIso: string): string {
  if (recurrence === "once" || dueIso >= todayIso) return dueIso
  const [dueYear, dueMonth, dueDay] = dueIso.split("-").map(Number)
  if (recurrence === "weekly") {
    const due = new Date(Date.UTC(dueYear, dueMonth - 1, dueDay))
    for (let n = 1; n < 600; n++) {
      const iso = new Date(due.getTime() + n * 7 * 86400_000).toISOString().slice(0, 10)
      if (iso >= todayIso) return iso
    }
    return dueIso
  }
  const step = recurrence === "monthly" ? 1 : 12
  for (let n = 1; n < 600; n++) {
    const zeroBasedMonth = dueMonth - 1 + step * n
    const y = dueYear + Math.floor(zeroBasedMonth / 12)
    const m = zeroBasedMonth % 12
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const d = new Date(Date.UTC(y, m, Math.min(dueDay, lastDay)))
    const iso = d.toISOString().slice(0, 10)
    if (iso >= todayIso) return iso
  }
  return dueIso
}

export const todayIso = () => localCalendarIso(new Date())

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
