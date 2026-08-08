import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Cell } from "@/components/InlineCell"

describe("Inline Cell", () => {
  it("синхронизирует серверное значение после повторного рендера", () => {
    const onCommit = vi.fn()
    const { rerender } = render(
      <Cell ariaLabel="Клиенты" defaultValue="0" onCommit={onCommit} />,
    )

    rerender(<Cell ariaLabel="Клиенты" defaultValue="6" onCommit={onCommit} />)

    expect(screen.getByRole("textbox", { name: "Клиенты" })).toHaveValue("6")
    fireEvent.blur(screen.getByRole("textbox", { name: "Клиенты" }))
    expect(onCommit).not.toHaveBeenCalled()
  })
})
