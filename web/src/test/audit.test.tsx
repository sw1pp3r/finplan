import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactElement } from "react"
import { fixtureFor } from "./fixtures"

// мок API: канонические фикстуры по пути (как в pages.smoke), не-демо режим
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>()
  return {
    ...actual,
    isDemo: () => false,
    setDemo: vi.fn(),
    api: {
      get: vi.fn((path: string) => Promise.resolve(fixtureFor(path))),
      post: vi.fn(() => Promise.resolve({})),
      patch: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      upload: vi.fn(() => Promise.resolve({})),
    },
  }
})

vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => (
      <div style={{ width: 800, height: 400 }}>{children}</div>
    ),
  }
})

function renderAt(el: ReactElement, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>)
}

/** Сматчить элемент, чей собственный текст содержит приведение «≈ … <валюта>». */
const convAside = (cur: string) => (content: string) =>
  content.includes("≈") && content.includes(cur)

describe("(A) имя пользователя — из настроек, без демо-персоны", () => {
  it("сайдбар показывает имя из /settings и НЕ показывает «Артём Кравцов / AI Builder»", async () => {
    const { default: App } = await import("@/App")
    renderAt(<App />)
    expect(await screen.findByText("Тест Профиль")).toBeInTheDocument()
    expect(screen.queryByText(/AI Builder/)).toBeNull()
    expect(screen.queryByText("Артём Кравцов")).toBeNull()
    expect(screen.queryByText(/Indie/)).toBeNull()
  })

  it("в Настройках есть редактируемое поле «Имя» с текущим значением", async () => {
    const { default: Settings } = await import("@/pages/Settings")
    renderAt(<Settings />, "/settings")
    expect(await screen.findByText("Профиль")).toBeInTheDocument()
    const input = (await screen.findByDisplayValue("Тест Профиль")) as HTMLInputElement
    expect(input.tagName).toBe("INPUT")
  })
})

describe("(B) дашборд: расходы/мес = required_monthly_income, нет фантомного «свободно»", () => {
  it("«Свободно/мес» = доходы(4710) − расходы(5400) = −690, а не доходы − burn(1300)", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)
    await screen.findByText("Дашборд")
    // расходы/мес = required = 5400 (обязательства + траты), не burn 1300
    await waitFor(() =>
      expect(screen.getAllByText((c) => /5\s*400/.test(c)).length).toBeGreaterThan(0),
    )
    // свободно/мес отрицательно: −690 (доказывает, что вычли required, а не burn)
    expect(screen.getAllByText((c) => /690/.test(c) && c.includes("USD")).length).toBeGreaterThan(0)
  })
})

describe("(C) приведение чужой валюты к базовой — рядом с суммой", () => {
  it("Доходы: строка в EUR показывает ≈ … USD", async () => {
    const { default: Income } = await import("@/pages/Income")
    renderAt(<Income />, "/income")
    await screen.findAllByText(/Доходы/)
    await waitFor(() =>
      expect(screen.getAllByText(convAside("USD")).length).toBeGreaterThan(0),
    )
  })
  it("Расходы: обязательство в RUB показывает ≈ … USD", async () => {
    const { default: Plans } = await import("@/pages/Plans")
    renderAt(<Plans />, "/expenses")
    await screen.findByText("Расходы")
    await waitFor(() =>
      expect(screen.getAllByText(convAside("USD")).length).toBeGreaterThan(0),
    )
  })
})

describe("(D) Доходы: разбивка ожиданий по вероятности, не один раздутый итог", () => {
  it("видны строки confirmed/likely/possible", async () => {
    const { default: Income } = await import("@/pages/Income")
    renderAt(<Income />, "/income")
    await screen.findAllByText(/Доходы/)
    // строки вероятностей рендерятся в блоке «Ожидается» (и в чипах строк) — ≥1 каждой
    expect((await screen.findAllByText((c) => c.includes("скорее всего"))).length).toBeGreaterThan(0)
    expect((await screen.findAllByText((c) => c.includes("под вопросом"))).length).toBeGreaterThan(0)
    expect((await screen.findAllByText((c) => c.includes("точно"))).length).toBeGreaterThan(0)
  })
})

describe("(E) Мечты: разбивка «сколько денег нужно» по приоритетам", () => {
  it("показывает high/medium/low из by_priority", async () => {
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes")
    expect(await screen.findByText("Сколько денег нужно")).toBeInTheDocument()
    expect(await screen.findByText("Высокий приоритет")).toBeInTheDocument()
    expect(await screen.findByText("Низкий приоритет")).toBeInTheDocument()
  })
})
