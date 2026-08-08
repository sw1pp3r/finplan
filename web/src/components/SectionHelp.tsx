import { useState } from "react"

const key = (route: string) => `finplan-help-${route}`

export function SectionHelp({ route, title, children, defaultOpen = true }: {
  route: string
  title?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  // первый заход — раскрыто; once collapsed → запоминаем
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(key(route))
    return stored == null ? defaultOpen : stored !== "0"
  })

  function toggle() {
    const next = !open
    setOpen(next)
    localStorage.setItem(key(route), next ? "1" : "0")
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        {title && <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
        <button
          onClick={toggle}
          title={open ? "Скрыть справку" : "Что это за раздел?"}
          aria-label={open ? "Скрыть справку" : "Что это за раздел?"}
          aria-expanded={open}
          className="touch-target inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? "×" : "?"}
        </button>
      </div>
      {open && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  )
}
