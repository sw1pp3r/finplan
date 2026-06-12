import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

// Первый запуск: объясняем, откуда берутся числа, и проводим по настройке.
// Показывается, пока пользователь не нажал «Понятно» (флаг в localStorage).
// Повторно открывается событием "finplan:show-onboarding" (кнопка в шапке).
const SEEN_KEY = "finplan_onboarded_v1"

type ModelPoint = { title: string; body: string }

const MODEL: ModelPoint[] = [
  {
    title: "Снимок → точка отсчёта (T0)",
    body:
      "На вкладке «Снимок» вы вписываете текущие остатки по каждому счёту. Самый свежий снимок — это T0, точка, из которой стартует прогноз. Несколько снимков подряд дают скорость «прожигания» (burn) — на сколько в неделю тает баланс.",
  },
  {
    title: "Доходы → ожидаемые поступления",
    body:
      "«Доходы» — это будущие приходы (инвойсы, зарплата, оплаты). Со статусом «ожидается» они поднимают кривую прогноза в день поступления. Когда деньги пришли — переводите строку в «получено», и она уже сидит в остатках следующего снимка.",
  },
  {
    title: "Расходы → обязательства",
    body:
      "«Расходы» — это будущие списания: аренда, налоги, подписки, разовые платежи. Разовые вычитаются в свою дату, повторяющиеся (ежемесячно/еженедельно/ежегодно) — на каждую дату до конца горизонта.",
  },
  {
    title: "Прогноз и разрыв (gap)",
    body:
      "Дашборд строит кривую баланса вперёд: T0 минус burn, минус обязательства, плюс ожидаемые доходы. Если кривая опускается ниже вашей «подушки» (cushion) — показывается разрыв: сколько не хватает и к какой дате. Три сценария (пессимистичный / базовый / оптимистичный) зависят от вероятности доходов.",
  },
]

const STEPS = [
  { to: "/settings", label: "Настройки", text: "Задайте базовую валюту, размер подушки и горизонт прогноза." },
  { to: "/snapshot", label: "Снимок", text: "Добавьте счета и впишите текущие остатки — это T0." },
  { to: "/plans", label: "Расходы", text: "Внесите регулярные и разовые обязательства." },
  { to: "/income", label: "Доходы", text: "Добавьте ожидаемые поступления, если они есть." },
  { to: "/", label: "Дашборд", text: "Смотрите кривую, разрыв и хватает ли подушки." },
]

export default function Onboarding() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(SEEN_KEY)) setOpen(true)
    const show = () => setOpen(true)
    window.addEventListener("finplan:show-onboarding", show)
    return () => window.removeEventListener("finplan:show-onboarding", show)
  }, [])

  function dismiss() {
    localStorage.setItem(SEEN_KEY, "1")
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Знакомство с finplan"
    >
      <div
        className="my-8 w-full max-w-2xl rounded-xl border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-6 py-5">
          <div className="font-mono text-sm font-bold tracking-tight">
            fin<span className="text-muted-foreground">plan</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold">Планировщик cash-flow, а не трекер расходов</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            finplan отвечает на один вопрос: хватит ли денег на горизонте и где провал. Вот откуда
            берутся числа.
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          {MODEL.map((m) => (
            <div key={m.title} className="rounded-lg border bg-secondary/30 p-4">
              <div className="text-sm font-semibold">{m.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{m.body}</p>
            </div>
          ))}
        </div>

        <div className="border-t px-6 py-5">
          <div className="text-sm font-semibold">С чего начать</div>
          <ol className="mt-3 space-y-2">
            {STEPS.map((s, i) => (
              <li key={s.to} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
                  {i + 1}
                </span>
                <span>
                  <Link to={s.to} onClick={dismiss} className="font-medium underline-offset-2 hover:underline">
                    {s.label}
                  </Link>{" "}
                  <span className="text-muted-foreground">— {s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">
            Совет: включите тумблер «Демо» в шапке, чтобы посмотреть приложение с примерными данными —
            ваши настоящие данные при этом не трогаются.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <button
            onClick={dismiss}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Понятно, начать
          </button>
        </div>
      </div>
    </div>
  )
}
