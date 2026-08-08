import type { TrendWatcherConfig, TrendWatcherScenario } from "@/lib/api"

export type TrendWatcherTariffEconomics = TrendWatcherScenario["economics"]["by_tariff"][number]

export type ClientSensitivityRow = {
  clients: number
  revenue: number
  providerCogs: number
  otherVariableCogs: number
  paymentFees: number
  fixedCogs: number
  totalCogs: number
  contribution: number
  operatingProfit: number
  grossMarginPct: number | null
  topupCashUsd: number
}

export function buildClientSensitivity({
  tariff,
  scenario,
  config,
  clientCounts,
}: {
  tariff: TrendWatcherTariffEconomics
  scenario: TrendWatcherScenario
  config: TrendWatcherConfig
  clientCounts: number[]
}): ClientSensitivityRow[] {
  return clientCounts.map((clients) => {
    const revenue = tariff.price_base * clients
    const providerCogs = tariff.provider_cogs_base * clients
    const otherVariableCogs = tariff.generic_variable_per_client_base * clients
    const paymentFees = tariff.payment_fee_per_client_base * clients
    const fixedCogs = scenario.economics.fixed_monthly_base
    const contribution = revenue - providerCogs - otherVariableCogs - paymentFees
    const totalCogs = providerCogs + otherVariableCogs + paymentFees + fixedCogs
    const operatingProfit = revenue - totalCogs
    const grossMarginPct = revenue > 0 ? contribution / revenue : null

    const creditsDemand = tariff.is_byo ? 0 : scenario.usage.scrapecreators_credits * clients
    const shortfall = Math.max(0, creditsDemand - config.scrapecreators_credit_balance)
    const packsToBuy = shortfall > 0
      ? Math.ceil(shortfall / config.scrapecreators_pack_credits)
      : 0

    return {
      clients,
      revenue,
      providerCogs,
      otherVariableCogs,
      paymentFees,
      fixedCogs,
      totalCogs,
      contribution,
      operatingProfit,
      grossMarginPct,
      topupCashUsd: tariff.is_byo ? 0 : packsToBuy * config.scrapecreators_pack_price_usd,
    }
  })
}

export function calculateTargetEconomics({
  tariff,
  config,
  targetMarginPct,
}: {
  tariff: TrendWatcherTariffEconomics
  config: TrendWatcherConfig
  targetMarginPct: number
}) {
  const paymentRate = config.payment_fee_pct / 100
  const fixedAllocation = tariff.fixed_allocation_per_client_base ?? 0
  const nonProviderCosts = (
    tariff.generic_variable_per_client_base
    + fixedAllocation
    + config.payment_fee_fixed_usd
  )
  const priceDenominator = 1 - paymentRate - targetMarginPct
  const minimumPrice = priceDenominator > 0
    ? (tariff.provider_cogs_base + nonProviderCosts) / priceDenominator
    : Number.POSITIVE_INFINITY
  const providerCogsCapacity = tariff.is_byo
    ? 0
    : Math.max(
        0,
        tariff.price_base * (1 - paymentRate - targetMarginPct) - nonProviderCosts,
      )

  return {
    minimumPrice,
    providerCogsCapacity,
    providerHeadroom: tariff.is_byo ? 0 : providerCogsCapacity - tariff.provider_cogs_base,
  }
}

export type ProviderDriver = {
  key: string
  label: string
  costUsd: number
}

export function largestProviderDriver(
  scenario: TrendWatcherScenario,
  config: TrendWatcherConfig,
): ProviderDriver | null {
  const rate = config.scrapecreators_price_per_1000 / 1000
  const candidates: ProviderDriver[] = config.instagram_source === "apify"
    ? [{
        key: "instagram_apify",
        label: "Instagram · Apify usage",
        costUsd: scenario.usage.apify.cost_usd,
      }]
    : [
        {
          key: "instagram_refresh",
          label: "Instagram · обновления",
          costUsd: scenario.usage.instagram.refresh_credits * rate,
        },
        {
          key: "instagram_radar",
          label: "Instagram · radar",
          costUsd: scenario.usage.instagram.radar_credits * rate,
        },
        {
          key: "instagram_transcripts",
          label: "Instagram · транскрипты",
          costUsd: scenario.usage.instagram.transcript_credits * rate,
        },
        {
          key: "instagram_outcomes",
          label: "Instagram · outcome refresh",
          costUsd: scenario.usage.instagram.outcome_credits * rate,
        },
      ]

  candidates.push(
    {
      key: "tiktok_refresh",
      label: "TikTok · обновления",
      costUsd: scenario.usage.tiktok.refresh_credits * rate,
    },
    {
      key: "tiktok_discovery",
      label: "TikTok · discovery",
      costUsd: scenario.usage.tiktok.discovery_credits * rate,
    },
    {
      key: "tiktok_transcripts",
      label: "TikTok · транскрипты",
      costUsd: scenario.usage.tiktok.transcript_credits * rate,
    },
    {
      key: "tiktok_outcomes",
      label: "TikTok · outcome refresh",
      costUsd: scenario.usage.tiktok.outcome_credits * rate,
    },
    {
      key: "llm",
      label: `LLM · ${scenario.usage.llm.provider}`,
      costUsd: scenario.usage.llm.cost_usd,
    },
  )

  return candidates.reduce<ProviderDriver | null>(
    (largest, candidate) => !largest || candidate.costUsd > largest.costUsd ? candidate : largest,
    null,
  )
}
