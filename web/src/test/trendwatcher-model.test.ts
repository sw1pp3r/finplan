import { describe, expect, it } from "vitest"

import {
  buildClientSensitivity,
  calculateTargetEconomics,
  largestProviderDriver,
} from "@/lib/trendwatcher-model"
import type { ServiceSummary } from "@/lib/api"
import { fixtures } from "./fixtures"

const summary = fixtures["/services/1/summary"] as ServiceSummary
const model = summary.trendwatcher!
const scenario = model.active
const managed = scenario.economics.by_tariff.find((tariff) => !tariff.is_byo)!
const byo = scenario.economics.by_tariff.find((tariff) => tariff.is_byo)!

describe("TrendWatcher decision-model calculations", () => {
  it("projects client sensitivity without changing the workload scenario", () => {
    const rows = buildClientSensitivity({
      tariff: managed,
      scenario,
      config: model.config,
      clientCounts: [1, 5, 10, 25],
    })

    expect(rows.map((row) => row.clients)).toEqual([1, 5, 10, 25])
    expect(rows[0].revenue).toBe(99)
    expect(rows[0].providerCogs).toBeCloseTo(14.36324)
    expect(rows[0].otherVariableCogs).toBe(10)
    expect(rows[0].fixedCogs).toBe(20)
    expect(rows[0].operatingProfit).toBeCloseTo(54.63676)
    expect(rows[0].topupCashUsd).toBe(47)
    expect(rows[1].revenue).toBe(495)
    expect(rows[1].topupCashUsd).toBe(94)
    expect(rows[2].operatingProfit).toBeCloseTo(726.3676)
    expect(rows[3].grossMarginPct).toBeCloseTo(managed.contribution_margin_pct!)
  })

  it("keeps BYO provider spend and provider top-ups at zero", () => {
    const [row] = buildClientSensitivity({
      tariff: byo,
      scenario,
      config: model.config,
      clientCounts: [5],
    })

    expect(row.providerCogs).toBe(0)
    expect(row.topupCashUsd).toBe(0)
    expect(row.operatingProfit).toBe(175)

    const target = calculateTargetEconomics({
      tariff: byo,
      config: model.config,
      targetMarginPct: 0.6,
    })
    expect(target.providerCogsCapacity).toBe(0)
    expect(target.providerHeadroom).toBe(0)
  })

  it("solves minimum price and provider capacity for a target unit margin", () => {
    const target = calculateTargetEconomics({
      tariff: managed,
      config: model.config,
      targetMarginPct: 0.6,
    })

    expect(target.minimumPrice).toBeCloseTo(65.9081, 3)
    expect(target.providerCogsCapacity).toBeCloseTo(27.6, 3)
    expect(target.providerHeadroom).toBeCloseTo(13.23676, 3)
  })

  it("finds the largest usage-backed provider driver", () => {
    expect(largestProviderDriver(scenario, model.config)).toEqual({
      key: "tiktok_refresh",
      label: "TikTok · обновления",
      costUsd: 8.23816,
    })
  })
})
