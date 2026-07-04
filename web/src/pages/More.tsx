// web/src/pages/More.tsx — «Ещё»: саб-табы Курс | Сервисы
import { NavLink, Navigate, Route, Routes } from "react-router-dom"
import Course from "@/pages/Course"
import Services from "@/pages/Services"
import { cn } from "@/lib/utils"

const tabs = [
  { to: "/more/course", label: "Курс" },
  { to: "/more/services", label: "Сервисы" },
]

export default function More() {
  return (
    <div>
      <nav className="mb-5 flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to}
            className={({ isActive }) => cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
              isActive ? "bg-background text-foreground shadow-sm" : "text-ink-2 hover:text-foreground"
            )}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="/more/course" replace />} />
        <Route path="course" element={<Course />} />
        <Route path="services" element={<Services />} />
      </Routes>
    </div>
  )
}
