export const ONBOARDING_COMPLETE_KEY = "finplan-onboarded"
export const ONBOARDING_DRAFT_KEY = "finplan-onboarding-draft-v3"
export const ONBOARDING_REPLAY_KEY = "finplan-onboarding-replay"
const ONBOARDING_EVENTS_KEY = "finplan-onboarding-events"

export type OnboardingOutcome = "completed" | "skipped" | "demo"

export function hasOnboardingDraft(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(ONBOARDING_DRAFT_KEY) != null
}

export function isOnboardingReplay(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(ONBOARDING_REPLAY_KEY) === "1"
}

export function readOnboardingDraft<T>(): T | null {
  if (typeof localStorage === "undefined") return null
  const raw = localStorage.getItem(ONBOARDING_DRAFT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    localStorage.removeItem(ONBOARDING_DRAFT_KEY)
    return null
  }
}

export function writeOnboardingDraft(value: unknown): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(value))
}

export function clearOnboardingDraft(): void {
  if (typeof localStorage === "undefined") return
  localStorage.removeItem(ONBOARDING_DRAFT_KEY)
  localStorage.removeItem(ONBOARDING_REPLAY_KEY)
}

export function resetOnboarding(): void {
  if (typeof localStorage === "undefined") return
  localStorage.removeItem(ONBOARDING_COMPLETE_KEY)
  localStorage.removeItem(ONBOARDING_DRAFT_KEY)
  localStorage.removeItem("finplan-onboarding-dismissed")
  localStorage.setItem(ONBOARDING_REPLAY_KEY, "1")
}

export function trackOnboardingEvent(
  name: string,
  detail: Record<string, string | number | boolean | null> = {},
): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return
  const event = { name, at: new Date().toISOString(), ...detail }
  let history: unknown[]
  try {
    const raw = localStorage.getItem(ONBOARDING_EVENTS_KEY)
    history = raw ? JSON.parse(raw) as unknown[] : []
    if (!Array.isArray(history)) history = []
  } catch {
    history = []
  }
  localStorage.setItem(ONBOARDING_EVENTS_KEY, JSON.stringify([...history.slice(-49), event]))
  window.dispatchEvent(new CustomEvent("finplan:onboarding", { detail: event }))
}
