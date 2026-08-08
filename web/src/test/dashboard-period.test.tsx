import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { fixtureFor } from "./fixtures"
import { api } from "@/lib/api"

const calls: string[] = []
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>()
  return {
    ...actual,
    isDemo: () => false,
    setDemo: vi.fn(),
    api: {
      get: vi.fn((path: string) => { calls.push(path); return Promise.resolve(fixtureFor(path)) }),
      post: vi.fn(() => Promise.resolve({})),
      patch: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      upload: vi.fn(() => Promise.resolve({})),
    },
  }
})

vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>()
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }
})

beforeEach(() => {
  vi.mocked(api.get).mockImplementation((path: string) => {
    calls.push(path)
    return Promise.resolve(fixtureFor(path)) as never
  })
  calls.length = 0
  localStorage.clear()
})

// #1/#22 — карточки (summary) считаются на ТОМ ЖЕ периоде, что и график (forecast)
// #6 — период по умолчанию = 180 (= settings.horizon_days), не 183
describe("(#1/#22/#6) дашборд: summary и forecast на одном периоде", () => {
  it("на старте summary и forecast запрашиваются с horizon=180", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    render(<MemoryRouter><Dashboard /></MemoryRouter>)
    await screen.findByText("Финансовый простор")
    await waitFor(() => {
      expect(calls.some((p) => p === "/summary?horizon=180")).toBe(true)
      expect(calls.some((p) => p === "/forecast?horizon=180")).toBe(true)
    })
    // карточки больше НЕ берутся из беспараметрового /summary
    expect(calls.some((p) => p === "/summary")).toBe(false)
  })

  it("публикует новый горизонт только когда summary и forecast готовы вместе", async () => {
    let resolveSummary!: (value: unknown) => void
    let resolveForecast!: (value: unknown) => void
    vi.mocked(api.get).mockImplementation((path: string) => {
      calls.push(path)
      if (path === "/summary?horizon=180") {
        return new Promise((resolve) => { resolveSummary = resolve }) as never
      }
      if (path === "/forecast?horizon=180") {
        return new Promise((resolve) => { resolveForecast = resolve }) as never
      }
      return Promise.resolve(fixtureFor(path)) as never
    })

    const { default: Dashboard } = await import("@/pages/Dashboard")
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(screen.getByText("Загружаю денежную картину")).toBeInTheDocument()
    resolveSummary(fixtureFor("/summary?horizon=180"))
    await Promise.resolve()
    expect(screen.queryByText("Следующие 6 месяцев закрыты")).not.toBeInTheDocument()

    resolveForecast(fixtureFor("/forecast?horizon=180"))
    expect(await screen.findByText("Следующие 6 месяцев закрыты")).toBeInTheDocument()
  })

  it("после ошибки горизонта показывает восстановление и повторяет запрос", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      calls.push(path)
      if (path === "/summary?horizon=180") return Promise.reject(new Error("summary unavailable")) as never
      return Promise.resolve(fixtureFor(path)) as never
    })

    const { default: Dashboard } = await import("@/pages/Dashboard")
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByRole("heading", { name: "Не удалось загрузить прогноз" })).toBeInTheDocument()

    vi.mocked(api.get).mockImplementation((path: string) => {
      calls.push(path)
      return Promise.resolve(fixtureFor(path)) as never
    })
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }))

    expect(await screen.findByText("Следующие 6 месяцев закрыты")).toBeInTheDocument()
    expect(calls.filter((path) => path === "/summary?horizon=180")).toHaveLength(2)
  })

  it("не выдаёт сбой вторичных данных за нули и позволяет повторить загрузку", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      calls.push(path)
      if (path === "/wishes") return Promise.reject(new Error("wishes unavailable")) as never
      return Promise.resolve(fixtureFor(path)) as never
    })

    const { default: Dashboard } = await import("@/pages/Dashboard")
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText("Следующие 6 месяцев закрыты")).toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "Часть данных не загрузилась" })).toBeInTheDocument()
    expect(screen.queryByText("Уже по карману")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Добавьте мечту" })).not.toBeInTheDocument()

    vi.mocked(api.get).mockImplementation((path: string) => {
      calls.push(path)
      return Promise.resolve(fixtureFor(path)) as never
    })
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку деталей" }))

    expect(await screen.findByText("Уже по карману")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Часть данных не загрузилась" })).not.toBeInTheDocument()
    expect(calls.filter((path) => path === "/wishes")).toHaveLength(2)
  })
})

describe("дашборд возможностей", () => {
  it("начинается с обеспеченного горизонта и свободного ресурса", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    await screen.findByText("Следующие 6 месяцев закрыты")

    expect(screen.getByText("Свободный ресурс")).toBeInTheDocument()
    expect(screen.getByText(/сохраняя подушку на всём горизонте/i)).toBeInTheDocument()
    expect(screen.getByText("Подушка сохраняется")).toBeInTheDocument()
    expect(screen.queryByText("Запаса хватает за горизонт")).not.toBeInTheDocument()
  })

  it("связывает свободный ресурс с доступной мечтой", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    await screen.findByText("MacBook Pro M4 Max")

    expect(screen.getByText("Уже по карману")).toBeInTheDocument()
    expect(calls.some((p) => p === "/wishes")).toBe(true)
  })
})
