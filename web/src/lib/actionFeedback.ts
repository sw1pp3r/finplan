export const ACTION_FEEDBACK_EVENT = "finplan:action-feedback"

export type ActionFeedbackDetail = {
  message: string
}
export function reportActionError(message: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<ActionFeedbackDetail>(ACTION_FEEDBACK_EVENT, {
      detail: { message },
    }),
  )
}

export function mutationErrorMessage(method: string, status?: number): string {
  if (status === 422) return "Не удалось сохранить: проверьте введённые данные."
  if (method === "DELETE") return "Не удалось удалить. Проверьте соединение и попробуйте ещё раз."
  return "Не удалось сохранить изменения. Проверьте соединение и попробуйте ещё раз."
}
