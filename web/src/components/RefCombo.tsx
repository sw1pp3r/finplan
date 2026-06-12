import { useState } from "react"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { Ref } from "@/lib/api"

const CUSTOM = "__custom__"
const NONE = "__none__"

/**
 * Селект из справочника (направления / категории) + «Своё…» с inline-вводом.
 * Значение наружу — всегда строка-имя; новое имя само попадёт в справочник на бэке.
 * Режим «Своё» — отдельный стейт, не зависит от текста: можно стирать до пустого.
 */
export function RefCombo({
  options,
  value,
  onChange,
  placeholder,
  width = "w-44",
}: {
  options: Ref[]
  value: string
  onChange: (v: string) => void
  placeholder: string
  width?: string
}) {
  // value не из справочника и непустое → это уже своё значение
  const valueIsCustom = value !== "" && !options.some((o) => o.name === value)
  const [custom, setCustom] = useState(valueIsCustom)
  const showInput = custom || valueIsCustom

  function onSelect(v: string) {
    if (v === CUSTOM) {
      setCustom(true)
      onChange("")
    } else if (v === NONE) {
      setCustom(false)
      onChange("")
    } else {
      setCustom(false)
      onChange(v)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={showInput ? CUSTOM : value} onValueChange={onSelect}>
        <SelectTrigger className={width}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— нет —</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.name}>{o.name}</SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Своё…</SelectItem>
        </SelectContent>
      </Select>
      {showInput && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Новое значение"
          className="w-40"
          autoFocus
        />
      )}
    </div>
  )
}
