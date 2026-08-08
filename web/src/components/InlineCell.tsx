import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

/** Borderless inline cell input — text/number. Saves on blur+Enter, reverts on Escape. */
export function Cell({
  defaultValue, onCommit, type = "text", align = "left", className, ariaLabel, step, min, placeholder,
}: {
  defaultValue: string
  onCommit: (v: string) => void
  type?: "text" | "number"
  align?: "left" | "right"
  className?: string
  ariaLabel: string
  step?: string
  min?: string
  placeholder?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    // Do not erase an in-progress edit, but always accept a fresh server value
    // once the cell is idle. defaultValue alone never updates an existing input.
    if (el && document.activeElement !== el) el.value = defaultValue
  }, [defaultValue])
  const commit = () => {
    const el = ref.current
    if (!el) return
    if (el.value !== defaultValue) onCommit(el.value)
  }
  return (
    <input
      ref={ref}
      defaultValue={defaultValue}
      type={type}
      step={step}
      min={min}
      inputMode={type === "number" ? "decimal" : undefined}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.currentTarget.blur() }
        if (e.key === "Escape") { e.currentTarget.value = defaultValue; e.currentTarget.blur() }
      }}
      className={cn(
        "h-11 w-full rounded-sm border border-transparent bg-transparent px-1.5 text-[13px] outline-none transition-colors sm:h-7",
        "focus:border-border focus:bg-card focus-visible:ring-2 focus-visible:ring-ring",
        align === "right" && "text-right tnum",
        className,
      )}
    />
  )
}

/** Row-hover ghost icon button for dense table rows (parent row needs `group`). */
export function IconBtn({ onClick, label, danger, children }: {
  onClick: () => void; label: string; danger?: boolean; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={cn(
        "touch-target sticky right-0 z-[1] grid h-11 w-11 flex-none place-items-center rounded-md bg-card text-ink-3 opacity-100 transition-colors sm:h-7 sm:w-7",
        "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100",
        danger ? "hover:bg-neg-soft hover:text-neg" : "hover:bg-card-2 hover:text-foreground",
      )}>
      {children}
    </button>
  )
}
