import { useEffect, useMemo, useState } from "react"

import { TrendWatcherAssumptionsEditor } from "@/components/services/TrendWatcherAssumptionsEditor"
import type { ServiceSummary, TrendWatcherDraftPayload, TrendWatcherScenario } from "@/lib/api"
import { money } from "@/lib/format"
import {
  buildClientSensitivity,
  calculateTargetEconomics,
  type TrendWatcherTariffEconomics,
} from "@/lib/trendwatcher-model"
import { cn } from "@/lib/utils"

type Props = {
  summary: ServiceSummary
  onConfig: (body: Record<string, unknown>) => void
  onDraftPreview: (body: TrendWatcherDraftPayload) => Promise<ServiceSummary>
  onDraftApply: (body: TrendWatcherDraftPayload) => Promise<ServiceSummary>
  onTariffClients: (tariffId: number, clients: number) => void
}

const SCENARIO_NAME: Record<TrendWatcherScenario["key"], string> = {
  low: "Low · запуск",
  base: "Base · рабочий",
  stress: "Stress · высокая нагрузка",
}

function integer(value: number): string {
  return Math.round(value).toLocaleString("ru-RU").replace(/\u00a0/g, " ")
}

function preciseMoney(value: number, digits = 3): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })
}

function usd(value: number, digits = 3): string {
  return `$${preciseMoney(value, digits)}`
}

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`
}

function signed(value: number, currency: string): string {
  if (Math.abs(value) < 0.000001) return `0 ${currency}`
  return `${value < 0 ? "−" : "+"}${money(Math.abs(value))} ${currency}`
}

function expense(value: number, currency: string): string {
  if (Math.abs(value) < 0.000001) return `0 ${currency}`
  return `−${money(value)} ${currency}`
}

function allowanceStatus(remaining: number, overage: number): string {
  return overage > 0 ? `сверх ${usd(overage)}` : `остаток ${usd(remaining)}`
}

function scenarioDriverSummary(scenario: TrendWatcherScenario): string {
  const ig = scenario.drivers.instagram_accounts ?? 0
  const tt = scenario.drivers.tiktok_accounts ?? 0
  const igRefreshes = scenario.drivers.instagram_refreshes_per_month ?? 0
  const ttRefreshes = scenario.drivers.tiktok_refreshes_per_month ?? 0
  const cadence = igRefreshes === 30 && ttRefreshes === 30
    ? "ежедневно"
    : `${integer(igRefreshes)}× IG · ${integer(ttRefreshes)}× TT`
  return `${integer(ig)} IG · ${integer(tt)} TT · ${cadence}`
}

function Metric({ label, value, sub, tone }: {
  label: string
  value: string
  sub?: string
  tone?: "positive" | "negative"
}) {
  return (
    <div className="min-w-[140px] flex-1 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</div>
      <div className={cn(
        "mt-1 text-[16px] font-semibold tnum",
        tone === "positive" && "text-pos",
        tone === "negative" && "text-neg",
      )}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>}
    </div>
  )
}

function ClientStepper({
  tariff,
  currency,
  onChange,
}: {
  tariff: TrendWatcherTariffEconomics
  currency: string
  onChange: (clients: number) => void
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_132px] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="truncate text-[13px] font-semibold">{tariff.name}</h3>
          <span className="text-[11px] font-medium tnum">{preciseMoney(tariff.price_base)} {currency}</span>
        </div>
        <p className="mt-0.5 text-[10px] text-ink-3">
          {tariff.is_byo ? "Ключи провайдеров приносит клиент" : "Ключи и provider COGS оплачивает сервис"}
        </p>
      </div>
      <span className="flex h-9 overflow-hidden rounded-md border border-input bg-background">
        <button
          type="button"
          aria-label={`Уменьшить клиентов ${tariff.name}`}
          className="w-9 shrink-0 border-r border-line-2 text-base text-ink-2 hover:bg-muted"
          onClick={() => onChange(Math.max(0, tariff.clients - 1))}
        >−</button>
        <input
          key={`${tariff.id}:${tariff.clients}`}
          aria-label={`Клиенты ${tariff.name}`}
          type="number"
          min="0"
          defaultValue={tariff.clients}
          className="min-w-0 flex-1 bg-transparent px-1 text-center text-[13px] font-semibold tnum outline-none"
          onBlur={(event) => {
            const clients = Math.max(0, Math.round(Number(event.currentTarget.value)))
            if (Number.isFinite(clients) && clients !== tariff.clients) onChange(clients)
          }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }}
        />
        <button
          type="button"
          aria-label={`Увеличить клиентов ${tariff.name}`}
          className="w-9 shrink-0 border-l border-line-2 text-base text-ink-2 hover:bg-muted"
          onClick={() => onChange(tariff.clients + 1)}
        >+</button>
      </span>
    </div>
  )
}

export function TrendWatcherFinancialModel({
  summary,
  onConfig,
  onDraftPreview,
  onDraftApply,
  onTariffClients,
}: Props) {
  if (!summary.trendwatcher) return null

  return (
    <FinancialModel
      summary={summary}
      onConfig={onConfig}
      onDraftPreview={onDraftPreview}
      onDraftApply={onDraftApply}
      onTariffClients={onTariffClients}
    />
  )
}

function FinancialModel({
  summary,
  onConfig,
  onDraftPreview,
  onDraftApply,
  onTariffClients,
}: Props) {
  const model = summary.trendwatcher!
  const cur = summary.base_currency
  const activePlanTariffs = model.active.economics.by_tariff.filter((tariff) => tariff.clients > 0)
  const firstManagedId = model.active.economics.by_tariff.find((tariff) => !tariff.is_byo)?.id
    ?? model.active.economics.by_tariff[0]?.id
    ?? 0
  const initialTariffId = activePlanTariffs.length === 1 ? activePlanTariffs[0].id : firstManagedId
  const [selectedTariffId, setSelectedTariffId] = useState(initialTariffId)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [targetMargin, setTargetMargin] = useState(60)

  useEffect(() => {
    if (!model.active.economics.by_tariff.some((tariff) => tariff.id === selectedTariffId)) {
      setSelectedTariffId(firstManagedId)
    }
  }, [firstManagedId, model.active.economics.by_tariff, selectedTariffId])

  const scenarioTariffs = useMemo(() => new Map(
    model.scenarios.map((scenario) => [
      scenario.key,
      scenario.economics.by_tariff.find((tariff) => tariff.id === selectedTariffId),
    ]),
  ), [model.scenarios, selectedTariffId])
  const selectedTariff = model.active.economics.by_tariff.find((tariff) => tariff.id === selectedTariffId)
    ?? model.active.economics.by_tariff[0]
  if (!selectedTariff) return null

  const active = model.active
  const activeEconomics = active.economics
  const activeUsage = active.usage
  const activeCapacity = active.capacity
  const requiredGap = activeEconomics.operating_profit_base - summary.required_monthly_income
  const breakEven = selectedTariff.break_even_clients == null
    ? "—"
    : `${integer(selectedTariff.break_even_clients)} кл.`
  const sensitivity = buildClientSensitivity({
    tariff: selectedTariff,
    scenario: active,
    config: model.config,
    clientCounts: [1, 5, 10, 25],
  })
  const target = calculateTargetEconomics({
    tariff: selectedTariff,
    config: model.config,
    targetMarginPct: targetMargin / 100,
  })

  const coreRows: [string, (scenario: TrendWatcherScenario) => string][] = [
    ["Выручка", (scenario) => `${money(scenario.economics.revenue_monthly_base)} ${cur}`],
    ["Provider COGS", (scenario) => expense(scenario.economics.provider_monthly_base, cur)],
    ["Прочие переменные", (scenario) => expense(
      scenario.economics.generic_variable_monthly_base + scenario.economics.payment_fees_monthly_base,
      cur,
    )],
    ["Contribution", (scenario) => `${money(scenario.economics.contribution_monthly_base)} ${cur}`],
    ["Fixed", (scenario) => expense(scenario.economics.fixed_monthly_base, cur)],
    ["Operating profit", (scenario) => `${money(scenario.economics.operating_profit_base)} ${cur}`],
    ["Gross margin", (scenario) => pct(scenario.economics.gross_margin_pct)],
  ]
  const detailRows: [string, (scenario: TrendWatcherScenario) => string][] = [
    ["Payment fees", (scenario) => expense(scenario.economics.payment_fees_monthly_base, cur)],
    ["Operating margin", (scenario) => pct(scenario.economics.margin_pct)],
    [`Break-even · ${selectedTariff.name}`, (scenario) => {
      const tariff = scenarioTariffs.get(scenario.key)
      return tariff?.break_even_clients == null ? "—" : `${integer(tariff.break_even_clients)} кл.`
    }],
    ["Allowance / Managed-клиент", (scenario) => allowanceStatus(
      scenario.usage.allowance.remaining_usd,
      scenario.usage.allowance.overage_usd,
    )],
  ]

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
      <header className="border-b border-line-2 pb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">TrendWatcher · monthly operating model</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Финансовая модель сервиса</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-ink-2">
          Состав портфеля, сценарии нагрузки и экономика одного тарифа считаются независимо. Allowance сравнивается с usage, но не прибавляется к COGS.
        </p>
      </header>

      <section aria-labelledby="portfolio-title" className="overflow-hidden rounded-lg border border-border">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-2 bg-muted/25 px-3 py-2.5">
          <div>
            <h2 id="portfolio-title" className="text-[14px] font-semibold">Состав портфеля</h2>
            <p className="mt-0.5 text-[10px] text-ink-3">Managed и BYO меняются независимо и вместе формируют MRR.</p>
          </div>
          <span className="text-[11px] text-ink-3">Всего <b className="text-foreground tnum">{summary.clients_total}</b> клиентов</span>
        </div>
        <div className="grid divide-y divide-line-2 md:grid-cols-2 md:divide-x md:divide-y-0">
          {activeEconomics.by_tariff.map((tariff) => (
            <ClientStepper
              key={tariff.id}
              tariff={tariff}
              currency={cur}
              onChange={(clients) => onTariffClients(tariff.id, clients)}
            />
          ))}
        </div>
      </section>

      <div
        role="status"
        aria-label="Вывод по сценарию"
        className={cn(
          "rounded-lg border px-3 py-2.5 text-[12px] leading-5",
          activeEconomics.operating_profit_base >= 0
            ? "border-pos/25 bg-pos-soft/45 text-foreground"
            : "border-neg/25 bg-neg-soft/45 text-foreground",
        )}
      >
        <b>{SCENARIO_NAME[active.key]}:</b>{" "}
        портфель даёт <b className="tnum">{money(activeEconomics.operating_profit_base)} {cur}</b> operating profit
        при <b className="tnum">{pct(activeEconomics.gross_margin_pct)}</b> gross margin; break-even выбранного тарифа — <b>{breakEven}</b>.
        {" "}Allowance — <b>{allowanceStatus(activeUsage.allowance.remaining_usd, activeUsage.allowance.overage_usd)}</b>,
        следующее пополнение — <b>{usd(activeCapacity.next_topup_cash_usd, 2)}</b>.
      </div>

      <div className="flex flex-wrap divide-y divide-line-2 rounded-lg border border-border bg-background/45 sm:divide-x sm:divide-y-0">
        <Metric label="MRR" value={`${money(activeEconomics.revenue_monthly_base)} ${cur}`} sub={`${summary.clients_total} клиентов`} />
        <Metric label="COGS" value={`−${money(activeEconomics.cogs_monthly)} ${cur}`} sub={`provider ${money(activeEconomics.provider_monthly_base)} ${cur}`} tone="negative" />
        <Metric
          label="Operating profit"
          value={signed(activeEconomics.operating_profit_base, cur)}
          sub={`${signed(requiredGap, cur)} до required income`}
          tone={activeEconomics.operating_profit_base >= 0 ? "positive" : "negative"}
        />
        <Metric
          label="Gross margin"
          value={pct(activeEconomics.gross_margin_pct)}
          sub={`operating ${pct(activeEconomics.margin_pct)} · ${SCENARIO_NAME[active.key]}`}
          tone={(activeEconomics.gross_margin_pct ?? -1) >= 0 ? "positive" : "negative"}
        />
      </div>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold">Сценарная матрица</h2>
            <p className="mt-0.5 text-[10px] text-ink-3">Low / Base / Stress меняют workload, но не цены тарифов и не client mix.</p>
          </div>
          <button
            type="button"
            aria-label={detailsOpen ? "Скрыть детализацию P&L" : "Показать детализацию P&L"}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
            className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-ink-2 hover:bg-muted"
          >
            {detailsOpen ? "Скрыть детализацию" : "Показать детализацию"}
          </button>
        </div>
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] border-collapse text-[12px]">
            <thead className="bg-muted/35">
              <tr className="border-b border-line-2">
                <th className="sticky left-0 z-10 w-[31%] bg-muted px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink-3">P&amp;L / месяц</th>
                {model.scenarios.map((scenario) => (
                  <th key={scenario.key} className={cn("px-2 py-1.5 text-right", scenario.key === active.key && "bg-accent-soft/60")}>
                    <button
                      type="button"
                      aria-label={`Активировать ${SCENARIO_NAME[scenario.key]}`}
                      aria-pressed={scenario.key === active.key}
                      onClick={() => onConfig({ active_scenario: scenario.key })}
                      className={cn(
                        "w-full rounded-md px-2 py-1 text-right hover:bg-background",
                        scenario.key === active.key ? "text-primary" : "text-foreground",
                      )}
                    >
                      <span className="block font-semibold">{SCENARIO_NAME[scenario.key]}</span>
                      <span className="mt-0.5 block text-[9px] font-normal text-ink-3">{scenarioDriverSummary(scenario)}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {[...coreRows, ...(detailsOpen ? detailRows : [])].map(([label, renderValue]) => (
                <tr key={label}>
                  <th className="sticky left-0 z-[1] bg-card px-3 py-2 text-left font-medium text-ink-2">{label}</th>
                  {model.scenarios.map((scenario) => (
                    <td key={scenario.key} className={cn("px-4 py-2 text-right font-medium tnum", scenario.key === active.key && "bg-accent-soft/30")}>
                      {renderValue(scenario)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        role="region"
        aria-label="Чистая юнит-экономика"
        className="rounded-lg border border-border p-3"
      >
        <div className="flex flex-col gap-2 border-b border-line-2 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[14px] font-semibold">Чистая юнит-экономика</h2>
            <p className="mt-0.5 text-[10px] text-ink-3">Один клиент в активном workload-сценарии; выбор ниже не меняет портфель.</p>
          </div>
          <label className="grid gap-1 text-[9px] font-semibold uppercase tracking-wide text-ink-3">
            Тариф для анализа
            <select
              aria-label="Тариф для юнит-экономики"
              value={selectedTariff.id}
              onChange={(event) => setSelectedTariffId(Number(event.currentTarget.value))}
              className="min-h-11 min-w-[210px] rounded-md border border-input bg-background px-3 text-[12px] font-medium normal-case tracking-normal text-foreground sm:min-h-9"
            >
              {activeEconomics.by_tariff.map((tariff) => (
                <option key={tariff.id} value={tariff.id}>
                  {tariff.name}{tariff.is_byo ? " · ключи клиента" : " · ключи сервиса"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-[11px] text-ink-3">
          {selectedTariff.name} · {selectedTariff.is_byo ? "ключи клиента" : "ключи сервиса"} · 1 клиент · {SCENARIO_NAME[active.key]}
        </p>
        <div className="mt-2 overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-md border border-border">
            {([
              ["Цена", selectedTariff.price_base, "positive"],
              ["Provider", -selectedTariff.provider_cogs_base, "negative"],
              ["Support / прочие", -selectedTariff.generic_variable_per_client_base, "negative"],
              ["Payment", -selectedTariff.payment_fee_per_client_base, "negative"],
              ["Contribution", selectedTariff.contribution_per_client_base, "positive"],
              ["Fixed", selectedTariff.fixed_allocation_per_client_base == null ? null : -selectedTariff.fixed_allocation_per_client_base, "negative"],
              ["Unit profit", selectedTariff.unit_profit_per_client_base, "positive"],
            ] as [string, number | null, "positive" | "negative"][]).map(([label, value, tone], index) => (
              <div key={label} className={cn("relative px-2 py-3 text-center", index > 0 && "border-l border-line-2")}>
                {index > 0 && <span aria-hidden="true" className="absolute -left-1.5 top-1/2 z-10 -translate-y-1/2 bg-card px-0.5 text-[10px] text-ink-3">→</span>}
                <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
                <div className={cn(
                  "mt-1 text-[13px] font-semibold tnum",
                  tone === "negative" && "text-neg",
                  label === "Unit profit" && (value ?? 0) >= 0 && "text-pos",
                )}>
                  {value == null ? "—" : `${value < 0 ? "−" : ""}${preciseMoney(Math.abs(value))} ${cur}`}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <label className="grid gap-1.5 rounded-md border border-border bg-muted/20 p-3 text-[11px] font-medium text-ink-2">
            Целевая unit margin
            <span className="flex h-9 overflow-hidden rounded-md border border-input bg-background">
              <input
                aria-label="Целевая unit margin"
                type="number"
                min="0"
                max="95"
                step="1"
                value={targetMargin}
                onChange={(event) => setTargetMargin(Math.min(95, Math.max(0, Number(event.currentTarget.value) || 0)))}
                className="min-w-0 flex-1 bg-transparent px-3 text-right font-semibold tnum outline-none"
              />
              <span className="flex items-center border-l border-line-2 px-3 text-ink-3">%</span>
            </span>
            <span className="font-normal leading-4 text-ink-3">После provider, support, payment и текущей доли fixed.</span>
          </label>
          <dl className="grid overflow-hidden rounded-md border border-border sm:grid-cols-3">
            <div className="p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Минимальная цена</dt>
              <dd className="mt-1 text-[14px] font-semibold tnum">
                {Number.isFinite(target.minimumPrice) ? `${preciseMoney(target.minimumPrice)} ${cur}` : "недостижимо"}
              </dd>
            </div>
            <div className="border-t border-line-2 p-3 sm:border-l sm:border-t-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Лимит provider COGS</dt>
              <dd className="mt-1 text-[14px] font-semibold tnum">{preciseMoney(target.providerCogsCapacity)} {cur}</dd>
            </div>
            <div className="border-t border-line-2 p-3 sm:border-l sm:border-t-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Provider headroom</dt>
              <dd className={cn("mt-1 text-[14px] font-semibold tnum", target.providerHeadroom >= 0 ? "text-pos" : "text-neg")}>
                {signed(target.providerHeadroom, cur)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-2 pb-2">
          <div>
            <h2 className="text-[14px] font-semibold">Sensitivity по клиентам</h2>
            <p className="mt-0.5 text-[10px] text-ink-3">Весь портфель на тарифе «{selectedTariff.name}»; workload остаётся {SCENARIO_NAME[active.key]}.</p>
          </div>
          <span className="text-[10px] text-ink-3">Fixed не масштабируется · top-up — cash, не COGS</span>
        </div>
        <div className="mt-2 overflow-x-auto rounded-md border border-border">
          <table aria-label="Sensitivity по числу клиентов" className="w-full min-w-[680px] border-collapse text-[11px]">
            <thead className="bg-muted/35">
              <tr>
                <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wide text-ink-3">P&amp;L / месяц</th>
                {sensitivity.map((row) => (
                  <th key={row.clients} className="px-3 py-2 text-right font-semibold">
                    {row.clients} {row.clients === 1 ? "клиент" : "клиентов"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {([
                ["MRR", (row) => `${preciseMoney(row.revenue)} ${cur}`],
                ["COGS", (row) => expense(row.totalCogs, cur)],
                ["Operating profit", (row) => `${preciseMoney(row.operatingProfit)} ${cur}`],
                ["Gross margin", (row) => pct(row.grossMarginPct)],
                ["Cash top-up", (row) => usd(row.topupCashUsd, 2)],
              ] as [string, (row: (typeof sensitivity)[number]) => string][]).map(([label, render]) => (
                <tr key={label}>
                  <th className="px-3 py-2 text-left font-medium text-ink-2">{label}</th>
                  {sensitivity.map((row) => (
                    <td key={row.clients} className="px-3 py-2 text-right font-medium tnum">{render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
        <section className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-2 pb-2">
            <h2 className="text-[14px] font-semibold">Growth unit economics</h2>
            <span className="text-[11px] text-ink-3">не влияет на COGS и operating profit</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Contribution / клиент", `${money(selectedTariff.contribution_per_client_base)} ${cur}`],
              ["CAC payback", selectedTariff.cac_payback_months == null ? "задай CAC" : `${selectedTariff.cac_payback_months.toFixed(1)} мес.`],
              ["Contribution LTV", selectedTariff.ltv_contribution_base == null ? "задай churn" : `${money(selectedTariff.ltv_contribution_base)} ${cur}`],
              ["LTV:CAC", selectedTariff.ltv_cac_ratio == null ? "нужны CAC + churn" : `${selectedTariff.ltv_cac_ratio.toFixed(1)}×`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted/35 p-2.5">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
                <div className="mt-1 text-[13px] font-semibold tnum">{value}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-ink-3">
            Simple contribution LTV = contribution / monthly churn. Planning proxy без discount rate, expansion и cohort retention.
          </p>
        </section>

        <aside className="rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold">Credits и cash capacity</h3>
              <p className="mt-1 text-[11px] leading-4 text-ink-3">Allowance не входит в COGS. Pack меняет cash и balance credits.</p>
            </div>
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold",
              activeUsage.allowance.overage_usd > 0 ? "bg-neg-soft text-neg" : "bg-pos-soft text-pos",
            )}>
              {allowanceStatus(activeUsage.allowance.remaining_usd, activeUsage.allowance.overage_usd)}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
            <span className="text-ink-3">Managed demand</span><b className="text-right tnum">{integer(activeCapacity.monthly_demand_credits)} credits</b>
            <span className="text-ink-3">Текущий баланс</span><b className="text-right tnum">{integer(activeCapacity.starting_balance_credits)}</b>
            <span className="text-ink-3">Следующее пополнение</span><b className="text-right tnum">{activeCapacity.packs_to_buy} × {usd(activeCapacity.pack_price_usd, 2)} = {usd(activeCapacity.next_topup_cash_usd, 2)}</b>
            <span className="text-ink-3">Баланс после месяца</span><b className="text-right tnum">{integer(activeCapacity.ending_balance_credits)}</b>
          </div>
          {activeCapacity.rate_mismatch && (
            <p className="mt-2 rounded bg-warn-soft px-2 py-1.5 text-[10px] text-warn">Ставка COGS отличается от implied-цены выбранного pack.</p>
          )}
        </aside>
      </div>

      <TrendWatcherAssumptionsEditor
        summary={summary}
        onPreview={onDraftPreview}
        onApply={onDraftApply}
      />
    </section>
  )
}
