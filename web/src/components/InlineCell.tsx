import { useRef } from "react"
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
        "h-7 w-full rounded-sm border border-transparent bg-transparent px-1.5 text-[13px] outline-none transition-colors",
        "focus:border-border focus:bg-card",
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
        "grid h-7 w-7 flex-none place-items-center rounded-md text-ink-3 opacity-0 transition-colors group-hover:opacity-100",
        danger ? "hover:bg-neg-soft hover:text-neg" : "hover:bg-card-2 hover:text-foreground",
      )}>
      {children}
    </button>
  )
}
