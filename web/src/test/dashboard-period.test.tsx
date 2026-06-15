import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { fixtureFor } from "./fixtures"

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
  calls.length = 0
  localStorage.clear()
})

// #1/#22 — карточки (summary) считаются на ТОМ ЖЕ периоде, что и график (forecast)
// #6 — период по умолчанию = 180 (= settings.horizon_days), не 183
describe("(#1/#22/#6) дашборд: summary и forecast на одном периоде", () => {
  it("на старте summary и forecast запрашиваются с horizon=180", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    render(<MemoryRouter><Dashboard /></MemoryRouter>)
    await screen.findByText("Денежная картина")
    await waitFor(() => {
      expect(calls.some((p) => p === "/summary?horizon=180")).toBe(true)
      expect(calls.some((p) => p === "/forecast?horizon=180")).toBe(true)
    })
    // карточки больше НЕ берутся из беспараметрового /summary
    expect(calls.some((p) => p === "/summary")).toBe(false)
  })
})
