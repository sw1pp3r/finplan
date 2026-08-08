import { useEffect, useState } from "react"
import { AlertCircle, X } from "lucide-react"
import { ACTION_FEEDBACK_EVENT, type ActionFeedbackDetail } from "@/lib/actionFeedback"

export function ActionFeedback() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const show = (event: Event) => {
      setMessage((event as CustomEvent<ActionFeedbackDetail>).detail.message)
    }
    window.addEventListener(ACTION_FEEDBACK_EVENT, show)
    return () => window.removeEventListener(ACTION_FEEDBACK_EVENT, show)
  }, [])

  if (!message) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 left-4 right-4 z-[100] mx-auto flex max-w-lg items-start gap-3 rounded-xl border border-destructive/25 bg-card p-3.5 text-sm text-foreground shadow-xl sm:left-auto sm:right-5 sm:w-[420px]"
    >
      <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
      <span className="min-w-0 flex-1 leading-relaxed">{message}</span>
      <button
        type="button"
        aria-label="Закрыть сообщение об ошибке"
        onClick={() => setMessage(null)}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-card-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
