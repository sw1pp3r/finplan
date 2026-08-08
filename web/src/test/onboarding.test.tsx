import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { fixtureFor } from "./fixtures"
import { ONBOARDING_DRAFT_KEY, resetOnboarding } from "@/lib/onboarding"

vi.mock("@/lib/api", async (original) => {
  const actual = await original<typeof import("@/lib/api")>()
  return {
    ...actual,
    isDemo: () => false,
    setDemo: vi.fn(),
    api: {
      get: vi.fn((path: string) => Promise.resolve(fixtureFor(path))),
      post: vi.fn((path: string) => {
        if (path === "/accounts") return Promise.resolve({ id: 11 })
        if (path === "/inflows") return Promise.resolve({ id: 22 })
        if (path === "/obligations") return Promise.resolve({ id: 33 })
        return Promise.resolve({})
      }),
      patch: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      upload: vi.fn(() => Promise.resolve({})),
    },
  }
})

async function renderWizard(onDone = vi.fn()) {
  const { default: OnboardingWizard } = await import("@/components/OnboardingWizard")
  render(
    <MemoryRouter>
      <OnboardingWizard onDone={onDone} />
    </MemoryRouter>,
  )
  return onDone
}

function startWizard() {
  fireEvent.click(screen.getByRole("button", { name: "Построить мой прогноз" }))
}

function fillAmount(label: string, amount: string) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value: amount } })
}

beforeEach(async () => {
  localStorage.clear()
  const { api } = await import("@/lib/api")
  vi.mocked(api.get).mockClear()
  vi.mocked(api.post).mockClear()
  vi.mocked(api.patch).mockClear()
})

describe("онбординг-мастер", () => {
  it("строит первый прогноз из трёх сумм и сохраняет реальные сущности", async () => {
    const onDone = await renderWizard()
    startWizard()

    expect(await screen.findByRole("heading", { name: "Сколько денег сейчас?" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Базовая валюта" })).toBeInTheDocument()
    fillAmount("Текущий баланс", "10000")
    expect(screen.getAllByText(/Доходы покрывают расходы/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: /Далее/ }))

    expect(await screen.findByRole("heading", { name: "Сколько обычно приходит в месяц?" })).toBeInTheDocument()
    fillAmount("Доходы в месяц", "3000")
    fireEvent.click(screen.getByRole("button", { name: /Далее/ }))

    expect(await screen.findByRole("heading", { name: "Сколько обязательно уходит в месяц?" })).toBeInTheDocument()
    fillAmount("Расходы в месяц", "2000")
    fireEvent.click(screen.getByRole("button", { name: /Показать прогноз/ }))

    expect(await screen.findByText("Первый прогноз готов")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Доходы покрывают обязательный ритм" })).toBeInTheDocument()

    const { api } = await import("@/lib/api")
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/accounts",
        expect.objectContaining({ name: "Основной баланс", currency: expect.any(String) }),
      )
      expect(api.post).toHaveBeenCalledWith(
        "/snapshots",
        expect.objectContaining({ items: [{ account_id: 11, amount: 10000 }] }),
      )
      expect(api.post).toHaveBeenCalledWith(
        "/inflows",
        expect.objectContaining({ amount: 3000, recurrence: "monthly" }),
      )
      expect(api.post).toHaveBeenCalledWith(
        "/obligations",
        expect.objectContaining({ amount: 2000, recurrence: "monthly" }),
      )
    })

    fireEvent.click(screen.getByRole("button", { name: /Открыть прогноз/ }))
    expect(onDone).toHaveBeenCalledWith("completed")
  })

  it("открывает демо, не помечая мастер завершённым", async () => {
    const onDone = await renderWizard()
    fireEvent.click(screen.getByRole("button", { name: "Посмотреть демо" }))
    expect(onDone).toHaveBeenCalledWith("demo")
  })

  it("возобновляет сохранённый шаг вместо возврата на приветствие", async () => {
    localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({
      version: 3,
      phase: "wizard",
      step: 2,
      startedAt: Date.now() - 10_000,
      base: "KZT",
      accounts: [{ key: 1, serverId: 11, name: "Основной баланс", currency: "KZT", balance: 500000 }],
      income: [{ key: 2, name: "Регулярный доход", currency: "KZT", amount: 0 }],
      expenses: [{ key: 3, name: "Ежемесячные расходы", currency: "KZT", amount: 0 }],
      detailedAccounts: false,
      detailedIncome: false,
      detailedExpenses: false,
    }))

    await renderWizard()

    expect(screen.queryByRole("button", { name: "Построить мой прогноз" })).not.toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "Сколько обычно приходит в месяц?" })).toBeInTheDocument()
    expect(screen.getAllByText(/₸500/).length).toBeGreaterThan(0)
  })

  it("при повторном запуске подставляет существующие данные и обновляет их", async () => {
    resetOnboarding()
    await renderWizard()

    const replayButton = await screen.findByRole("button", { name: "Обновить мой прогноз" })
    fireEvent.click(replayButton)
    expect(await screen.findByRole("heading", { name: "Сколько денег сейчас?" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Название счёта 1" })).toHaveValue("Wise")
    expect(screen.getAllByRole("textbox", { name: "Остаток счёта 1" })[0]).toHaveValue("9 200")
    fireEvent.click(screen.getByRole("button", { name: /Далее/ }))

    expect(await screen.findByRole("heading", { name: "Сколько обычно приходит в месяц?" })).toBeInTheDocument()
    const { api } = await import("@/lib/api")
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        "/accounts/1",
        expect.objectContaining({ name: "Wise", currency: "USD" }),
      )
      expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === "/accounts")).toHaveLength(0)
    })
  })

  it("при возврате обновляет созданный счёт, а не создаёт дубль", async () => {
    await renderWizard()
    startWizard()
    fillAmount("Текущий баланс", "10000")
    fireEvent.click(screen.getByRole("button", { name: /Далее/ }))
    expect(await screen.findByRole("heading", { name: "Сколько обычно приходит в месяц?" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Назад" }))
    expect(await screen.findByRole("heading", { name: "Сколько денег сейчас?" })).toBeInTheDocument()
    fillAmount("Текущий баланс", "12000")
    fireEvent.click(screen.getByRole("button", { name: /Далее/ }))

    const { api } = await import("@/lib/api")
    await waitFor(() => {
      const accountCreates = vi.mocked(api.post).mock.calls.filter(([path]) => path === "/accounts")
      expect(accountCreates).toHaveLength(1)
      expect(api.patch).toHaveBeenCalledWith(
        "/accounts/11",
        expect.objectContaining({ name: "Основной баланс" }),
      )
    })
  })

  it("после пропуска трёх вопросов честно сообщает, чего не хватает", async () => {
    await renderWizard()
    startWizard()
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(await screen.findByRole("button", { name: "Пока не знаю" }))
    }

    expect(await screen.findByRole("heading", { name: "Для прогноза не хватает одной цифры" })).toBeInTheDocument()
    expect(screen.getByText(/не будет притворяться/)).toBeInTheDocument()
    expect(screen.queryByText("Первый прогноз готов")).not.toBeInTheDocument()
  })

  it("подписывает поля детализации и скроллит собственный main", async () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    })
    await renderWizard()
    startWizard()
    fireEvent.click(screen.getByRole("button", { name: "Разбить сумму по счетам" }))

    expect(screen.getByRole("textbox", { name: "Название счёта 1" })).toBeInTheDocument()
    expect(screen.getAllByRole("combobox", { name: "Валюта счёта 1" }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("textbox", { name: "Остаток счёта 1" }).length).toBeGreaterThan(0)
    expect(scrollTo).toHaveBeenCalled()
  })
})
