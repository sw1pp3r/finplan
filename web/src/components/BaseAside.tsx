import { money } from "@/lib/format"

/**
 * Приведение суммы в чужой валюте к базовой — подписью ПОД суммой (отдельной строкой,
 * чтобы не расширять колонку и не давать горизонтального переполнения).
 * Ничего не рендерит, если приведение недоступно (нет курса).
 */
export function BaseAside({ cur, value, sign = "", className = "" }: {
  cur: string
  value: number | null | undefined
  sign?: string
  className?: string
}) {
  if (value == null) return null
  return (
    <span className={`block whitespace-nowrap text-[11.5px] font-normal text-ink-3 tnum ${className}`}>
      ≈ {sign}{money(value)} {cur}
    </span>
  )
}
