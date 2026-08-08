import { useEffect, useState } from "react"
import { ArrowRight, Check, X } from "lucide-react"
import { api, type Account, type Summary } from "@/lib/api"
import { startCoach } from "@/lib/coach"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const DISMISS_KEY = "finplan-onboarding-dismissed"

type Step = { label: string; detail: string; done: boolean; coachIndex: number }

export function OnboardingChecklist({ summary }: { summary: Summary }) {
  const [counts, setCounts] = useState<{ accounts: Account[]; obligations: number; inflows: number } | null>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1")

  useEffect(() => {
    let alive = true
    Promise.all([
      api.get<Account[]>("/accounts"),
      api.get<unknown[]>("/obligations"),
      api.get<unknown[]>("/inflows"),
    ])
      .then(([a, o, i]) => {
        if (alive) setCounts({ accounts: a, obligations: o.length, inflows: i.length })
      })
      .catch(() => {
        if (alive) setCounts(null)
      })
    return () => {
      alive = false
    }
  }, [])

  if (dismissed || !counts) return null

  const hasQuickAccount = counts.accounts.some((account) => account.name === "Основной баланс")
  const steps: Step[] = [
    {
      label: counts.accounts.length === 0 ? "Добавить стартовый счёт" : "Разбить баланс по счетам",
      detail: counts.accounts.length === 0
        ? "Без счёта и остатка у прогноза нет стартовой точки."
        : "Так обновлять остатки будет быстрее и точнее.",
      coachIndex: 1,
      done: counts.accounts.length > 0 && !hasQuickAccount,
    },
    {
      label: "Зафиксировать актуальные остатки",
      detail: "Снимок становится стартовой точкой линии прогноза.",
      coachIndex: 2,
      done: summary.last_snapshot_date != null,
    },
    {
      label: "Уточнить обязательные расходы",
      detail: "Добавьте даты и отдельные платежи, которые нельзя пропустить.",
      coachIndex: 3,
      done: counts.obligations > 0,
    },
    {
      label: "Добавить ожидаемое поступление",
      detail: "Нерегулярные деньги попадут в прогноз с вероятностью.",
      coachIndex: 4,
      done: counts.inflows > 0,
    },
    {
      label: "Проверить валюты",
      detail: "Нужен курс для каждой валюты, участвующей в прогнозе.",
      coachIndex: 0,
      done: summary.missing_rates.length === 0,
    },
  ]
  const nextSteps = steps.filter((step) => !step.done).slice(0, 2)

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1")
    setDismissed(true)
  }

  if (!nextSteps.length) return null

  return (
    <Card className="border-primary/20 bg-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Сделать прогноз точнее</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Первый расчёт уже работает. Вот {nextSteps.length === 1 ? "следующий шаг" : "два самых полезных уточнения"}.
            </p>
          </div>
          <button
            onClick={dismiss}
            title="Скрыть рекомендации"
            aria-label="Скрыть рекомендации по уточнению прогноза"
            className="touch-target grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-2">
        {nextSteps.map((step) => (
          <button
            key={step.label}
            onClick={() => startCoach(step.coachIndex)}
            className="group flex min-h-20 items-center gap-3 rounded-xl bg-muted/55 px-4 py-3 text-left transition-colors hover:bg-muted"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-primary ring-1 ring-foreground/10">
              <Check className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{step.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{step.detail}</span>
            </span>
            <ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </button>
        ))}
      </CardContent>
    </Card>
  )
}
