import { useEffect, useState } from "react"
import { api, type Rates } from "@/lib/api"
import { CURRENCIES } from "@/lib/constants"

// Единый список известных валют для всех дропдаунов: пресеты + всё, что уже
// есть в /api/rates (используемые валюты + заданные вручную курсы).
// Модульный кеш + подписчики: один фетч на всех, обновление пробрасывается во все CurrencySelect.

let cache: readonly string[] | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

async function doFetch() {
  try {
    const data = await api.get<Rates>("/rates")
    cache = [...new Set([...CURRENCIES, ...data.rates.map((r) => r.currency)])]
    listeners.forEach((l) => l())
  } catch {
    // сеть упала — оставляем прошлый кеш / фолбэк на пресеты
  } finally {
    inflight = null
  }
}

/** Принудительно перечитать список (после добавления курса/валюты). Дедуплицируется. */
export function refreshCurrencies(): Promise<void> {
  if (!inflight) inflight = doFetch()
  return inflight
}

/** Известные валюты; обновляется при монтировании компонента и через refreshCurrencies(). */
export function useKnownCurrencies(): readonly string[] {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((x) => x + 1)
    listeners.add(l)
    void refreshCurrencies()
    return () => { listeners.delete(l) }
  }, [])
  return cache ?? CURRENCIES
}
