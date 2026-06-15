import { useEffect, useState } from "react"
import { api, type Summary } from "@/lib/api"
import { startCoach } from "@/lib/coach"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const DISMISS_KEY = "finplan-onboarding-dismissed"

// Шаг чеклиста: ✓ считается из реальных данных, клик открывает коачмарк нужного шага тура
// (индекс в COACH_STEPS), а не просто перекидывает по роуту.
type Step = { label: string; done: boolean; coachIndex: number }

export function OnboardingChecklist({ summary }: { summary: Summary }) {
  const [counts, setCounts] = useState<{ accounts: number; obligations: number; inflows: number } | null>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1")

  useEffect(() => {
    Promise.all([
      api.get<unknown[]>("/accounts"),
      api.get<unknown[]>("/obligations"),
      api.get<unknown[]>("/inflows"),
    ]).then(([a, o, i]) =>
      setCounts({ accounts: a.length, obligations: o.length, inflows: i.length })
    )
  }, [])

  if (dismissed || !counts) return null

  // порядок — как в туре: валюта/курсы, счета, снимок, расходы, доходы.
  // coachIndex указывает, с какого шага COACH_STEPS открыть коачмарк.
  const steps: Step[] = [
    { label: "Выбери базовую валюту", coachIndex: 0,
      done: counts.accounts > 0 && summary.missing_rates.length === 0 },
    { label: "Заведи счета", coachIndex: 1, done: counts.accounts > 0 },
    { label: "Сделай первый снимок остатков", coachIndex: 2, done: summary.last_snapshot_date != null },
    { label: "Добавь регулярные расходы", coachIndex: 3, done: counts.obligations > 0 },
    { label: "Добавь доходы или ожидаемые поступления", coachIndex: 4, done: counts.inflows > 0 },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1")
    setDismissed(true)
  }

  if (allDone) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
        <span>✓ Всё настроено — finplan готов к работе.</span>
        <button onClick={dismiss} title="Скрыть" className="text-emerald-700 hover:text-emerald-900">×</button>
      </div>
    )
  }

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">С чего начать · {doneCount} из {steps.length} готово</CardTitle>
          <button onClick={dismiss} title="Скрыть чеклист"
            className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground">
            Пропустить
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Нажмите шаг — finplan подсветит нужное поле и подскажет, что и зачем заполнить.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <button
          onClick={() => startCoach(0)}
          className="mb-1 inline-flex w-fit items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Пройти настройку с подсказками →
        </button>
        {steps.map((s) => (
          <button
            key={s.label}
            onClick={() => startCoach(s.coachIndex)}
            className="flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <span className={s.done
              ? "flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs text-white"
              : "flex h-5 w-5 items-center justify-center rounded-full border text-xs text-muted-foreground"}>
              {s.done ? "✓" : ""}
            </span>
            <span className={s.done ? "text-muted-foreground line-through" : "font-medium"}>{s.label}</span>
            <span className="ml-auto text-muted-foreground">{s.done ? "повторить" : "показать →"}</span>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}
