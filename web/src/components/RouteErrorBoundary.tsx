import { Component, type ErrorInfo, type ReactNode } from "react"
import { RefreshCw } from "lucide-react"

export class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route chunk failed", error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div role="alert" className="mx-auto flex max-w-lg flex-col items-center rounded-xl border border-border bg-card px-6 py-10 text-center shadow-sm">
        <h2 className="text-lg font-semibold">Не удалось открыть раздел</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Возможно, приложение обновилось в фоне. Обновите страницу, чтобы загрузить свежую версию.
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Обновить приложение
        </button>
      </div>
    )
  }
}
