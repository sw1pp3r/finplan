import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Маленький «?» с подсказкой при наведении — для неочевидных полей и ярлыков.
 * Простой RU-текст внутри. Не ломает раскладку: инлайновый кружок рядом с подписью.
 */
export function InfoHint({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ?? "Подсказка"}
          className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border text-[0.65rem] leading-none text-muted-foreground transition-colors hover:bg-muted"
          onClick={(e) => e.preventDefault()}
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{children}</TooltipContent>
    </Tooltip>
  )
}
