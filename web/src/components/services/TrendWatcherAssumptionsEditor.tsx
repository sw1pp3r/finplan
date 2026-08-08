import { useEffect, useId, useMemo, useRef, useState } from "react"

import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { money } from "@/lib/format"
import type {
  ServiceSummary,
  TrendWatcherConfig,
  TrendWatcherDraftPayload,
  TrendWatcherScenario,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { largestProviderDriver } from "@/lib/trendwatcher-model"

type Props = {
  summary: ServiceSummary
  onPreview: (body: TrendWatcherDraftPayload) => Promise<ServiceSummary>
  onApply: (body: TrendWatcherDraftPayload) => Promise<ServiceSummary>
}

type DomainKey = "instagram" | "tiktok" | "youtube" | "llm" | "providers" | "commercial"

type DriverField = {
  key: string
  label: string
  suffix?: string
  step?: number
  hint?: string
  min?: number
  max?: number
  integer?: boolean
  apifyOnly?: boolean
}

type NumericConfigKey = {
  [K in keyof TrendWatcherConfig]: TrendWatcherConfig[K] extends number ? K : never
}[keyof TrendWatcherConfig]

type ConfigField = {
  key: NumericConfigKey
  label: string
  suffix?: string
  step?: number
  hint?: string
  min?: number
  max?: number
  integer?: boolean
}

type ChangeJournalEntry = {
  id: string
  appliedAt: string
  scenario: TrendWatcherScenario["key"]
  changes: string[]
}

const DOMAIN_LABELS: Record<DomainKey, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  llm: "LLM и outcomes",
  providers: "Ставки провайдеров",
  commercial: "Коммерческие допущения",
}

const SCENARIO_LABELS: Record<TrendWatcherScenario["key"], string> = {
  low: "Low",
  base: "Base",
  stress: "Stress",
}

const DOMAIN_HELP: Record<DomainKey, string> = {
  instagram: "Мониторинг аккаунтов, ручные сборы, radar, транскрипты и проверки опубликованных роликов.",
  tiktok: "Мониторинг аккаунтов, ручные сборы, discovery, транскрипты и outcome refresh.",
  youtube: "Нагрузка на YouTube Data API. Quota показывается как лимит, а не как денежный COGS.",
  llm: "Workflow-вызовы и токены считаются по выбранной модели, включая явный reserve на retries.",
  providers: "Подтверждённые тарифы отделены от редактируемых допущений и cash capacity.",
  commercial: "Эквайринг, churn и CAC влияют на unit/growth economics, но не подменяют provider COGS.",
}

const DRIVER_DOMAINS: Record<
  Extract<DomainKey, "instagram" | "tiktok" | "youtube" | "llm">,
  { primary: DriverField[]; advanced: DriverField[] }
> = {
  instagram: {
    primary: [
      { key: "instagram_accounts", label: "Instagram аккаунтов", suffix: "акк." },
      { key: "instagram_refreshes_per_month", label: "Обновлений на аккаунт / мес", suffix: "раз" },
      { key: "manual_instagram_full_collections", label: "Ручных полных сборов", suffix: "сборов" },
      { key: "instagram_radar_runs", label: "Radar-запусков", suffix: "запусков" },
    ],
    advanced: [
      { key: "instagram_credits_per_refresh", label: "Credits на обновление", suffix: "credits" },
      {
        key: "instagram_results_per_refresh",
        label: "Apify results на обновление",
        suffix: "results",
        apifyOnly: true,
      },
      { key: "instagram_credits_per_radar_run", label: "Credits на radar-запуск", suffix: "credits" },
      { key: "instagram_transcripts", label: "Транскриптов Instagram", suffix: "шт." },
      { key: "instagram_published_videos", label: "Опубликовано роликов IG", suffix: "роликов" },
    ],
  },
  tiktok: {
    primary: [
      { key: "tiktok_accounts", label: "TikTok аккаунтов", suffix: "акк." },
      { key: "tiktok_refreshes_per_month", label: "Обновлений на аккаунт / мес", suffix: "раз" },
      { key: "manual_tiktok_full_collections", label: "Ручных полных сборов TikTok", suffix: "сборов" },
      { key: "tiktok_discovery_runs", label: "Discovery-запусков TikTok", suffix: "запусков" },
    ],
    advanced: [
      { key: "tiktok_credits_per_refresh", label: "Credits на обновление TikTok", suffix: "credits" },
      { key: "tiktok_credits_per_discovery_run", label: "Credits на discovery-запуск", suffix: "credits" },
      { key: "tiktok_transcripts", label: "Транскриптов TikTok", suffix: "шт." },
      { key: "tiktok_published_videos", label: "Опубликовано роликов TikTok", suffix: "роликов" },
    ],
  },
  youtube: {
    primary: [
      { key: "youtube_channels", label: "YouTube каналов", suffix: "каналов" },
      { key: "youtube_refreshes_per_month", label: "Обновлений на канал / мес", suffix: "раз" },
      { key: "youtube_radar_queries", label: "Radar-запросов YouTube", suffix: "запросов" },
      { key: "youtube_published_videos", label: "Опубликовано роликов YouTube", suffix: "роликов" },
    ],
    advanced: [
      { key: "manual_youtube_full_collections", label: "Ручных сборов YouTube", suffix: "сборов" },
    ],
  },
  llm: {
    primary: [
      {
        key: "outcome_checks_per_video",
        label: "Outcome checks D0/D1/D2/D7",
        suffix: "checks",
        max: 4,
        hint: "До четырёх проверок: D0, D1, D2 и D7.",
      },
      { key: "llm_annotated_videos", label: "Новых видео для LLM-аннотации", suffix: "видео" },
      { key: "llm_similarity_videos", label: "Видео для similarity scoring", suffix: "видео" },
      { key: "llm_idea_candidates", label: "Кандидатов для генерации идей", suffix: "шт." },
    ],
    advanced: [
      { key: "llm_profile_rebuilds", label: "Пересборок профиля", suffix: "раз" },
      { key: "llm_manual_calls", label: "Прочих ручных LLM-вызовов", suffix: "вызовов" },
      { key: "llm_input_tokens_per_call", label: "Input tokens / вызов", suffix: "tokens" },
      { key: "llm_output_tokens_per_call", label: "Output tokens / вызов", suffix: "tokens" },
    ],
  },
}

const PROVIDER_FIELDS: ConfigField[] = [
  { key: "provider_allowance_usd", label: "Клиентский allowance, USD", suffix: "USD", step: 0.01 },
  {
    key: "scrapecreators_price_per_1000",
    label: "ScrapeCreators, USD / 1000",
    suffix: "USD",
    step: 0.001,
    min: 0.001,
  },
]

const PROVIDER_STATE_FIELDS: ConfigField[] = [{
  key: "scrapecreators_credit_balance",
  label: "Текущий баланс ScrapeCreators",
  suffix: "credits",
  integer: true,
}]

const PROVIDER_ADVANCED_FIELDS: ConfigField[] = [
  {
    key: "scrapecreators_pack_credits",
    label: "Pack size, credits",
    suffix: "credits",
    min: 1,
    integer: true,
  },
  {
    key: "scrapecreators_pack_price_usd",
    label: "Pack price, USD",
    suffix: "USD",
    step: 0.01,
    min: 0.01,
  },
  {
    key: "apify_instagram_price_per_1000",
    label: "Apify Instagram, USD / 1000 results",
    suffix: "USD",
    step: 0.001,
    min: 0.001,
  },
  { key: "apify_actor_start_usd", label: "Apify actor start, USD", suffix: "USD", step: 0.0001 },
]

const LLM_RATE_FIELDS: ConfigField[] = [
  { key: "llm_input_usd_per_million", label: "LLM input, USD / 1M", suffix: "USD", step: 0.001 },
  { key: "llm_output_usd_per_million", label: "LLM output, USD / 1M", suffix: "USD", step: 0.001 },
  {
    key: "llm_retry_overhead_pct",
    label: "Retry / fallback reserve, %",
    suffix: "%",
    step: 0.1,
    max: 100,
  },
  {
    key: "llm_platform_fee_pct",
    label: "LLM platform fee allocation, %",
    suffix: "%",
    step: 0.1,
    max: 100,
  },
]

const YOUTUBE_LIMIT_FIELDS: ConfigField[] = [
  {
    key: "youtube_daily_general_units",
    label: "YouTube daily general quota",
    suffix: "units",
    min: 1,
    integer: true,
  },
  {
    key: "youtube_daily_search_calls",
    label: "YouTube daily search limit",
    suffix: "calls",
    min: 1,
    integer: true,
  },
]

const COMMERCIAL_FIELDS: ConfigField[] = [
  { key: "payment_fee_pct", label: "Payment fee, %", suffix: "%", step: 0.1, max: 100 },
  { key: "payment_fee_fixed_usd", label: "Payment fee fixed, USD", suffix: "USD", step: 0.01 },
  { key: "monthly_churn_pct", label: "Monthly churn, %", suffix: "%", step: 0.1, max: 100 },
  { key: "cac_per_client_usd", label: "CAC / клиент, USD", suffix: "USD", step: 1 },
]

const ALL_DRIVER_FIELDS = Object.values(DRIVER_DOMAINS).flatMap((group) => [
  ...group.primary,
  ...group.advanced,
])
const ALL_CONFIG_FIELDS = [
  ...PROVIDER_FIELDS,
  ...PROVIDER_STATE_FIELDS,
  ...PROVIDER_ADVANCED_FIELDS,
  ...LLM_RATE_FIELDS,
  ...COMMERCIAL_FIELDS,
]

function fieldLabel(key: string): string {
  if (key === "instagram_source") return "Источник Instagram"
  if (key === "llm_provider") return "LLM provider"
  return ALL_DRIVER_FIELDS.find((field) => field.key === key)?.label
    ?? ALL_CONFIG_FIELDS.find((field) => field.key === key)?.label
    ?? key
}

function journalValue(value: unknown): string {
  if (value === "scrapecreators") return "ScrapeCreators"
  if (value === "apify") return "Apify"
  return String(value)
}

function readJournal(key: string): ChangeJournalEntry[] {
  try {
    const value = window.localStorage.getItem(key)
    if (!value) return []
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.slice(0, 5) : []
  } catch {
    return []
  }
}

function domainDriverKeys(domain: DomainKey): string[] {
  if (!(domain in DRIVER_DOMAINS)) return []
  const group = DRIVER_DOMAINS[domain as keyof typeof DRIVER_DOMAINS]
  return [...group.primary, ...group.advanced].map((field) => field.key)
}

function domainConfigKeys(domain: DomainKey): (keyof TrendWatcherConfig)[] {
  if (domain === "instagram") return ["instagram_source"]
  if (domain === "llm") return ["llm_provider", ...LLM_RATE_FIELDS.map((field) => field.key)]
  if (domain === "providers") {
    return [
      ...PROVIDER_FIELDS,
      ...PROVIDER_STATE_FIELDS,
      ...PROVIDER_ADVANCED_FIELDS,
    ].map((field) => field.key)
  }
  if (domain === "commercial") return COMMERCIAL_FIELDS.map((field) => field.key)
  return []
}

function usd(value: number, digits = 3): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: digits })}`
}

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`
}

function signedMoney(value: number, currency: string): string {
  if (Math.abs(value) < 0.000001) return `0 ${currency}`
  return `${value < 0 ? "−" : "+"}${money(Math.abs(value))} ${currency}`
}

function changeNoun(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return "изменение"
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "изменения"
  return "изменений"
}

function unsavedLabel(count: number): string {
  if (count === 1) return "1 несохранённое изменение"
  return `${count} несохранённых ${changeNoun(count)}`
}

function checkedDate(value: string | null): string {
  if (!value) return "дата не зафиксирована"
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

function sourceIsStale(source: { status: "verified" | "assumption"; checked_on: string | null }): boolean {
  if (source.status !== "verified" || !source.checked_on) return false
  const checked = new Date(`${source.checked_on}T00:00:00Z`).getTime()
  const ninetyDays = 90 * 24 * 60 * 60 * 1000
  return Number.isFinite(checked) && Date.now() - checked > ninetyDays
}

function compactInteger(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 0 })
}

function domainUsageSummary(
  domain: DomainKey,
  scenario: TrendWatcherScenario,
  config: TrendWatcherConfig,
  baseCurrency: string,
): string {
  const { usage, economics } = scenario
  if (domain === "instagram") {
    return config.instagram_source === "apify"
      ? `${compactInteger(usage.apify.results)} results · ${usd(usage.apify.cost_usd)}`
      : `${compactInteger(usage.instagram.credits)} credits · ${usd(usage.instagram.cost_usd)}`
  }
  if (domain === "tiktok") {
    return `${compactInteger(usage.tiktok.credits)} credits · ${usd(usage.tiktok.cost_usd)}`
  }
  if (domain === "youtube") {
    return `${compactInteger(usage.youtube.general_quota_units)} units · quota, не COGS`
  }
  if (domain === "llm") {
    return `${compactInteger(usage.llm.billed_calls)} calls · ${usd(usage.llm.cost_usd)}`
  }
  if (domain === "providers") {
    return `${usd(usage.provider_cost_usd)} / Managed-клиент`
  }
  return `${money(economics.payment_fees_monthly_base)} ${baseCurrency} fees · ${pct(economics.gross_margin_pct)} GM`
}

function NumericDraftInput({
  label,
  value,
  baselineValue,
  suffix,
  step = 1,
  hint,
  min = 0,
  max,
  integer = false,
  onChange,
  onValidityChange,
}: {
  label: string
  value: number
  baselineValue: number
  suffix?: string
  step?: number
  hint?: string
  min?: number
  max?: number
  integer?: boolean
  onChange: (value: number) => void
  onValidityChange: (valid: boolean) => void
}) {
  const [raw, setRaw] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  const descriptionId = useId()

  useEffect(() => {
    setRaw(String(value))
    setError(null)
    onValidityChange(true)
    // Validity is local to this field; a new saved value always resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const validate = (nextRaw: string): { value: number | null; error: string | null } => {
    if (nextRaw === "") return { value: null, error: "Укажите значение" }
    const next = Number(nextRaw)
    if (!Number.isFinite(next)) return { value: null, error: "Введите число" }
    if (next < min) return { value: null, error: `Минимум ${min}` }
    if (max !== undefined && next > max) return { value: null, error: `Максимум ${max}` }
    if (integer && !Number.isInteger(next)) return { value: null, error: "Только целое число" }
    return { value: next, error: null }
  }

  return (
    <label className="grid min-w-0 gap-1.5 text-[12px] font-medium text-ink-2">
      <span>{label}</span>
      <span className={cn(
        "flex h-9 min-w-0 overflow-hidden rounded-md border bg-background focus-within:ring-1",
        error
          ? "border-neg focus-within:border-neg focus-within:ring-neg/20"
          : "border-input focus-within:border-primary focus-within:ring-primary/20",
      )}>
        <Input
          aria-label={label}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={(error || hint) ? descriptionId : undefined}
          type="number"
          min={min}
          max={max}
          step={step}
          value={raw}
          className="h-9 min-w-0 flex-1 rounded-none border-0 bg-transparent tnum focus-visible:ring-0"
          onChange={(event) => {
            const nextRaw = event.currentTarget.value
            setRaw(nextRaw)
            const result = validate(nextRaw)
            setError(result.error)
            onValidityChange(result.error === null)
            if (result.value !== null) onChange(result.value)
          }}
          onBlur={() => {
            const result = validate(raw)
            if (result.error) {
              setRaw(String(value))
              setError(null)
              onValidityChange(true)
            }
          }}
        />
        {suffix && (
          <span className="flex shrink-0 items-center border-l border-line-2 bg-muted/35 px-2.5 text-[11px] text-ink-3">
            {suffix}
          </span>
        )}
      </span>
      {(error || hint) && (
        <span
          id={descriptionId}
          className={cn(
            "text-[11px] font-normal leading-4",
            error ? "text-neg" : "text-ink-3",
          )}
        >
          {error ?? hint}
        </span>
      )}
      {!error && value !== baselineValue && (
        <span className="text-[10px] font-normal leading-4 text-primary">
          Было {journalValue(baselineValue)} → станет {journalValue(value)}
        </span>
      )}
    </label>
  )
}

function Delta({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (Math.abs(value) < 0.000001) return <span className="text-ink-3">без изменений</span>
  return (
    <span className={value > 0 ? "text-pos" : "text-neg"}>
      {value > 0 ? "+" : "−"}{Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 3 })}{suffix}
    </span>
  )
}

function SourceRow({ name, source }: {
  name?: string
  source: {
    status: "verified" | "assumption"
    label: string
    url: string | null
    checked_on: string | null
  }
}) {
  const stale = sourceIsStale(source)
  return (
    <div className="border-b border-line-2 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(
          "rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
          source.status === "verified" && !stale ? "bg-pos-soft text-pos" : "bg-warn-soft text-warn",
        )}>
          {stale
            ? "Проверка устарела"
            : source.status === "verified"
              ? "Подтверждено"
              : "Допущение"}
        </span>
        <span className="text-[12px] font-medium">{source.label}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
        <span>{source.checked_on ? `проверено ${checkedDate(source.checked_on)}` : "редактируется пользователем"}</span>
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`${name ?? source.label} — ${source.label} — официальный источник`}
            className="font-medium text-primary underline decoration-primary/35 underline-offset-2 hover:decoration-primary"
          >
            Официальный источник ↗
          </a>
        )}
      </div>
    </div>
  )
}

function Formula({ domain, config }: {
  domain: DomainKey
  config: TrendWatcherConfig
}) {
  if (domain === "instagram") {
    if (config.instagram_source === "apify") {
      return (
        <span>
          results = аккаунты × обновления × results + ручные сборы × 31; actor starts = (аккаунты × обновления + ручные сборы) × 2.
        </span>
      )
    }
    return (
      <span>
        credits = аккаунты × обновления × credits + ручные сборы × 4 + radar × credits + транскрипты + ролики × outcome checks.
      </span>
    )
  }
  if (domain === "tiktok") {
    return (
      <span>
        credits = аккаунты × обновления × credits + ручные сборы × 3 + discovery × credits + транскрипты + ролики × outcome checks.
      </span>
    )
  }
  if (domain === "youtube") {
    return (
      <span>
        general quota = каналы × обновления × 2 + ручные сборы × 3 + radar + ролики × outcome checks. Search calls показываются отдельно.
      </span>
    )
  }
  if (domain === "llm") {
    return (
      <span>
        billed calls = ceil((аннотации + ceil(similarity / 40) + profile × 2 + ideas × 2 + manual) × (1 + retry reserve)).
      </span>
    )
  }
  if (domain === "providers") {
    return <span>COGS = usage × подтверждённая ставка; allowance сравнивается с usage, но не прибавляется к расходу.</span>
  }
  return <span>Contribution = выручка − provider COGS − support/переменные − payment fees; LTV proxy = contribution / monthly churn.</span>
}

function DriverFields({ fields, scenario, baselineScenario, instagramSource, onChange, onValidityChange }: {
  fields: DriverField[]
  scenario: TrendWatcherScenario
  baselineScenario: TrendWatcherScenario
  instagramSource: TrendWatcherConfig["instagram_source"]
  onChange: (key: string, value: number) => void
  onValidityChange: (key: string, valid: boolean) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields
        .filter((field) => !field.apifyOnly || instagramSource === "apify")
        .map((field) => (
          <NumericDraftInput
            key={field.key}
            label={field.label}
            value={scenario.drivers[field.key] ?? 0}
            baselineValue={baselineScenario.drivers[field.key] ?? 0}
            suffix={field.suffix}
            step={field.step}
            hint={field.hint}
            min={field.min}
            max={field.max}
            integer={field.integer ?? true}
            onChange={(value) => onChange(field.key, value)}
            onValidityChange={(valid) => onValidityChange(`driver:${field.key}`, valid)}
          />
        ))}
    </div>
  )
}

export function TrendWatcherAssumptionsEditor({ summary, onPreview, onApply }: Props) {
  const model = summary.trendwatcher!
  const [open, setOpen] = useState(false)
  const [domain, setDomain] = useState<DomainKey>("instagram")
  const [draftConfig, setDraftConfig] = useState<TrendWatcherConfig>({ ...model.config })
  const [draftDrivers, setDraftDrivers] = useState<Record<string, number>>({ ...model.active.drivers })
  const [preview, setPreview] = useState<ServiceSummary | null>(null)
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [applyState, setApplyState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [invalidFields, setInvalidFields] = useState<Record<string, true>>({})
  const journalKey = `finplan:trendwatcher:${summary.service.id}:assumption-journal`
  const [journal, setJournal] = useState<ChangeJournalEntry[]>(() => readJournal(journalKey))
  const requestId = useRef(0)

  const serverSignature = useMemo(
    () => JSON.stringify([model.active.key, model.active.drivers, model.config]),
    [model.active.key, model.active.drivers, model.config],
  )

  useEffect(() => {
    setDraftConfig({ ...model.config })
    setDraftDrivers({ ...model.active.drivers })
    setPreview(null)
    setPreviewState("idle")
    setApplyState("idle")
    setInvalidFields({})
  }, [model.active.drivers, model.config, serverSignature])

  useEffect(() => {
    setJournal(readJournal(journalKey))
  }, [journalKey])

  useEffect(() => {
    setInvalidFields({})
  }, [domain])

  const changedDrivers = useMemo(() => {
    const next: Record<string, number> = {}
    for (const [key, value] of Object.entries(draftDrivers)) {
      if (value !== model.active.drivers[key]) next[key] = value
    }
    return next
  }, [draftDrivers, model.active.drivers])

  const changedConfig = useMemo(() => {
    const next: Partial<TrendWatcherConfig> = {}
    for (const key of Object.keys(draftConfig) as (keyof TrendWatcherConfig)[]) {
      if (draftConfig[key] !== model.config[key]) {
        ;(next as Record<string, unknown>)[key] = draftConfig[key]
      }
    }
    return next
  }, [draftConfig, model.config])

  const changeCount = Object.keys(changedDrivers).length + Object.keys(changedConfig).length
  const currentDomainDriverKeys = domainDriverKeys(domain)
  const currentDomainConfigKeys = domainConfigKeys(domain)
  const domainChangeCount = (
    currentDomainDriverKeys.filter((key) => key in changedDrivers).length
    + currentDomainConfigKeys.filter((key) => key in changedConfig).length
  )
  const invalidCount = Object.keys(invalidFields).length
  const draftPayload = useMemo<TrendWatcherDraftPayload>(() => ({
    scenario_key: model.active.key,
    config: changedConfig,
    drivers: changedDrivers,
  }), [changedConfig, changedDrivers, model.active.key])

  useEffect(() => {
    if (!open || changeCount === 0 || invalidCount > 0) {
      requestId.current += 1
      setPreview(null)
      setPreviewState("idle")
      return
    }
    const id = ++requestId.current
    setPreviewState("loading")
    const timeout = window.setTimeout(() => {
      void onPreview(draftPayload)
        .then((result) => {
          if (requestId.current !== id) return
          setPreview(result)
          setPreviewState("ready")
        })
        .catch(() => {
          if (requestId.current !== id) return
          setPreviewState("error")
        })
    }, 220)
    return () => window.clearTimeout(timeout)
  }, [changeCount, draftPayload, invalidCount, onPreview, open])

  const previewModel = preview?.trendwatcher ?? model
  const previewActive = previewModel.active
  const topDriver = largestProviderDriver(previewActive, draftConfig)
  const baseline = model.active
  const cur = summary.base_currency
  const sourceDate = model.pricing_sources.scrapecreators.checked_on
  const hasStaleSource = Object.values(model.pricing_sources).some(sourceIsStale)
  const parameterCount = Object.keys(model.active.drivers).length + Object.keys(model.config).length - 1
  const warnings = [
    baseline.usage.allowance.overage_usd > 0,
    baseline.capacity.rate_mismatch,
    baseline.usage.instagram.unsupported_radar_runs > 0,
    hasStaleSource,
  ].filter(Boolean).length

  const resetDraft = () => {
    requestId.current += 1
    setDraftConfig({ ...model.config })
    setDraftDrivers({ ...model.active.drivers })
    setPreview(null)
    setPreviewState("idle")
    setApplyState("idle")
    setInvalidFields({})
  }

  const resetDomainDraft = () => {
    requestId.current += 1
    setDraftDrivers((current) => {
      const next = { ...current }
      for (const key of currentDomainDriverKeys) next[key] = model.active.drivers[key] ?? 0
      return next
    })
    setDraftConfig((current) => {
      const next = { ...current }
      for (const key of currentDomainConfigKeys) {
        ;(next as Record<string, unknown>)[key] = model.config[key]
      }
      return next
    })
    setPreview(null)
    setPreviewState("idle")
    setApplyState("idle")
    setInvalidFields({})
  }

  const applyDraft = async () => {
    if (changeCount === 0 || invalidCount > 0 || applyState === "saving") return
    const changes = [
      ...Object.entries(draftPayload.drivers).map(([key, value]) => (
        `${fieldLabel(key)}: ${journalValue(model.active.drivers[key])} → ${journalValue(value)}`
      )),
      ...Object.entries(draftPayload.config).map(([key, value]) => (
        `${fieldLabel(key)}: ${journalValue((model.config as unknown as Record<string, unknown>)[key])} → ${journalValue(value)}`
      )),
    ]
    setApplyState("saving")
    try {
      const result = await onApply(draftPayload)
      setPreview(result)
      setApplyState("saved")
      const entry: ChangeJournalEntry = {
        id: `${Date.now()}-${model.active.key}`,
        appliedAt: new Date().toISOString(),
        scenario: model.active.key,
        changes,
      }
      setJournal((current) => {
        const next = [entry, ...current].slice(0, 5)
        try {
          window.localStorage.setItem(journalKey, JSON.stringify(next))
        } catch {
          // The journal is an ergonomic local aid; failed storage must not block saving the model.
        }
        return next
      })
    } catch {
      setApplyState("error")
    }
  }

  const setConfigValue = <K extends keyof TrendWatcherConfig>(key: K, value: TrendWatcherConfig[K]) => {
    setDraftConfig((current) => ({ ...current, [key]: value }))
    setApplyState("idle")
  }

  const setDriverValue = (key: string, value: number) => {
    setDraftDrivers((current) => ({ ...current, [key]: value }))
    setApplyState("idle")
  }

  const setFieldValidity = (key: string, valid: boolean) => {
    setInvalidFields((current) => {
      if (valid) {
        if (!(key in current)) return current
        const next = { ...current }
        delete next[key]
        return next
      }
      if (key in current) return current
      return { ...current, [key]: true }
    })
  }

  const draftScenario: TrendWatcherScenario = {
    ...model.active,
    drivers: draftDrivers,
  }

  const renderConfigFields = (fields: ConfigField[]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <NumericDraftInput
          key={field.key}
          label={field.label}
          value={draftConfig[field.key]}
          baselineValue={model.config[field.key]}
          suffix={field.suffix}
          step={field.step}
          hint={field.hint}
          min={field.min}
          max={field.max}
          integer={field.integer}
          onChange={(value) => setConfigValue(field.key, value)}
          onValidityChange={(valid) => setFieldValidity(`config:${field.key}`, valid)}
        />
      ))}
    </div>
  )

  const renderDomain = () => {
    if (domain === "instagram" || domain === "tiktok" || domain === "youtube") {
      const spec = DRIVER_DOMAINS[domain]
      return (
        <div className="space-y-4">
          {domain === "instagram" && (
            <label className="grid max-w-sm gap-1.5 text-[12px] font-medium text-ink-2">
              <span>Источник Instagram</span>
              <Select
                value={draftConfig.instagram_source}
                onValueChange={(value) => setConfigValue(
                  "instagram_source",
                  value as TrendWatcherConfig["instagram_source"],
                )}
              >
                <SelectTrigger className="h-9" aria-label="Источник Instagram"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scrapecreators">ScrapeCreators</SelectItem>
                  <SelectItem value="apify">Apify · редактируемая ставка</SelectItem>
                </SelectContent>
              </Select>
              {draftConfig.instagram_source !== model.config.instagram_source && (
                <span className="text-[10px] font-normal text-primary">
                  Было {journalValue(model.config.instagram_source)} → станет {journalValue(draftConfig.instagram_source)}
                </span>
              )}
            </label>
          )}
          <DriverFields
            fields={spec.primary}
            scenario={draftScenario}
            baselineScenario={model.active}
            instagramSource={draftConfig.instagram_source}
            onChange={setDriverValue}
            onValidityChange={setFieldValidity}
          />
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-semibold text-ink-2">
              Дополнительные параметры {DOMAIN_LABELS[domain]}
            </summary>
            <div className="border-t border-line-2 p-3">
              <DriverFields
                fields={spec.advanced}
                scenario={draftScenario}
                baselineScenario={model.active}
                instagramSource={draftConfig.instagram_source}
                onChange={setDriverValue}
                onValidityChange={setFieldValidity}
              />
            </div>
          </details>
          {domain === "youtube" && (
            <div className="space-y-3 border-t border-line-2 pt-4">
              <div>
                <h4 className="text-[12px] font-semibold">Немонетарные дневные лимиты</h4>
                <p className="mt-1 text-[11px] leading-4 text-ink-3">Используются только для контроля quota и не создают фиктивный COGS.</p>
              </div>
              {renderConfigFields(YOUTUBE_LIMIT_FIELDS)}
            </div>
          )}
        </div>
      )
    }

    if (domain === "llm") {
      const source = model.pricing_sources.llm
      return (
        <div className="space-y-4">
          <DriverFields
            fields={DRIVER_DOMAINS.llm.primary}
            scenario={draftScenario}
            baselineScenario={model.active}
            instagramSource={draftConfig.instagram_source}
            onChange={setDriverValue}
            onValidityChange={setFieldValidity}
          />
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-semibold text-ink-2">
              Дополнительные workflow-параметры
            </summary>
            <div className="border-t border-line-2 p-3">
              <DriverFields
                fields={DRIVER_DOMAINS.llm.advanced}
                scenario={draftScenario}
                baselineScenario={model.active}
                instagramSource={draftConfig.instagram_source}
                onChange={setDriverValue}
                onValidityChange={setFieldValidity}
              />
            </div>
          </details>
          <div className="space-y-3 border-t border-line-2 pt-4">
            <label className="grid gap-1.5 text-[12px] font-medium text-ink-2">
              <span>LLM-провайдер / модель</span>
              <Input
                aria-label="LLM-провайдер / модель"
                value={draftConfig.llm_provider}
                maxLength={80}
                className="h-9"
                onChange={(event) => setConfigValue("llm_provider", event.currentTarget.value)}
              />
              {draftConfig.llm_provider !== model.config.llm_provider && (
                <span className="text-[10px] font-normal text-primary">
                  Было {model.config.llm_provider} → станет {draftConfig.llm_provider}
                </span>
              )}
            </label>
            {renderConfigFields(LLM_RATE_FIELDS)}
            <SourceRow name="Google Gemini" source={source} />
          </div>
        </div>
      )
    }

    if (domain === "providers") {
      return (
        <div className="space-y-4">
          {renderConfigFields(PROVIDER_FIELDS)}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setConfigValue("scrapecreators_pack_price_usd", 47)
                setConfigValue("scrapecreators_pack_credits", 25_000)
                setConfigValue("scrapecreators_price_per_1000", 1.88)
              }}
              className="rounded-md border border-border px-3 py-2 text-[12px] font-medium hover:border-primary hover:bg-accent-soft"
            >
              Freelance · $47 / 25k
            </button>
            <button
              type="button"
              onClick={() => {
                setConfigValue("scrapecreators_pack_price_usd", 497)
                setConfigValue("scrapecreators_pack_credits", 500_000)
                setConfigValue("scrapecreators_price_per_1000", 0.994)
              }}
              className="rounded-md border border-border px-3 py-2 text-[12px] font-medium hover:border-primary hover:bg-accent-soft"
            >
              Business · $497 / 500k
            </button>
          </div>
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-semibold text-ink-2">
              Pack и ставки Apify
            </summary>
            <div className="border-t border-line-2 p-3">
              {renderConfigFields(PROVIDER_ADVANCED_FIELDS)}
            </div>
          </details>
          <div className="space-y-3 border-t border-line-2 pt-4">
            <div>
              <h4 className="text-[12px] font-semibold">Наблюдаемое состояние</h4>
              <p className="mt-1 text-[11px] leading-4 text-ink-3">
                Баланс credits влияет на следующее пополнение cash, но не меняет COGS уже потреблённого usage.
              </p>
            </div>
            {renderConfigFields(PROVIDER_STATE_FIELDS)}
          </div>
          <div className="border-t border-line-2 pt-1">
            <SourceRow name="ScrapeCreators" source={model.pricing_sources.scrapecreators} />
            <SourceRow name="Apify" source={model.pricing_sources.apify} />
            <SourceRow name="YouTube Data API" source={model.pricing_sources.youtube} />
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        {renderConfigFields(COMMERCIAL_FIELDS)}
        <div className="rounded-md border border-line-2 bg-muted/25 px-3 py-2.5 text-[11px] leading-4 text-ink-3">
          Churn и CAC используются только в planning proxy LTV/payback. Payment fee попадает в переменный COGS; hosting и support остаются отдельными статьями сервиса.
        </div>
        <SourceRow name="Коммерческие допущения" source={model.pricing_sources.commercial} />
      </div>
    )
  }

  const allowance = previewActive.usage.allowance
  const impactTariff = previewActive.economics.by_tariff.find((tariff) => tariff.clients > 0)
    ?? previewActive.economics.by_tariff[0]

  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          aria-label="Операционные драйверы и допущения"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 items-center gap-2 text-left text-[13px] font-semibold hover:text-primary"
        >
          <span aria-hidden="true" className="w-4 text-ink-3">{open ? "−" : "+"}</span>
          <span>Операционные драйверы и допущения</span>
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
          <span>{model.active.label}</span>
          <span>{parameterCount} параметров</span>
          <span className={hasStaleSource ? "font-medium text-warn" : undefined}>
            {hasStaleSource
              ? "есть источник старше 90 дней"
              : sourceDate
                ? `ставки проверены ${checkedDate(sourceDate)}`
                : "есть непроверенные ставки"}
          </span>
          {warnings > 0 && <span className="font-medium text-warn">{warnings} предупрежд.</span>}
        </div>
      </div>

      {open && (
        <div className="border-t border-line-2">
          <div className="grid min-w-0 xl:grid-cols-[210px_minmax(0,1fr)]">
            <nav
              aria-label="Разделы операционной модели"
              className="flex gap-1 overflow-x-auto border-b border-line-2 p-2 xl:flex-col xl:border-b-0 xl:border-r"
            >
              {(Object.keys(DOMAIN_LABELS) as DomainKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={DOMAIN_LABELS[key]}
                  aria-pressed={domain === key}
                  onClick={() => setDomain(key)}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-2 text-left text-[12px] font-medium transition-colors",
                    domain === key
                      ? "bg-accent-soft text-primary"
                      : "text-ink-2 hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <span className="block">{DOMAIN_LABELS[key]}</span>
                  <span className={cn(
                    "mt-0.5 block max-w-[220px] truncate text-[10px] font-normal",
                    domain === key ? "text-primary/75" : "text-ink-3",
                  )}>
                    {domainUsageSummary(key, previewActive, draftConfig, cur)}
                  </span>
                </button>
              ))}
            </nav>

            <div className="grid min-w-0 gap-0 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 p-3 sm:p-4">
                <div className="mb-4 border-b border-line-2 pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[15px] font-semibold">{DOMAIN_LABELS[domain]}</h3>
                    <button
                      type="button"
                      aria-label={`Сбросить ${DOMAIN_LABELS[domain]}`}
                      onClick={resetDomainDraft}
                      disabled={domainChangeCount === 0}
                      className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-ink-2 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Сбросить раздел{domainChangeCount > 0 ? ` · ${domainChangeCount}` : ""}
                    </button>
                  </div>
                  <p className="mt-1 max-w-2xl text-[12px] leading-5 text-ink-3">{DOMAIN_HELP[domain]}</p>
                </div>
                {renderDomain()}
              </div>

              <aside className="border-t border-line-2 bg-muted/20 p-3 sm:p-4 xl:border-l xl:border-t-0">
                <div className="xl:sticky xl:top-4">
                  <h3 className="text-[14px] font-semibold">Влияние на модель</h3>
                  <p className="mt-1 text-[11px] leading-4 text-ink-3">
                    {previewState === "loading" ? "Пересчитываю draft…" : "Сравнение с сохранённым сценарием"}
                  </p>
                  <dl className="mt-3 divide-y divide-line-2 text-[12px]">
                    <div className="flex items-center justify-between gap-3 py-2">
                      <dt className="text-ink-2">Provider COGS</dt>
                      <dd className="text-right font-semibold tnum">
                        {money(previewActive.economics.provider_monthly_base)} {cur}
                        <span className="ml-1 text-[11px] font-medium">
                          <Delta
                            value={previewActive.economics.provider_monthly_base - baseline.economics.provider_monthly_base}
                            suffix={` ${cur}`}
                          />
                        </span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <dt className="text-ink-2">Операционная прибыль</dt>
                      <dd className="text-right font-semibold tnum">
                        {signedMoney(previewActive.economics.operating_profit_base, cur)}
                        <span className="ml-1 text-[11px] font-medium">
                          <Delta
                            value={previewActive.economics.operating_profit_base - baseline.economics.operating_profit_base}
                            suffix={` ${cur}`}
                          />
                        </span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <dt className="text-ink-2">Gross margin</dt>
                      <dd className="text-right font-semibold tnum">
                        {pct(previewActive.economics.gross_margin_pct)}
                        <span className="ml-1 text-[11px] font-medium">
                          <Delta
                            value={(
                              (previewActive.economics.gross_margin_pct ?? 0)
                              - (baseline.economics.gross_margin_pct ?? 0)
                            ) * 100}
                            suffix=" п.п."
                          />
                        </span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <dt className="text-ink-2">Allowance / клиент</dt>
                      <dd className={cn(
                        "text-right font-semibold tnum",
                        allowance.overage_usd > 0 ? "text-neg" : "text-pos",
                      )}>
                        {allowance.overage_usd > 0
                          ? `сверх ${usd(allowance.overage_usd)}`
                          : `остаток ${usd(allowance.remaining_usd)}`}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <dt className="text-ink-2">Следующее пополнение</dt>
                      <dd className="text-right font-semibold tnum">{usd(previewActive.capacity.next_topup_cash_usd, 2)}</dd>
                    </div>
                  </dl>

                  {topDriver && (
                    <p
                      aria-label={`Главный provider-драйвер: ${topDriver.label}`}
                      className="mt-3 rounded-md border border-line-2 bg-card px-3 py-2 text-[11px] leading-4 text-ink-2"
                    >
                      Главный provider-драйвер: <b>{topDriver.label}</b> · <span className="tnum">{usd(topDriver.costUsd)}</span> / Managed-клиент.
                    </p>
                  )}

                  {impactTariff?.is_byo && (
                    <p className="mt-3 rounded-md bg-accent-soft px-3 py-2 text-[11px] leading-4 text-primary">
                      BYO: usage и quota считаются, но provider COGS оплачивает клиент. Hosting, support и payment fees остаются в модели.
                    </p>
                  )}

                  <div className="mt-3 border-t border-line-2 pt-3 text-[11px] leading-4 text-ink-3">
                    <Formula domain={domain} config={draftConfig} />
                  </div>

                  {journal.length > 0 && (
                    <section className="mt-4 border-t border-line-2 pt-3">
                      <h3 className="text-[12px] font-semibold">Последние изменения</h3>
                      <p className="mt-0.5 text-[10px] leading-4 text-ink-3">Локальный журнал этого сервиса на устройстве.</p>
                      <ol className="mt-2 space-y-2">
                        {journal.slice(0, 3).map((entry) => (
                          <li key={entry.id} className="rounded-md border border-line-2 bg-card px-2.5 py-2 text-[10px] leading-4">
                            <div className="font-medium text-ink-2">
                              {SCENARIO_LABELS[entry.scenario]} · {new Date(entry.appliedAt).toLocaleString("ru-RU", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                            <ul className="mt-1 text-ink-3">
                              {entry.changes.map((change) => <li key={change}>{change}</li>)}
                            </ul>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                </div>
              </aside>
            </div>
          </div>

          <div className="sticky bottom-0 z-20 flex flex-col gap-2 border-t border-line-2 bg-card/95 px-3 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="min-h-5 text-[12px] text-ink-2" aria-live="polite">
              {invalidCount > 0
                ? `Исправьте ${invalidCount} ${invalidCount === 1 ? "поле" : "поля"}`
                : changeCount > 0
                ? unsavedLabel(changeCount)
                : "Все изменения сохранены"}
              {previewState === "loading" && <span className="ml-2 text-ink-3">· пересчёт…</span>}
              {previewState === "ready" && <span className="ml-2 text-pos">· preview обновлён</span>}
              {previewState === "error" && <span className="ml-2 text-neg">· preview не обновился</span>}
              {applyState === "saved" && <span className="ml-2 text-pos">· применено</span>}
              {applyState === "error" && <span className="ml-2 text-neg">· не удалось применить, draft сохранён</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {model.active.key !== "base" && (
                <button
                  type="button"
                  onClick={() => {
                    const base = model.scenarios.find((scenario) => scenario.key === "base")
                    if (base) setDraftDrivers({ ...base.drivers })
                  }}
                  className="h-9 rounded-md border border-border px-3 text-[12px] font-medium text-ink-2 hover:bg-muted"
                >
                  Скопировать из Base
                </button>
              )}
              <button
                type="button"
                onClick={resetDraft}
                disabled={changeCount === 0}
                className="h-9 rounded-md border border-border px-3 text-[12px] font-medium text-ink-2 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
              >
                Отменить
              </button>
              <button
                type="button"
                aria-label={`Применить ${changeCount} ${changeNoun(changeCount)}`}
                onClick={() => { void applyDraft() }}
                disabled={changeCount === 0 || invalidCount > 0 || applyState === "saving"}
                className="h-9 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {applyState === "saving" ? "Применяю…" : `Применить ${changeCount} ${changeNoun(changeCount)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
