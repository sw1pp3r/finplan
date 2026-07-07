import { useEffect, useState } from "react"
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom"
import {
  LayoutDashboard,
  Wallet,
  TrendingUp,
  TrendingDown,
  Flag,
  MoreHorizontal,
  SlidersHorizontal,
  LineChart,
  Moon,
  Sun,
} from "lucide-react"
import Dashboard from "@/pages/Dashboard"
import Snapshot from "@/pages/Snapshot"
import Plans from "@/pages/Plans"
import Income from "@/pages/Income"
import More from "@/pages/More"
import Wishes from "@/pages/Wishes"
import Settings from "@/pages/Settings"
import { cn } from "@/lib/utils"
import { api, isDemo, setDemo, type Account, type Settings as SettingsData } from "@/lib/api"
import OnboardingWizard from "@/components/OnboardingWizard"
import { useShowCourse } from "@/lib/prefs"
import { useTheme, toggleTheme } from "@/lib/theme"
import { CoachTour } from "@/components/CoachTour"

function toggleDemo() {
  setDemo(!isDemo())
  location.reload() // перезапрашиваем все вкладки с новым заголовком
}

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard }

// Порядок и имена — финал по мастер-ТЗ: Дашборд · Баланс · Доходы · Расходы · Мечты · Ещё · Настройки.
const navMain: NavItem[] = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard },
  { to: "/balance", label: "Баланс", icon: Wallet },
  { to: "/income", label: "Доходы", icon: TrendingUp },
  { to: "/expenses", label: "Расходы", icon: TrendingDown },
  { to: "/wishes", label: "Мечты", icon: Flag },
  { to: "/more", label: "Ещё", icon: MoreHorizontal },
]

function NavRow({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      data-coach={item.to === "/settings" ? "nav-settings" : undefined}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-sm font-medium transition-colors",
          isActive
            ? "border-border bg-card text-foreground shadow-sm"
            : "text-ink-2 hover:bg-card-2 hover:text-foreground"
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              "size-[18px] shrink-0 transition-colors",
              isActive ? "text-primary" : "text-ink-2 opacity-80 group-hover:text-foreground"
            )}
            strokeWidth={1.7}
          />
          {item.label}
        </>
      )}
    </NavLink>
  )
}

function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "•"
  return parts.slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}

export default function App() {
  const showCourse = useShowCourse()
  const theme = useTheme()
  const visibleNav = navMain

  // Имя пользователя из настроек (демо → «Артём», реальная БД → заданное в Настройках).
  const [profileName, setProfileName] = useState("")
  useEffect(() => {
    let alive = true
    api.get<SettingsData>("/settings")
      .then((s) => { if (alive) setProfileName(s.display_name ?? "") })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Онбординг: на пустой реальной БД (не демо, не пройден) показываем полноэкранный мастер.
  const [onboarding, setOnboarding] = useState<"loading" | "show" | "hide">("loading")
  useEffect(() => {
    if (isDemo() || localStorage.getItem("finplan-onboarded") === "1") {
      setOnboarding("hide")
      return
    }
    let alive = true
    api
      .get<Account[]>("/accounts")
      .then((accts) => {
        if (alive) setOnboarding(accts.length === 0 ? "show" : "hide")
      })
      .catch(() => {
        if (alive) setOnboarding("hide")
      })
    return () => {
      alive = false
    }
  }, [])

  // react-router не скроллит к #hash сам — ждём появления якоря и скроллим
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const id = hash.slice(1)
    let cancelled = false
    let tries = 0
    const tick = () => {
      if (cancelled) return
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" })
        return
      }
      if (tries++ < 40) setTimeout(tick, 50)
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [hash])

  const demo = isDemo()

  if (onboarding === "show") {
    return (
      <OnboardingWizard
        onDone={() => {
          localStorage.setItem("finplan-onboarded", "1")
          setOnboarding("hide")
          location.reload()
        }}
      />
    )
  }

  return (
    <div className="min-h-svh bg-background text-foreground lg:grid lg:grid-cols-[248px_1fr]">
      {/* ===== sidebar (desktop) ===== */}
      <aside className="sticky top-0 hidden h-svh flex-col gap-[3px] border-r border-border bg-sidebar px-3.5 py-5 lg:flex">
        <div className="flex items-center gap-2.5 px-2 pb-5 pt-1.5">
          <span className="grid size-[29px] place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <LineChart className="size-4" strokeWidth={2.2} />
          </span>
          <span className="text-base font-semibold tracking-tight">finplan</span>
        </div>

        {visibleNav.map((n) => (
          <NavRow key={n.to} item={n} />
        ))}

        <div className="flex-1" />

        <NavRow item={{ to: "/settings", label: "Настройки", icon: SlidersHorizontal }} />

        <div className="mt-1.5 flex items-center gap-3 rounded-[10px] border border-border bg-card px-2.5 py-2.5">
          <span className="grid size-[33px] shrink-0 place-items-center rounded-[9px] bg-primary text-[13px] font-semibold text-primary-foreground">
            {profileInitials(profileName)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium leading-tight">{profileName.trim() || "Профиль"}</div>
          </div>
        </div>
      </aside>

      {/* ===== main ===== */}
      <div className="flex min-w-0 flex-col lg:h-svh lg:overflow-y-auto">
        {/* mobile top bar with brand + horizontal nav */}
        <div className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <LineChart className="size-5 text-primary" strokeWidth={2.2} />
            <span className="text-sm font-semibold">finplan</span>
            <div className="ml-auto flex items-center gap-2">
              <DemoButton demo={demo} />
              <ThemeButton theme={theme} />
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
            {[...visibleNav, { to: "/settings", label: "Настройки", icon: SlidersHorizontal }].map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive ? "bg-card font-medium text-foreground shadow-sm" : "text-ink-2"
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* desktop top bar: theme + demo (right) */}
        <div className="hidden items-center justify-end gap-2 px-9 pt-5 lg:flex">
          <DemoButton demo={demo} />
          <ThemeButton theme={theme} />
        </div>

        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-9 lg:pb-16 lg:pt-4">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/balance" element={<Snapshot />} />
            <Route path="/snapshot" element={<Navigate to="/balance" replace />} />
            <Route path="/income" element={<Income />} />
            <Route path="/expenses" element={<Plans />} />
            <Route path="/plans" element={<Navigate to="/expenses" replace />} />
            <Route path="/wishes" element={<Wishes />} />
            <Route path="/board" element={<Navigate to="/wishes?view=board" replace />} />
            <Route path="/more/*" element={<More />} />
            <Route path="/course" element={<Navigate to={showCourse ? "/more/course" : "/more/services"} replace />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
      <CoachTour />
    </div>
  )
}

function ThemeButton({ theme }: { theme: string }) {
  return (
    <button
      onClick={toggleTheme}
      aria-label="Сменить тему"
      title="Светлая / тёмная тема"
      className="grid size-[37px] place-items-center rounded-[9px] border border-border bg-card text-ink-2 transition-colors hover:border-ink-3 hover:text-foreground"
    >
      {theme === "dark" ? <Sun className="size-[18px]" strokeWidth={1.8} /> : <Moon className="size-[18px]" strokeWidth={1.8} />}
    </button>
  )
}

function DemoButton({ demo }: { demo: boolean }) {
  return (
    <button
      onClick={toggleDemo}
      title="Демо-режим: показывает выдуманные данные, ваши не трогает"
      className={cn(
        "h-[37px] rounded-[9px] px-3 text-sm font-medium transition-colors",
        demo
          ? "bg-primary text-primary-foreground hover:brightness-105"
          : "border border-border bg-card text-ink-2 hover:border-ink-3 hover:text-foreground"
      )}
    >
      {demo ? "● Демо" : "Демо"}
    </button>
  )
}
