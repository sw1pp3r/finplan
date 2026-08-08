import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ONBOARDING_REPLAY_KEY } from "@/lib/onboarding"
import { fixtureFor } from "./fixtures"

vi.mock("@/lib/api", async (original) => {
  const actual = await original<typeof import("@/lib/api")>()
  return {
    ...actual,
    isDemo: () => true,
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

vi.mock("@/components/OnboardingWizard", () => ({
  default: () => <div role="dialog" aria-label="Быстрый прогноз">Мастер открыт</div>,
}))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(ONBOARDING_REPLAY_KEY, "1")
})

describe("повторный запуск онбординга", () => {
  it("явный replay открывает мастер даже поверх изолированного демо-режима", async () => {
    const { default: App } = await import("@/App")
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole("dialog", { name: "Быстрый прогноз" })).toBeInTheDocument()
  })
})
