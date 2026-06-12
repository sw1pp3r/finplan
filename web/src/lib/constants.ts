// Единая точка расширения справочников: добавить валюту/банк = одна строка здесь.

export const CURRENCIES = ["USD", "USDT", "AED", "KZT"] as const

export const ACCOUNT_TYPES = [
  { value: "bank", label: "банк" },
  { value: "cash", label: "кэш" },
  { value: "broker", label: "брокер" },
  { value: "crypto", label: "крипта" },
] as const

export type AccountPreset = { name: string; currency: string; type: string }

export const ACCOUNT_PRESETS: { group: string; items: AccountPreset[] }[] = [
  {
    group: "Банки",
    items: [
      { name: "Kaspi", currency: "KZT", type: "bank" },
      { name: "Wio", currency: "AED", type: "bank" },
      { name: "ENBD", currency: "AED", type: "bank" },
    ],
  },
  {
    group: "Крипта",
    items: [
      { name: "Binance", currency: "USDT", type: "crypto" },
      { name: "Tronlink", currency: "USDT", type: "crypto" },
    ],
  },
]
