import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ActionFeedback } from "@/components/ActionFeedback"
import { api } from "@/lib/api"
import { ACTION_FEEDBACK_EVENT, reportActionError } from "@/lib/actionFeedback"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("глобальный feedback ошибок действий", () => {
  it("показывает безопасное сообщение при неудачной мутации", async () => {
    const listener = vi.fn()
    window.addEventListener(ACTION_FEEDBACK_EVENT, listener)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal secret traceback",
    }))

    await expect(api.patch("/settings", { cushion: 100 })).rejects.toThrow()

    expect(listener).toHaveBeenCalledOnce()
    const event = listener.mock.calls[0][0] as CustomEvent<{ message: string }>
    expect(event.detail.message).toMatch(/Не удалось сохранить/)
    expect(event.detail.message).not.toContain("traceback")
    window.removeEventListener(ACTION_FEEDBACK_EVENT, listener)
  })

  it("не создаёт action-alert для фонового GET", async () => {
    const listener = vi.fn()
    window.addEventListener(ACTION_FEEDBACK_EVENT, listener)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    }))

    await expect(api.get("/summary")).rejects.toThrow()
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(ACTION_FEEDBACK_EVENT, listener)
  })

  it("позволяет штатному retry подавить промежуточную ошибку", async () => {
    const listener = vi.fn()
    window.addEventListener(ACTION_FEEDBACK_EVENT, listener)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "rate is missing",
    }))

    await expect(api.patch("/settings", { base_currency: "RUB" }, { feedback: false })).rejects.toThrow()
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(ACTION_FEEDBACK_EVENT, listener)
  })

  it("рендерит доступное сообщение, которое можно закрыть", () => {
    render(<ActionFeedback />)

    act(() => reportActionError("Не удалось сохранить изменения."))
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось сохранить изменения.")

    fireEvent.click(screen.getByRole("button", { name: "Закрыть сообщение об ошибке" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
