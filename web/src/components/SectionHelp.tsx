import { useState } from "react"

const key = (route: string) => `finplan-help-${route}`

export function SectionHelp({ route, title, children }: {
  route: string
  title?: string
  children: React.ReactNode
}) {
  // первый заход — раскрыто; once collapsed → запоминаем
  const [open, setOpen] = useState(() => localStorage.getItem(key(route)) !== "0")

  function toggle() {
    const next = !open
    setOpen(next)
    localStorage.setItem(key(route), next ? "1" : "0")
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {title && <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
        <button
          onClick={toggle}
          title={open ? "Скрыть справку" : "Что это за раздел?"}
          aria-expanded={open}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs text-muted-foreground transition-colors hover:bg-muted"
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
