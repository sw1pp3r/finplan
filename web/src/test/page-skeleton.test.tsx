import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PageSkeleton } from "@/components/PageSkeleton"

describe("PageSkeleton", () => {
  it("объявляет состояние загрузки и сохраняет каркас страницы", () => {
    const { container } = render(<PageSkeleton label="Загружаю доходы" />)

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("Загружаю доходы")).toBeInTheDocument()
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThanOrEqual(4)
  })
})
