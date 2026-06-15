import { useEffect, useState } from "react"
import { api, type Rates } from "@/lib/api"

export type Converter = {
  base: string
  /** Привести сумму в `currency` к базовой валюте. null — если курса нет. */
  conv: (amount: number, currency: string) => number | null
  ready: boolean
}

/** Хук-конвертер: тянет /rates и приводит чужие валюты к базовой.
 *  Источник правды по курсам — бэкенд; фронт только отображает приведение рядом с суммой. */
export function useConverter(): Converter {
  const [rates, setRates] = useState<Rates | null>(null)
  useEffect(() => {
    void api.get<Rates>("/rates").then(setRates).catch(() => {})
  }, [])
  const base = rates?.base_currency ?? "USD"
  const toBase = new Map<string, number>()
  if (rates) for (const r of rates.rates) if (r.rate_to_base != null) toBase.set(r.currency, r.rate_to_base)
  const conv = (amount: number, currency: string): number | null => {
    if (currency === base) return amount
    const k = toBase.get(currency)
    return k != null ? amount * k : null
  }
  return { base, conv, ready: rates != null }
}
