export function PageSkeleton({ label = "Загружаю данные" }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6 py-1">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <div className="grid gap-4 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            data-skeleton
            className="h-24 rounded-xl border border-border bg-card motion-safe:animate-pulse"
          />
        ))}
      </div>
      <div
        data-skeleton
        aria-hidden="true"
        className="h-64 rounded-xl border border-border bg-card motion-safe:animate-pulse"
      />
    </div>
  )
}
