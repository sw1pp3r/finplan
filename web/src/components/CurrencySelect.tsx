import { useState } from "react"
import { useKnownCurrencies } from "@/lib/currencies"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

const CUSTOM = "__custom__"

/**
 * Валюта: дропдаун известных + «Своё…» с inline-вводом (аптокейс).
 * Без явного `known` список тянется из /api/rates (общий для всех дропдаунов).
 * Режим «Своё» — отдельный стейт (можно стирать до пустого, не схлопывая).
 */
export function CurrencySelect({
  value,
  onChange,
  className,
  known,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  known?: readonly string[]
}) {
  const auto = useKnownCurrencies()
  const list = known ?? auto
  const valueIsCustom = value !== "" && !list.includes(value)
  const [custom, setCustom] = useState(valueIsCustom)
  const showInput = custom || valueIsCustom

  function onSelect(v: string) {
    if (v === CUSTOM) {
      setCustom(true)
      onChange("")
    } else {
      setCustom(false)
      onChange(v)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={showInput ? CUSTOM : value} onValueChange={onSelect}>
        <SelectTrigger className={className ?? "w-24"}>
          <SelectValue placeholder="Валюта" />
        </SelectTrigger>
        <SelectContent>
          {list.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Своё…</SelectItem>
        </SelectContent>
      </Select>
      {showInput && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="EUR"
          className="w-20"
          maxLength={12}
          autoFocus
        />
      )}
    </div>
  )
}
