import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { fixtureFor } from "./fixtures"

vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>()
  return {
    ...actual,
    isDemo: () => false,
    setDemo: vi.fn(),
    api: {
      get: vi.fn((path: string) => Promise.resolve(fixtureFor(path))),
      post: vi.fn(() => Promise.resolve({ id: 1 })),
      patch: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      upload: vi.fn(() => Promise.resolve({})),
    },
  }
})

/** Кликает первую видимую кнопку, текст которой матчит re. */
function clickButton(re: RegExp): boolean {
  const btns = screen.queryAllByRole("button")
  const target = btns.find((b) => re.test(b.textContent || ""))
  if (target) {
    fireEvent.click(target)
    return true
  }
  // некоторые «кнопки» — ссылки <a>
  const links = screen.queryAllByRole("link")
  const link = links.find((b) => re.test(b.textContent || ""))
  if (link) {
    fireEvent.click(link)
    return true
  }
  return false
}

describe("онбординг-мастер", () => {
  it("приветствие → 5 шагов с пресетами валют → финал ведёт на дашборд", async () => {
    const { default: OnboardingWizard } = await import("@/components/OnboardingWizard")
    const onDone = vi.fn()
    render(
      <MemoryRouter>
        <OnboardingWizard onDone={onDone} />
      </MemoryRouter>
    )

    // PART A — приветствие
    expect(clickButton(/Настроить под себя/)).toBe(true)

    // шаг 1 — пресеты валют RUB / USD / EUR
    await waitFor(() => {
      expect(screen.getByText("RUB")).toBeInTheDocument()
      expect(screen.getByText("USD")).toBeInTheDocument()
      expect(screen.getByText("EUR")).toBeInTheDocument()
    })

    // проходим шаги до финала (Далее / К результату), затем «Открыть дашборд»
    for (let i = 0; i < 8; i++) {
      if (clickButton(/Открыть дашборд/)) break
      const advanced = clickButton(/Далее|К результату|результат/)
      if (!advanced) break
      // дать ре-рендеру шага примениться
      await waitFor(() => screen.queryAllByRole("button").length > 0)
    }

    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it("«Посмотреть демо» закрывает онбординг (onDone)", async () => {
    const { default: OnboardingWizard } = await import("@/components/OnboardingWizard")
    const onDone = vi.fn()
    render(
      <MemoryRouter>
        <OnboardingWizard onDone={onDone} />
      </MemoryRouter>
    )
    expect(clickButton(/Посмотреть демо/)).toBe(true)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
