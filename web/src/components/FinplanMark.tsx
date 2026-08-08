import { cn } from "@/lib/utils"

type FinplanMarkProps = {
  className?: string
}

export function FinplanMark({ className }: FinplanMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={cn("rounded-[22%] ring-1 ring-black/5 dark:ring-white/10", className)}
      focusable="false"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="14" fill="#09090B" />
      <path
        d="M15 49h5c6.075 0 11-4.925 11-11V20c0-6.075 4.925-11 11-11h7"
        stroke="#FAFAFA"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path d="M10 31h35" stroke="#FAFAFA" strokeWidth="6" strokeLinecap="round" />
      <circle cx="31" cy="31" r="6.5" fill="#09090B" stroke="#FAFAFA" strokeWidth="5" />
      <circle cx="53" cy="31" r="5" fill="#4ADE80" />
    </svg>
  )
}
