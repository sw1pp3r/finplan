import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CurrencySelect } from "@/components/CurrencySelect"
import { RefCombo } from "@/components/RefCombo"

vi.mock("@/lib/currencies", () => ({
  useKnownCurrencies: () => ["USD"],
}))

describe("CurrencySelect", () => {
  it("программно называет выбор и custom-ввод валюты", () => {
    render(<CurrencySelect value="EUR" onChange={vi.fn()} ariaLabel="Валюта расхода" />)

    expect(screen.getByRole("combobox", { name: "Валюта расхода" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Своя валюта: Валюта расхода" })).toBeInTheDocument()
  })

  it("оставляет custom currency input доступным для пальца на mobile", () => {
    render(<CurrencySelect value="EUR" onChange={vi.fn()} />)

    expect(screen.getByDisplayValue("EUR")).toHaveClass("h-11", "sm:h-8")
  })
})

describe("RefCombo", () => {
  it("использует placeholder как доступное имя выбора", () => {
    render(
      <RefCombo
        options={[{ id: 1, name: "Проекты" }]}
        value=""
        onChange={vi.fn()}
        placeholder="Направление дохода"
      />,
    )

    expect(screen.getByRole("combobox", { name: "Направление дохода" })).toBeInTheDocument()
  })
})
