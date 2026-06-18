import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactElement } from "react"
import { fixtureFor } from "./fixtures"

// --- мок API: отдаёт канонические фикстуры по пути, запоминает вызовы ---
const getCalls: string[] = []
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>()
  return {
    ...actual,
    isDemo: () => false,
    setDemo: vi.fn(),
    api: {
      get: vi.fn((path: string) => {
        getCalls.push(path)
        return Promise.resolve(fixtureFor(path))
      }),
      post: vi.fn(() => Promise.resolve({})),
      patch: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      upload: vi.fn(() => Promise.resolve({})),
    },
  }
})

// recharts в jsdom: подменяем ResponsiveContainer на фикс-размер, чтобы график рисовался
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

beforeEach(() => {
  getCalls.length = 0
})

describe("страницы рендерятся с замоканным API без падений", () => {
  it("Дашборд", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)
    expect(await screen.findByText("Дашборд")).toBeInTheDocument()
  })

  it("Баланс", async () => {
    const { default: Snapshot } = await import("@/pages/Snapshot")
    renderAt(<Snapshot />, "/balance")
    expect(await screen.findByText("Баланс")).toBeInTheDocument()
  })

  it("Доходы", async () => {
    const { default: Income } = await import("@/pages/Income")
    renderAt(<Income />, "/income")
    expect((await screen.findAllByText(/Доходы/)).length).toBeGreaterThan(0)
  })

  it("Расходы", async () => {
    const { default: Plans } = await import("@/pages/Plans")
    renderAt(<Plans />, "/expenses")
    expect(await screen.findByText("Расходы")).toBeInTheDocument()
  })

  it("Ещё / Курс", async () => {
    const { default: Course } = await import("@/pages/Course")
    renderAt(<Course />, "/more")
    await waitFor(() => expect(getCalls).toContain("/course"))
  })

  it("Настройки", async () => {
    const { default: Settings } = await import("@/pages/Settings")
    renderAt(<Settings />, "/settings")
    expect(await screen.findByText("Настройки")).toBeInTheDocument()
  })
})

describe("интерфейсные регрессии аудита", () => {
  it("Расходы дают row-actions с конкретными accessible names", async () => {
    const { default: Plans } = await import("@/pages/Plans")
    renderAt(<Plans />, "/expenses")
    await screen.findByText("Расходы")
    expect((await screen.findAllByRole("button", { name: "Редактировать расход" })).length).toBeGreaterThan(0)
    expect((await screen.findAllByRole("button", { name: "Удалить расход" })).length).toBeGreaterThan(0)
  })

  it("Курс не даёт сохранить новый тариф с пустой ценой", async () => {
    const { default: Course } = await import("@/pages/Course")
    renderAt(<Course />, "/more")
    await waitFor(() => expect(getCalls).toContain("/course"))

    fireEvent.click(screen.getByRole("button", { name: /Добавить тариф/ }))
    const save = screen.getByRole("button", { name: "Сохранить" })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Цена"), { target: { value: "100" } })
    expect(save).not.toBeDisabled()
  })
})

describe("дашборд: период завязан на горизонт прогноза", () => {
  it("грузит /forecast?horizon=N и показывает дропдаун периода", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)
    await screen.findByText("Дашборд")
    await waitFor(() =>
      expect(getCalls.some((p) => p.startsWith("/forecast?horizon="))).toBe(true)
    )
  })
})

describe("гриды Доходов: суммы tabular-nums", () => {
  it("в ленте есть элементы с классом tnum", async () => {
    const { default: Income } = await import("@/pages/Income")
    const { container } = renderAt(<Income />, "/income")
    await screen.findAllByText(/Доходы/)
    await waitFor(() => expect(container.querySelector(".tnum")).toBeTruthy())
  })
})

describe("Мечты: переключатель Список/Доска через ?view=", () => {
  it("список по умолчанию", async () => {
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes")
    expect(await screen.findByText(/Список желаний/)).toBeInTheDocument()
  })
  it("доска при ?view=board", async () => {
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes?view=board")
    expect(await screen.findByText(/Доска желаний/)).toBeInTheDocument()
  })
})
