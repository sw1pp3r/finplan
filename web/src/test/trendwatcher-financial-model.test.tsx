import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TrendWatcherFinancialModel } from "@/components/services/TrendWatcherFinancialModel"
import type { ServiceSummary } from "@/lib/api"
import { fixtures } from "./fixtures"

const summary = fixtures["/services/1/summary"] as ServiceSummary
const draftProps = () => ({
  onDraftPreview: vi.fn().mockResolvedValue(summary),
  onDraftApply: vi.fn().mockResolvedValue(summary),
})

describe("TrendWatcher financial model", () => {
  beforeEach(() => window.localStorage.clear())

  it("разделяет портфель, сценарий нагрузки и чистую юнит-экономику", () => {
    const onConfig = vi.fn()
    const onTariffClients = vi.fn()
    render(
      <TrendWatcherFinancialModel
        summary={summary}
        onConfig={onConfig}
        {...draftProps()}
        onTariffClients={onTariffClients}
      />,
    )

    expect(screen.getByRole("heading", { name: "Состав портфеля" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Сценарная матрица" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Чистая юнит-экономика" })).toBeInTheDocument()
    expect(screen.getByRole("spinbutton", { name: "Клиенты Managed" })).toHaveValue(10)
    expect(screen.getByRole("spinbutton", { name: "Клиенты BYO keys" })).toHaveValue(0)
    expect(screen.getByText(/до required income/i)).toBeInTheDocument()
    expect(screen.getByText(/Allowance не входит в COGS/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Следующее пополнение/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Gross margin/i).length).toBeGreaterThan(0)
    expect(screen.getByRole("heading", { name: "Growth unit economics" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Managed · ключи сервиса" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "BYO keys · ключи клиента" })).toBeInTheDocument()
    expect(screen.queryByText("−0 USD")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Увеличить клиентов Managed" }))
    expect(onTariffClients).toHaveBeenCalledWith(1, 11)

    fireEvent.click(screen.getByRole("button", { name: "Активировать Low · запуск" }))
    expect(onConfig).toHaveBeenCalledWith({ active_scenario: "low" })
  })

  it("раскрывает операционные драйверы только по запросу", () => {
    render(
      <TrendWatcherFinancialModel
        summary={summary}
        onConfig={vi.fn()}
        {...draftProps()}
        onTariffClients={vi.fn()}
      />,
    )

    expect(screen.queryByRole("spinbutton", { name: "Instagram аккаунтов" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))
    expect(screen.getByRole("spinbutton", { name: "Instagram аккаунтов" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "LLM и outcomes" }))
    expect(screen.getByRole("spinbutton", { name: "Новых видео для LLM-аннотации" })).toBeInTheDocument()
    fireEvent.click(screen.getByText("Дополнительные workflow-параметры"))
    expect(screen.getByRole("spinbutton", { name: "Retry / fallback reserve, %" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Коммерческие допущения" }))
    expect(screen.getByRole("spinbutton", { name: "Payment fee, %" })).toBeInTheDocument()
    expect(screen.getByRole("spinbutton", { name: "Monthly churn, %" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "YouTube" }))
    expect(screen.getByText(/Quota показывается как лимит/i)).toBeInTheDocument()
  })

  it("применяет официальный Business pack одной атомарной draft-операцией", async () => {
    const onConfig = vi.fn()
    const onDraftApply = vi.fn().mockResolvedValue(summary)
    render(
      <TrendWatcherFinancialModel
        summary={summary}
        onConfig={onConfig}
        onDraftPreview={vi.fn().mockResolvedValue(summary)}
        onDraftApply={onDraftApply}
        onTariffClients={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))
    fireEvent.click(screen.getByRole("button", { name: "Ставки провайдеров" }))
    fireEvent.click(screen.getByRole("button", { name: "Business · $497 / 500k" }))
    fireEvent.click(screen.getByRole("button", { name: "Применить 3 изменения" }))

    await waitFor(() => expect(onDraftApply).toHaveBeenCalledWith({
      scenario_key: "base",
      config: {
        scrapecreators_pack_price_usd: 497,
        scrapecreators_pack_credits: 500_000,
        scrapecreators_price_per_1000: 0.994,
      },
      drivers: {},
    }))
    expect(onConfig).not.toHaveBeenCalled()
  })

  it("показывает изменение маржи в процентных пунктах, а денег — с валютой", async () => {
    const preview = structuredClone(summary)
    const baselineEconomics = summary.trendwatcher!.active.economics
    preview.trendwatcher!.active.economics.provider_monthly_base = baselineEconomics.provider_monthly_base - 10
    preview.trendwatcher!.active.economics.operating_profit_base = baselineEconomics.operating_profit_base + 10
    preview.trendwatcher!.active.economics.gross_margin_pct = baselineEconomics.gross_margin_pct! + 0.021
    render(
      <TrendWatcherFinancialModel
        summary={summary}
        onConfig={vi.fn()}
        onDraftPreview={vi.fn().mockResolvedValue(preview)}
        onDraftApply={vi.fn().mockResolvedValue(preview)}
        onTariffClients={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "Instagram аккаунтов" }), {
      target: { value: "12" },
    })

    expect(await screen.findByText(/п\.п\./)).toHaveTextContent("+2.1 п.п.")
    const impact = screen.getByRole("heading", { name: "Влияние на модель" }).closest("aside")!
    expect(within(impact).getByText("−10 USD")).toBeInTheDocument()
    expect(within(impact).getByText("+10 USD")).toBeInTheDocument()
  })

  it("останавливает невалидный outcome driver до preview и apply", () => {
    const onDraftPreview = vi.fn().mockResolvedValue(summary)
    render(
      <TrendWatcherFinancialModel
        summary={summary}
        onConfig={vi.fn()}
        onDraftPreview={onDraftPreview}
        onDraftApply={vi.fn().mockResolvedValue(summary)}
        onTariffClients={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))
    fireEvent.click(screen.getByRole("button", { name: "LLM и outcomes" }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "Outcome checks D0/D1/D2/D7" }), {
      target: { value: "5" },
    })

    expect(screen.getByText("Максимум 4")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Применить 0 изменений" })).toBeDisabled()
    expect(onDraftPreview).not.toHaveBeenCalled()
  })

  it("показывает usage по доменам и отличает устаревший источник от допущения", () => {
    const staleSummary = structuredClone(summary)
    staleSummary.trendwatcher!.pricing_sources.scrapecreators.checked_on = "2025-01-01"
    render(
      <TrendWatcherFinancialModel
        summary={staleSummary}
        onConfig={vi.fn()}
        {...draftProps()}
        onTariffClients={vi.fn()}
      />,
    )

    expect(screen.getByText("есть источник старше 90 дней")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))
    expect(screen.getByText(/2.*766 credits/)).toBeInTheDocument()
    expect(screen.getByText(/2.*242 units · quota, не COGS/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Ставки провайдеров" }))
    expect(screen.getByText("Наблюдаемое состояние")).toBeInTheDocument()
    expect(screen.getByText("Проверка устарела")).toBeInTheDocument()
    expect(screen.getByText("Допущение")).toBeInTheDocument()
  })

  it("выбирает тариф для анализа без изменения состава портфеля", () => {
    const onTariffClients = vi.fn()
    render(
      <TrendWatcherFinancialModel
        summary={summary}
        onConfig={vi.fn()}
        {...draftProps()}
        onTariffClients={onTariffClients}
      />,
    )

    fireEvent.change(screen.getByRole("combobox", { name: "Тариф для юнит-экономики" }), {
      target: { value: "2" },
    })

    expect(onTariffClients).not.toHaveBeenCalled()
    expect(screen.getByText(/BYO keys · ключи клиента · 1 клиент/i)).toBeInTheDocument()
  })

  it("показывает decision summary, компактный P&L и детализацию по запросу", () => {
    render(
      <TrendWatcherFinancialModel
        summary={summary}
        onConfig={vi.fn()}
        {...draftProps()}
        onTariffClients={vi.fn()}
      />,
    )

    expect(screen.getByRole("status", { name: "Вывод по сценарию" })).toHaveTextContent(
      /Base.*726.*75%.*сверх.*3\.438.*141/i,
    )
    expect(screen.queryByText("Operating margin")).not.toBeInTheDocument()
    expect(screen.getAllByText(/30 IG.*30 TT.*ежедневно/i)).toHaveLength(3)

    fireEvent.click(screen.getByRole("button", { name: "Показать детализацию P&L" }))
    expect(screen.getByText("Operating margin")).toBeInTheDocument()
    expect(screen.getByText(/Break-even · Managed/i)).toBeInTheDocument()
  })

  it("показывает waterfall, target margin и sensitivity по клиентам", () => {
    render(
      <TrendWatcherFinancialModel
        summary={summary}
        onConfig={vi.fn()}
        {...draftProps()}
        onTariffClients={vi.fn()}
      />,
    )

    const unit = screen.getByRole("region", { name: "Чистая юнит-экономика" })
    expect(within(unit).getByText("Цена")).toBeInTheDocument()
    expect(within(unit).getByText("Provider")).toBeInTheDocument()
    expect(within(unit).getByText("Support / прочие")).toBeInTheDocument()
    expect(within(unit).getByText("Payment")).toBeInTheDocument()
    expect(within(unit).getByText("Contribution")).toBeInTheDocument()
    expect(within(unit).getByText("Fixed")).toBeInTheDocument()
    expect(within(unit).getByText("Unit profit")).toBeInTheDocument()
    expect(screen.getByRole("spinbutton", { name: "Целевая unit margin" })).toHaveValue(60)
    expect(screen.getByText(/Минимальная цена/i).closest("div")).toHaveTextContent("65.908")
    expect(screen.getByText(/Лимит provider COGS/i).closest("div")).toHaveTextContent("27.6")

    const sensitivity = screen.getByRole("table", { name: "Sensitivity по числу клиентов" })
    expect(within(sensitivity).getByRole("columnheader", { name: "1 клиент" })).toBeInTheDocument()
    expect(within(sensitivity).getByRole("columnheader", { name: "5 клиентов" })).toBeInTheDocument()
    expect(within(sensitivity).getByRole("columnheader", { name: "10 клиентов" })).toBeInTheDocument()
    expect(within(sensitivity).getByRole("columnheader", { name: "25 клиентов" })).toBeInTheDocument()
    expect(within(sensitivity).getByText("726.368 USD")).toBeInTheDocument()
  })

  it("сбрасывает только текущий домен и сохраняет локальный журнал изменений", async () => {
    const onDraftApply = vi.fn().mockResolvedValue(summary)
    render(
      <TrendWatcherFinancialModel
        summary={summary}
        onConfig={vi.fn()}
        onDraftPreview={vi.fn().mockResolvedValue(summary)}
        onDraftApply={onDraftApply}
        onTariffClients={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Операционные драйверы и допущения" }))
    const accounts = screen.getByRole("spinbutton", { name: "Instagram аккаунтов" })
    fireEvent.change(accounts, { target: { value: "12" } })
    expect(screen.getByText("Было 30 → станет 12")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Сбросить Instagram" }))
    expect(accounts).toHaveValue(30)

    fireEvent.change(accounts, { target: { value: "12" } })
    fireEvent.click(screen.getByRole("button", { name: "Применить 1 изменение" }))
    await waitFor(() => expect(onDraftApply).toHaveBeenCalled())
    expect(screen.getByRole("heading", { name: "Последние изменения" })).toBeInTheDocument()
    expect(screen.getByText(/Instagram аккаунтов: 30 → 12/)).toBeInTheDocument()
    expect(screen.getByLabelText("Главный provider-драйвер: TikTok · обновления")).toBeInTheDocument()
  })
})
