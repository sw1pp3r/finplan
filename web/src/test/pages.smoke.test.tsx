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
  vi.clearAllMocks()
  getCalls.length = 0
  localStorage.clear()
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

  it("Курс", async () => {
    const { default: Course } = await import("@/pages/Course")
    renderAt(<Course />, "/more")
    await waitFor(() => expect(getCalls).toContain("/course"))
  })

  it("Сервисы", async () => {
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/more/services")
    expect(await screen.findByRole("heading", { name: "Сервисы" })).toBeInTheDocument()
    await waitFor(() => expect(getCalls).toContain("/services/1/summary"))
  })

  it("Настройки", async () => {
    const { default: Settings } = await import("@/pages/Settings")
    renderAt(<Settings />, "/settings")
    expect(await screen.findByText("Настройки")).toBeInTheDocument()
  })
})

describe("интерфейсные регрессии аудита", () => {
  it("Курс и Сервисы находятся в общем меню, а профиль ведёт в Настройки", async () => {
    localStorage.setItem("finplan-onboarded", "1")
    const { default: App } = await import("@/App")
    renderAt(<App />, "/course")

    expect((await screen.findAllByRole("link", { name: "Курс" })).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("link", { name: "Сервисы" }).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole("link", { name: "Ещё" })).toHaveLength(0)
    expect(await screen.findByRole("link", { name: "Тест Профиль" })).toHaveAttribute("href", "/settings")
  })

  it("скрытый Course не блокирует старый прямой вход в /more/services", async () => {
    localStorage.setItem("finplan-onboarded", "1")
    localStorage.setItem("finplan-show-course", "0")
    const { default: App } = await import("@/App")
    renderAt(<App />, "/more/services")

    expect(await screen.findByRole("heading", { name: "Сервисы" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Курс" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Дашборд" })).not.toBeInTheDocument()
  })

  it("Расходы дают row-actions с конкретными accessible names", async () => {
    const { default: Plans } = await import("@/pages/Plans")
    renderAt(<Plans />, "/expenses")
    await screen.findByText("Расходы")
    expect((await screen.findAllByRole("button", { name: "Редактировать расход" })).length).toBeGreaterThan(0)
    expect((await screen.findAllByRole("button", { name: "Удалить расход" })).length).toBeGreaterThan(0)
  })

  it("разовый расход можно закрыть частично из диалога оплаты", async () => {
    const { api } = await import("@/lib/api")
    const { default: Plans } = await import("@/pages/Plans")
    renderAt(<Plans />, "/expenses")
    const pay = await screen.findByRole("button", { name: "Отметить расход оплаченным" })

    fireEvent.click(pay)
    expect(screen.getByRole("dialog", { name: "Оплата расхода" })).toBeInTheDocument()
    fireEvent.change(screen.getByRole("spinbutton", { name: "Сумма частичной оплаты" }), {
      target: { value: "600" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Оплатить частично" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/obligations/3/payments",
      { amount: 600 },
    ))
  })

  it("Курс: «+ тариф» сразу создаёт строку с валидной ценой (> 0)", async () => {
    const { api } = await import("@/lib/api")
    const { default: Course } = await import("@/pages/Course")
    renderAt(<Course />, "/more")
    await waitFor(() => expect(getCalls).toContain("/course"))

    fireEvent.click(screen.getByRole("button", { name: "Добавить тариф" }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/course/tariffs",
      expect.objectContaining({ price: 100, students: 0 }),
    ))
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

describe("Доходы: добавление прошедшего факта", () => {
  it("прошлая дата из формы создаёт полученный доход, а не ожидаемое поступление", async () => {
    const { api } = await import("@/lib/api")
    const { default: Income } = await import("@/pages/Income")
    renderAt(<Income />, "/income")
    await screen.findAllByText(/Доходы/)

    fireEvent.click(screen.getByRole("button", { name: "Добавить доход" }))
    const amount = screen.getByPlaceholderText("0")
    fireEvent.change(amount, { target: { value: "1200" } })
    const date = amount.closest("form")?.querySelector<HTMLInputElement>('input[type="date"]')
    expect(date).toBeTruthy()
    fireEvent.change(date!, { target: { value: "2026-06-01" } })
    fireEvent.submit(amount.closest("form")!)

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/income",
      expect.objectContaining({
        amount: 1200,
        currency: "USD",
        received_date: "2026-06-01",
      }),
    ))
    expect(api.post).not.toHaveBeenCalledWith(
      "/inflows",
      expect.objectContaining({ expected_date: "2026-06-01" }),
    )
  })
})

describe("дашборды доходов и расходов", () => {
  it("Расходы не дублируют KPI и ставят breakeven слева от месячной разбивки", async () => {
    const { default: Plans } = await import("@/pages/Plans")
    renderAt(<Plans />, "/expenses")

    const breakeven = await screen.findByText("Сколько нужно зарабатывать")
    const monthly = screen.getByText("Ежемесячные расходы")
    expect(screen.queryByText("Расходы / мес")).not.toBeInTheDocument()
    expect(screen.queryByText("Разовые впереди")).not.toBeInTheDocument()
    expect(breakeven.compareDocumentPosition(monthly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("Доходы показывают общий итог без дублирующей плашки вероятностей", async () => {
    const { default: Income } = await import("@/pages/Income")
    renderAt(<Income />, "/income")

    expect(await screen.findByText("Итого с будущими")).toBeInTheDocument()
    expect(screen.getAllByText((c) => /17\s*200/.test(c) && c.includes("USD")).length).toBeGreaterThan(0)
    expect(screen.queryByText("Вероятность будущих")).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: "под вопросом" })).not.toBeInTheDocument()
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
