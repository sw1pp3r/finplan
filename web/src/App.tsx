import { Link, NavLink, Route, Routes } from "react-router-dom"
import Dashboard from "@/pages/Dashboard"
import Snapshot from "@/pages/Snapshot"
import Plans from "@/pages/Plans"
import Income from "@/pages/Income"
import Course from "@/pages/Course"
import Wishes from "@/pages/Wishes"
import Board from "@/pages/Board"
import Settings from "@/pages/Settings"
import { cn } from "@/lib/utils"
import { isDemo, setDemo } from "@/lib/api"
import Onboarding from "@/components/Onboarding"

function showOnboarding() {
  window.dispatchEvent(new Event("finplan:show-onboarding"))
}

function toggleDemo() {
  setDemo(!isDemo())
  location.reload() // перезапрашиваем все вкладки с новым заголовком
}

const nav = [
  { to: "/", label: "Дашборд" },
  { to: "/snapshot", label: "Снимок" },
  { to: "/plans", label: "Расходы" },
  { to: "/income", label: "Доходы" },
  { to: "/course", label: "Курс" },
  { to: "/wishes", label: "Покупки" },
  { to: "/board", label: "Доска" },
  { to: "/settings", label: "Настройки" },
]

export default function App() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-6">
          <Link to="/" className="font-mono text-sm font-bold tracking-tight transition-opacity hover:opacity-70" title="На дашборд">
            fin<span className="text-muted-foreground">plan</span>
          </Link>
          <nav className="flex gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <button
            onClick={showOnboarding}
            title="Как это работает: откуда берутся числа и с чего начать"
            className="ml-auto rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Как это работает
          </button>
          <button
            onClick={toggleDemo}
            title="Демо-режим: фейк-данные для показа на экране"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isDemo()
                ? "bg-orange-500 text-white hover:bg-orange-600"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isDemo() ? "● ДЕМО" : "Демо"}
          </button>
        </div>
      </header>
      <Onboarding />
      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* без анимации перехода — переключение вкладок мгновенное */}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/snapshot" element={<Snapshot />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/income" element={<Income />} />
          <Route path="/course" element={<Course />} />
          <Route path="/wishes" element={<Wishes />} />
          <Route path="/board" element={<Board />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
