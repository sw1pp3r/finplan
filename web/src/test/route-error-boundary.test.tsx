import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary"

function BrokenRoute(): never {
  throw new Error("failed to fetch dynamically imported module")
}

describe("RouteErrorBoundary", () => {
  it("предлагает восстановление, если route-chunk не загрузился", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <RouteErrorBoundary>
        <BrokenRoute />
      </RouteErrorBoundary>,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось открыть раздел")
    expect(screen.getByRole("button", { name: "Обновить приложение" })).toBeInTheDocument()
  })
})
