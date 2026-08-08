import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
      patch: vi.fn((path: string) => Promise.resolve(
        path.endsWith("/trendwatcher/draft")
          ? fixtureFor("/services/1/summary")
          : {},
      )),
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
    expect(await screen.findByRole("heading", { name: "Финансовый простор" })).toBeInTheDocument()
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
    expect(screen.getAllByRole("link", { name: "Сервисы" })
      .some((link) => link.classList.contains("shrink-0"))).toBe(true)
  })

  it("дашборд оставляет одно контекстное действие и позитивную денежную иерархию", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)

    expect(await screen.findByRole("heading", { name: "Финансовый простор" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Дашборд" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Добавить поступление" })).toHaveAttribute("href", "/income")
    expect(screen.queryByRole("link", { name: "Операция" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Что это за раздел?" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText(/Главная картина денег/)).not.toBeInTheDocument()
    expect(screen.getByText("Свободный ресурс")).toBeInTheDocument()
    expect(screen.getByText("Свободно / мес")).toBeInTheDocument()
    expect(screen.getByText("Ожидается / 30 дней")).toBeInTheDocument()
    expect(screen.getByText("Уже по карману")).toBeInTheDocument()
  })

  it("дашборд раскрывает сценарии по запросу и сворачивает дублирующие детали", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)

    const scenarios = await screen.findByRole("button", { name: "Сравнить сценарии" })
    expect(scenarios).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: "Оптимистичный" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Осторожный" })).not.toBeInTheDocument()

    fireEvent.click(scenarios)
    expect(screen.getByRole("button", { name: "Оптимистичный" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Осторожный" })).toBeInTheDocument()

    expect(screen.getByRole("heading", { name: "Движение ближайших 30 дней" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Все поступления" })).toHaveAttribute("href", "/income")
    expect(screen.getByRole("link", { name: "Все обязательства" })).toHaveAttribute("href", "/expenses")
    expect(screen.queryByRole("heading", { name: "Счета" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Куда уходят деньги" })).not.toBeInTheDocument()
  })

  it("дашборд при неполном горизонте предлагает укрепить план без тревожной подачи", async () => {
    const { api } = await import("@/lib/api")
    vi.mocked(api.get).mockImplementation((path: string) => {
      const data = structuredClone(fixtureFor(path)) as Record<string, unknown>
      if (path.startsWith("/summary")) {
        const scenarios = data.scenarios as Record<string, Record<string, unknown>>
        scenarios.base.cushion_breach_date = "2026-09-14"
        scenarios.base.min_total = 1_000
      }
      return Promise.resolve(data) as never
    })

    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)

    expect(await screen.findByRole("link", { name: "Укрепить план" })).toHaveAttribute("href", "/income")
    expect(screen.getByText("План можно усилить")).toBeInTheDocument()
    expect(screen.getByText(/Чтобы сохранить подушку на всём горизонте/)).toBeInTheDocument()
    expect(screen.queryByText(/риск|опасност/i)).not.toBeInTheDocument()

    vi.mocked(api.get).mockImplementation((path: string) => {
      getCalls.push(path)
      return Promise.resolve(fixtureFor(path)) as never
    })
  })

  it("дашборд не обещает обеспеченный горизонт по устаревшему снимку", async () => {
    const { api } = await import("@/lib/api")
    vi.mocked(api.get).mockImplementation((path: string) => {
      const data = structuredClone(fixtureFor(path)) as Record<string, unknown>
      if (path.startsWith("/summary")) data.snapshot_stale = true
      return Promise.resolve(data) as never
    })

    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)

    expect(await screen.findByText("Обновите остатки")).toBeInTheDocument()
    expect(screen.getByText("Картина возможностей уточняется")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Обновить баланс" })).toHaveAttribute("href", "/balance")
    expect(screen.queryByText("Следующие 6 месяцев закрыты")).not.toBeInTheDocument()
    expect(screen.queryByText("Уже по карману")).not.toBeInTheDocument()
  })

  it("дашборд не считает ресурс полным, пока не хватает курса", async () => {
    const { api } = await import("@/lib/api")
    vi.mocked(api.get).mockImplementation((path: string) => {
      const data = structuredClone(fixtureFor(path)) as Record<string, unknown>
      if (path.startsWith("/summary")) data.missing_rates = ["EUR"]
      return Promise.resolve(data) as never
    })

    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)

    expect(await screen.findByText("Нужны все курсы")).toBeInTheDocument()
    expect(screen.getByText("Картина возможностей уточняется")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Добавить курс" })).toHaveAttribute("href", "/settings")
    expect(screen.queryByText("Следующие 6 месяцев закрыты")).not.toBeInTheDocument()
    expect(screen.queryByText("Уже по карману")).not.toBeInTheDocument()
  })

  it("дашборд не возвращает просроченный разовый платёж в ближайшее движение", async () => {
    const { api } = await import("@/lib/api")
    vi.mocked(api.get).mockImplementation((path: string) => {
      const data = structuredClone(fixtureFor(path)) as Record<string, unknown>
      if (path.startsWith("/summary")) {
        const scenarios = data.scenarios as Record<string, Record<string, unknown>>
        scenarios.base.cushion_breach_date = "2026-09-14"
      }
      if (path === "/obligations") {
        return Promise.resolve([
          {
            id: 91, name: "Старый долг", amount: 50_000, paid_amount: 0, remaining_amount: 50_000,
            currency: "USD", due_date: "2020-01-01", recurrence: "once", recurrence_end: null,
            status: "planned", category: "Прочее", note: null,
          },
          {
            id: 92, name: "Будущий платёж", amount: 1_000, paid_amount: 0, remaining_amount: 1_000,
            currency: "USD", due_date: "2026-08-01", recurrence: "once", recurrence_end: null,
            status: "planned", category: "Прочее", note: null,
          },
        ]) as never
      }
      return Promise.resolve(data) as never
    })

    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)

    await screen.findByRole("heading", { name: "Движение ближайших 30 дней" })
    expect(screen.queryByText("Старый долг")).not.toBeInTheDocument()
    expect(screen.queryByText(/Сильнее всего влияет/)).not.toBeInTheDocument()

    vi.mocked(api.get).mockImplementation((path: string) => {
      getCalls.push(path)
      return Promise.resolve(fixtureFor(path)) as never
    })
  })

  it("дашборд без первого снимка честно приглашает создать финансовый простор", async () => {
    const { api } = await import("@/lib/api")
    vi.mocked(api.get).mockImplementation((path: string) => {
      const data = structuredClone(fixtureFor(path)) as Record<string, unknown>
      if (path.startsWith("/summary")) {
        data.t0 = 0
        data.last_snapshot_date = null
      }
      return Promise.resolve(data) as never
    })

    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)

    expect(await screen.findByText("Нужен стартовый баланс")).toBeInTheDocument()
    expect(screen.getByText(/Добавьте актуальный баланс/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Записать баланс" })).toHaveAttribute("href", "/balance")
    expect(screen.queryByText("Большой запас")).not.toBeInTheDocument()

    vi.mocked(api.get).mockImplementation((path: string) => {
      getCalls.push(path)
      return Promise.resolve(fixtureFor(path)) as never
    })
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

  it("детали частичной оплаты переносятся и не залезают под статус на узкой ширине", async () => {
    const { default: Plans } = await import("@/pages/Plans")
    renderAt(<Plans />, "/expenses")

    const paymentDetails = await screen.findByText("из 1 500 · оплачено 600")
    expect(paymentDetails).toHaveClass("whitespace-normal")
    expect(paymentDetails).not.toHaveClass("whitespace-nowrap")
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

  it("диалог оплаты возвращает фокус на вызвавшую его кнопку", async () => {
    const { default: Plans } = await import("@/pages/Plans")
    renderAt(<Plans />, "/expenses")
    const pay = await screen.findByRole("button", { name: "Отметить расход оплаченным" })
    pay.focus()

    fireEvent.click(pay)
    fireEvent.click(screen.getByRole("button", { name: "Закрыть диалог" }))

    await waitFor(() => expect(pay).toHaveFocus())
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

  it("действия в плотных таблицах видимы на touch-экранах и доступны с клавиатуры", async () => {
    const { default: Course } = await import("@/pages/Course")
    renderAt(<Course />, "/course")

    const [remove] = await screen.findAllByRole("button", { name: /^Удалить тариф / })
    expect(remove).toHaveClass("opacity-100", "lg:opacity-0", "focus-visible:opacity-100", "sticky", "touch-target")
  })

  it("Курс даёт destructive actions контекст строки", async () => {
    const { default: Course } = await import("@/pages/Course")
    renderAt(<Course />, "/course")

    expect(await screen.findByRole("button", { name: "Удалить тариф Базовый" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Удалить расход Реклама" })).toBeInTheDocument()
  })

  it("Сервисы используют тот же видимый touch-action для удаления", async () => {
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/services")

    fireEvent.click(await screen.findByRole("button", {
      name: "Расширенная модель: тарифы и статьи COGS",
    }))
    const [remove] = await screen.findAllByRole("button", { name: /^Удалить тариф / })
    expect(remove).toHaveClass("opacity-100", "lg:opacity-0", "sticky", "touch-target")
  })

  it("Сервисы явно отделяют песочницу от основного cash-flow прогноза", async () => {
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/services")

    expect(await screen.findByText("Песочница юнит-экономики.")).toBeInTheDocument()
    expect(screen.getByText(/не меняют основной cash-flow прогноз/)).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Выбранный сервис" })).toBeInTheDocument()
  })

  it("TrendWatcher ведёт с финансовой матрицы, а операционную детализацию раскрывает отдельно", async () => {
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/services")

    expect(await screen.findByRole("heading", { name: "Сценарная матрица" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Чистая юнит-экономика" })).toBeInTheDocument()
    expect(screen.getByText(/Allowance не входит в COGS/)).toBeInTheDocument()
    expect(screen.getByText(/Следующее пополнение/)).toBeInTheDocument()
    expect(screen.queryByRole("spinbutton", { name: "Credits на radar-запуск" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))
    fireEvent.click(screen.getByText("Дополнительные параметры Instagram"))
    expect(screen.getByRole("spinbutton", { name: "Credits на radar-запуск" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "TikTok" }))
    fireEvent.click(screen.getByText("Дополнительные параметры TikTok"))
    expect(screen.getByRole("spinbutton", { name: "Credits на discovery-запуск" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "YouTube" }))
    expect(screen.getByText("Немонетарные дневные лимиты")).toBeInTheDocument()
  })

  it("TrendWatcher держит изменения в draft и применяет их одним атомарным запросом", async () => {
    const { api } = await import("@/lib/api")
    vi.mocked(api.post).mockImplementation((path: string) => Promise.resolve(
      path.endsWith("/trendwatcher/draft/preview")
        ? fixtureFor("/services/1/summary")
        : {},
    ) as never)
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/services")

    await screen.findByRole("heading", { name: "Сценарная матрица" })
    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))
    const field = await screen.findByRole("spinbutton", { name: "Instagram аккаунтов" })
    fireEvent.change(field, { target: { value: "12" } })
    fireEvent.blur(field)

    expect(screen.getByText("1 несохранённое изменение")).toBeInTheDocument()
    expect(api.patch).not.toHaveBeenCalledWith(
      "/services/1/trendwatcher/scenarios/base",
      expect.anything(),
    )
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/services/1/trendwatcher/draft/preview",
      expect.objectContaining({
        scenario_key: "base",
        drivers: { instagram_accounts: 12 },
      }),
    ))

    fireEvent.click(screen.getByRole("button", { name: "Применить 1 изменение" }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      "/services/1/trendwatcher/draft",
      expect.objectContaining({
        scenario_key: "base",
        drivers: { instagram_accounts: 12 },
      }),
    ))
  })

  it("TrendWatcher показывает один домен за раз и держит финансовый эффект рядом", async () => {
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/services")

    await screen.findByRole("heading", { name: "Сценарная матрица" })
    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))

    expect(screen.getByRole("button", { name: "Instagram" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("spinbutton", { name: "Instagram аккаунтов" })).toBeInTheDocument()
    expect(screen.queryByRole("spinbutton", { name: "TikTok аккаунтов" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Влияние на модель" })).toBeInTheDocument()
    expect(screen.getByText("Операционная прибыль")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "TikTok" }))
    expect(screen.getByRole("button", { name: "TikTok" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("spinbutton", { name: "TikTok аккаунтов" })).toBeInTheDocument()
    expect(screen.queryByRole("spinbutton", { name: "Instagram аккаунтов" })).not.toBeInTheDocument()
  })

  it("TrendWatcher показывает provenance ставок и отделяет их от коммерческих допущений", async () => {
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/services")

    await screen.findByRole("heading", { name: "Сценарная матрица" })
    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))
    fireEvent.click(screen.getByRole("button", { name: "Ставки провайдеров" }))

    expect(screen.getByRole("link", { name: /ScrapeCreators.*официальный источник/i }))
      .toHaveAttribute("href", "https://scrapecreators.com/#pricing")
    expect(screen.getAllByText(/проверено 23 июля 2026/i).length).toBeGreaterThan(0)
    expect(screen.queryByRole("spinbutton", { name: "Monthly churn, %" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Коммерческие допущения" }))
    expect(screen.getByRole("spinbutton", { name: "Monthly churn, %" })).toBeInTheDocument()
  })

  it("TrendWatcher меняет только число клиентов выбранного тарифа", async () => {
    const { api } = await import("@/lib/api")
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/services")

    await screen.findByRole("heading", { name: "Сценарная матрица" })
    fireEvent.click(screen.getByRole("button", { name: "Увеличить клиентов Managed" }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      "/services/1/tariffs/1",
      { clients: 11 },
    ))
  })

  it("расширенная модель не закрывается после сохранения inline-поля", async () => {
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/services")

    const toggle = await screen.findByRole("button", {
      name: "Расширенная модель: тарифы и статьи COGS",
    })
    fireEvent.click(toggle)
    const clients = screen.getAllByRole("spinbutton", { name: "Клиенты" })[0]
    fireEvent.change(clients, { target: { value: "12" } })
    fireEvent.blur(clients)

    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"))
    expect(screen.getByRole("button", { name: "Добавить тариф" })).toBeInTheDocument()
  })

  it("BYO checkbox и редактор цены занимают отдельные непересекающиеся колонки", async () => {
    const { default: Services } = await import("@/pages/Services")
    renderAt(<Services />, "/services")

    fireEvent.click(await screen.findByRole("button", {
      name: "Расширенная модель: тарифы и статьи COGS",
    }))
    const checkboxes = screen.getAllByRole("checkbox", { name: "BYO" })
    const [checkbox] = checkboxes
    const row = checkbox.closest(".group.grid") as HTMLElement
    const price = within(row).getByRole("spinbutton", { name: "Цена" })

    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).not.toBeChecked()
    expect(checkboxes[1]).toBeChecked()
    expect(checkboxes.every((item) => item.hasAttribute("disabled"))).toBe(true)
    expect(row.style.gridTemplateColumns).toBe(
      "minmax(0,1.4fr) 56px 152px 90px 110px 32px",
    )
    expect(checkbox.closest("label")?.parentElement).toBe(row)
    expect(price.parentElement?.parentElement).toBe(row)
    expect(checkbox.closest("label")).not.toBe(price.parentElement)
  })

  it("Баланс подписывает поля остатка и даты для screen reader", async () => {
    const { default: Snapshot } = await import("@/pages/Snapshot")
    renderAt(<Snapshot />, "/balance")

    expect(await screen.findByRole("textbox", { name: "Текущий остаток — Wise" })).toBeInTheDocument()
    expect(screen.getByLabelText("Дата баланса")).toBeInTheDocument()
  })

  it("Баланс оставляет редкие действия свёрнутыми и даёт клавиатурный вход в историю", async () => {
    const { default: Snapshot } = await import("@/pages/Snapshot")
    renderAt(<Snapshot />, "/balance")

    expect(await screen.findByRole("button", { name: "Что это за раздел?" }))
      .toHaveAttribute("aria-expanded", "false")
    expect(await screen.findByRole("button", { name: "Управлять" }))
      .toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: "Добавить счёт" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Редактировать баланс за 14.06" }))
      .toBeInTheDocument()
  })

  it("Кинозал объявлен модальным диалогом и получает именованную кнопку закрытия", async () => {
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes?view=board")

    fireEvent.click(await screen.findByRole("button", { name: "Кинозал" }))
    expect(screen.getByRole("dialog", { name: "Доска покупок" })).toHaveAttribute("aria-modal", "true")
    expect(screen.getByRole("button", { name: "Закрыть кинозал" })).toBeInTheDocument()
  })

  it("форма покупки называет каждое поле и возвращает фокус на trigger", async () => {
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes")
    const trigger = await screen.findByRole("button", { name: "Добавить покупку" })
    trigger.focus()

    fireEvent.click(trigger)
    expect(screen.getByRole("textbox", { name: "Название покупки" })).toBeInTheDocument()
    expect(screen.getByRole("spinbutton", { name: "Стоимость покупки" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Валюта покупки" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Срок покупки" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Приоритет покупки" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("редактор карточки возвращает фокус на trigger", async () => {
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes")
    const trigger = (await screen.findAllByRole("button", {
      name: /^Редактировать покупку /,
    }))[0]
    trigger.focus()

    fireEvent.click(trigger)
    const dialog = screen.getByRole("dialog", { name: "Редактировать покупку" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }))

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("редактор покупки сохраняет все пользовательские параметры", async () => {
    const { api } = await import("@/lib/api")
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes")

    fireEvent.click((await screen.findAllByRole("button", {
      name: /^Редактировать/,
    }))[0])
    const dialog = screen.getByRole("dialog", { name: "Редактировать покупку" })

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Название покупки" }), {
      target: { value: "MacBook Pro M5" },
    })
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Стоимость покупки" }), {
      target: { value: "3100" },
    })
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Валюта покупки" }))
    fireEvent.click(await screen.findByRole("option", { name: "RUB" }))
    fireEvent.change(within(dialog).getByLabelText("Срок покупки"), {
      target: { value: "2026-12-20" },
    })
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Приоритет покупки" }))
    fireEvent.click(await screen.findByRole("option", { name: "низкий" }))
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Категория покупки" }), {
      target: { value: "Работа" },
    })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Заметка о покупке" }), {
      target: { value: "Нужен для локальных моделей" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить изменения" }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/wishes/1", {
      name: "MacBook Pro M5",
      amount: 3100,
      currency: "RUB",
      target_date: "2026-12-20",
      priority: "low",
      category: "Работа",
      note: "Нужен для локальных моделей",
    }, { feedback: false }))
    expect(within(dialog).getByRole("status")).toHaveTextContent("Изменения сохранены")
  })

  it("справочники Настроек программно называют поля добавления", async () => {
    const { default: Settings } = await import("@/pages/Settings")
    renderAt(<Settings />, "/settings")

    expect(await screen.findByRole("textbox", { name: "Новое значение: Направления дохода" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Новое значение: Категории расходов" })).toBeInTheDocument()
  })

  it("Настройки называют базовую валюту и сворачивают редкие mobile-секции", async () => {
    const { default: Settings } = await import("@/pages/Settings")
    renderAt(<Settings />, "/settings")

    expect(await screen.findByRole("combobox", { name: "Базовая валюта" })).toBeInTheDocument()
    const ratesSection = screen.getByRole("heading", { name: "Валюты и курсы" }).closest("details")
    expect(ratesSection).not.toBeNull()
    expect(ratesSection).not.toHaveAttribute("open")
  })

  it("Дашборд даёт графику имя, а inline links — мобильную hit area", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)

    expect(await screen.findByRole("img", { name: /Прогноз баланса/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Все поступления" })).toHaveClass("min-h-11")
    expect(screen.getByRole("link", { name: "Все обязательства" })).toHaveClass("min-h-11")
  })

  it("фильтр расходов складывается в доступную мобильную строку", async () => {
    const { default: Plans } = await import("@/pages/Plans")
    renderAt(<Plans />, "/expenses")

    const filters = await screen.findByRole("group", { name: "Фильтр расходов" })
    expect(filters).toHaveClass("w-full", "min-[430px]:w-auto")
    expect(screen.getByRole("button", { name: "Активные" }))
      .toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("button", { name: "Все" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Что это за раздел?" }))
      .toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: "Добавить расход" })).toHaveClass("min-h-11")
  })

  it("контекстные подсказки используют расширенную touch-зону", async () => {
    const { InfoHint } = await import("@/components/InfoHint")
    const { SectionHelp } = await import("@/components/SectionHelp")
    render(
      <>
        <InfoHint label="Подсказка поля">Текст</InfoHint>
        <SectionHelp route="/test" title="Раздел">Описание</SectionHelp>
      </>,
    )

    expect(screen.getByRole("button", { name: "Подсказка поля" })).toHaveClass("touch-target")
    expect(screen.getByRole("button", { name: "Скрыть справку" })).toHaveClass("touch-target")
  })
})

describe("дашборд: период завязан на горизонт прогноза", () => {
  it("грузит /forecast?horizon=N и показывает дропдаун периода", async () => {
    const { default: Dashboard } = await import("@/pages/Dashboard")
    renderAt(<Dashboard />)
    await screen.findByRole("heading", { name: "Финансовый простор" })
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

describe("Доходы: явный статус нового поступления", () => {
  it("по умолчанию создаёт ожидаемое даже с прошедшей датой", async () => {
    const { api } = await import("@/lib/api")
    const { default: Income } = await import("@/pages/Income")
    renderAt(<Income />, "/income")
    await screen.findAllByText(/Доходы/)

    fireEvent.click(screen.getByRole("button", { name: "Добавить доход" }))
    const status = screen.getByRole("group", { name: "Статус нового дохода" })
    expect(status.closest("form")).toHaveClass("max-[980px]:grid-cols-2")
    expect(within(status).getByRole("button", { name: "Ожидается" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Повторяемость дохода")).toBeInTheDocument()
    expect(screen.getByLabelText("Уверенность дохода")).toBeInTheDocument()

    const amount = screen.getByPlaceholderText("0")
    fireEvent.change(amount, { target: { value: "1200" } })
    fireEvent.change(screen.getByLabelText("Ожидаемая дата"), { target: { value: "2026-06-01" } })
    fireEvent.submit(amount.closest("form")!)

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/inflows",
      expect.objectContaining({
        amount: 1200,
        currency: "USD",
        expected_date: "2026-06-01",
      }),
    ))
  })

  it("явно добавляет полученный сегодня доход и упрощает форму", async () => {
    const { api } = await import("@/lib/api")
    const { default: Income } = await import("@/pages/Income")
    renderAt(<Income />, "/income")
    await screen.findAllByText(/Доходы/)

    fireEvent.click(screen.getByRole("button", { name: "Добавить доход" }))
    const status = screen.getByRole("group", { name: "Статус нового дохода" })
    fireEvent.click(within(status).getByRole("button", { name: "Получено" }))

    expect(screen.queryByLabelText("Повторяемость дохода")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Уверенность дохода")).not.toBeInTheDocument()
    const fields = screen.getByRole("group", { name: "Поля полученного дохода" })
    expect(fields).toHaveClass("lg:grid-cols-[minmax(240px,1fr)_minmax(260px,0.9fr)_220px_170px]")

    const name = within(fields).getByRole("textbox", { name: "Название дохода" })
    expect(name).toBeRequired()
    fireEvent.change(name, { target: { value: "Консультация" } })

    const direction = within(fields).getByRole("group", { name: "Направление дохода" })
    fireEvent.click(within(direction).getByRole("combobox"))
    fireEvent.click(await screen.findByRole("option", { name: "проекты" }))

    const date = screen.getByLabelText("Дата получения")
    const now = new Date()
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-")
    expect(date).toHaveAttribute("max", today)
    expect(date).not.toHaveClass("lg:col-start-5")

    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "3000" } })
    fireEvent.click(screen.getByRole("button", { name: "Добавить полученный доход" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/income",
      expect.objectContaining({
        amount: 3000,
        currency: "USD",
        name: "Консультация",
        direction: "проекты",
        received_date: today,
      }),
    ))
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

  it("Доходы начинают с ожидаемых денег и прячут историческую аналитику", async () => {
    const { default: Income } = await import("@/pages/Income")
    renderAt(<Income />, "/income")

    expect(await screen.findByText("План поступлений")).toBeInTheDocument()
    expect(screen.queryByText("Итого с будущими")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Ожидается" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Что это за раздел?" }))
      .toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: "Показать аналитику полученных доходов" }))
      .toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("По направлениям")).not.toBeInTheDocument()
    expect(screen.queryByText("Вероятность будущих")).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: "под вопросом" })).not.toBeInTheDocument()
    expect(screen.getAllByText("11 620 USD")).toHaveLength(1)
    expect(screen.getByText("Если придёт всё")).toBeInTheDocument()
    expect(screen.getAllByLabelText("Действия с доходом")[0])
      .toHaveClass("lg:bg-card-2")
  })
})

describe("Курс: сначала решение о запуске, затем модель", () => {
  it("ведёт с чистой прибыли и прячет справку, а не показывает пять равных KPI", async () => {
    const { default: Course } = await import("@/pages/Course")
    renderAt(<Course />, "/course")

    expect(await screen.findByRole("heading", { name: "Курс" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Запуск курса" })).not.toBeInTheDocument()
    expect(screen.getByText("Запуск покрывает финансовый минимум")).toBeInTheDocument()
    expect(screen.getByText("Прибыль в месяц")).toBeInTheDocument()
    expect(screen.queryByText(/vs breakeven/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Что это за раздел?" }))
      .toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("combobox", { name: "Периодичность потока" }))
      .toHaveClass("min-h-11")
    expect(screen.getByRole("button", { name: "Добавить тариф" }))
      .toHaveClass("min-h-11")
  })

  it("не удаляет строку модели без явного подтверждения", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false)
    const { api } = await import("@/lib/api")
    const { default: Course } = await import("@/pages/Course")
    renderAt(<Course />, "/course")

    fireEvent.click((await screen.findAllByRole("button", { name: /^Удалить тариф / }))[0])

    expect(confirm).toHaveBeenCalledWith("Удалить тариф из модели курса?")
    expect(api.delete).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})

describe("Покупки: переключатель Список/Доска через ?view=", () => {
  it("список по умолчанию", async () => {
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes")
    expect(await screen.findByText(/Список покупок/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Что это за раздел?" }))
      .toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: /Добавить покупку/ })).toHaveClass("min-h-11")
    expect(screen.getByRole("button", { name: "Список" })).toHaveAttribute("aria-pressed", "true")
  })

  it("при создании по умолчанию автоматически подбирает картинку", async () => {
    const { api } = await import("@/lib/api")
    vi.mocked(api.post).mockImplementation((path: string) => Promise.resolve(
      path === "/wishes"
        ? { id: 77 }
        : path === "/wishes/77/image/auto"
          ? { ok: true, image_url: "/wish-images/77-auto.jpg", image_source: "ov:test" }
          : {},
    ))
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes")

    fireEvent.click(await screen.findByRole("button", { name: "Добавить покупку" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Название покупки" }), {
      target: { value: "Путешествие в Японию" },
    })
    fireEvent.change(screen.getByRole("spinbutton", { name: "Стоимость покупки" }), {
      target: { value: "5000" },
    })

    expect(screen.getByRole("checkbox", { name: "Подобрать картинку автоматически" }))
      .toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/wishes/77/image/auto",
        {},
        { feedback: false },
      )
    })
  })

  it("редактор карточки подбирает другую картинку без ручной ссылки", async () => {
    const { api } = await import("@/lib/api")
    vi.mocked(api.post).mockResolvedValue({
      ok: true,
      image_url: "/wish-images/1-auto.jpg",
      image_source: "ov:test",
    })
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes")

    fireEvent.click((await screen.findAllByRole("button", {
      name: /^Редактировать покупку /,
    }))[0])
    const dialog = screen.getByRole("dialog", { name: "Редактировать покупку" })
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Подобрать картинку автоматически",
    }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/wishes/1/image/auto",
        {},
        { feedback: false },
      )
    })
    expect(screen.getByRole("dialog", { name: "Редактировать покупку" })).toBeInTheDocument()
  })

  it("переносит покупку в отдельную историю", async () => {
    const { api } = await import("@/lib/api")
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes")

    fireEvent.click(await screen.findByRole("button", {
      name: "Отметить покупку MacBook Pro M4 Max как купленную",
    }))

    const dialog = screen.getByRole("alertdialog", { name: "Отметить как купленную?" })
    expect(dialog).toHaveTextContent("MacBook Pro M4 Max")
    expect(dialog).toHaveTextContent("переместится в историю покупок")
    expect(api.post).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "Не сейчас" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", {
      name: "Отметить покупку MacBook Pro M4 Max как купленную",
    }))
    fireEvent.click(screen.getByRole("button", { name: "Да, куплено" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/wishes/1/complete", {}))
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Покупка «MacBook Pro M4 Max» сохранена в истории",
    )
    expect(await screen.findByTestId("wish-celebration")).toHaveTextContent("Покупка отмечена как купленная")
  })

  it("показывает датированную историю и возвращает покупку в активный список", async () => {
    const { api } = await import("@/lib/api")
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes?view=completed")

    expect(await screen.findByRole("heading", { name: "История покупок" })).toBeInTheDocument()
    expect(screen.getByText("Рабочее кресло")).toBeInTheDocument()
    expect(screen.getByText(/20 июня 2026/)).toBeInTheDocument()
    expect(screen.queryByText("Можно позволить сейчас")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Куплено, 1" }))
      .toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByRole("button", { name: "Вернуть покупку Рабочее кресло в активный список" }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/wishes/4/restore", {}))
  })

  it("доска при ?view=board", async () => {
    const { default: Wishes } = await import("@/pages/Wishes")
    renderAt(<Wishes />, "/wishes?view=board")
    expect(await screen.findByText(/Доска покупок/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Доска" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByRole("article")[0]).toHaveClass(
      "row-span-4",
      "sm:row-span-8",
      "[content-visibility:visible]",
      "sm:[content-visibility:auto]",
    )
  })
})
