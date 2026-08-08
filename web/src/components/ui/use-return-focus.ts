import { useCallback, useRef } from "react"

/**
 * Возвращает фокус на control, который был активен до монтирования modal.
 * Нужен и для controlled Radix Dialog: родитель размонтирует Root сразу после
 * onOpenChange, поэтому полагаться только на внутренний restore недостаточно.
 */
export function useReturnFocus(onClose: () => void): () => void {
  const returnTo = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )

  return useCallback(() => {
    const target = returnTo.current
    onClose()
    window.setTimeout(() => {
      if (target?.isConnected) target.focus()
    }, 0)
  }, [onClose])
}
