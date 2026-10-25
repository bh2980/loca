import { AlertCircle, Check, LoaderCircle } from "lucide-react"
import { Button } from "../../controls/button"

/**
 * The line under an auto-saving form: nothing, "저장 중", "저장했습니다" or "저장하지 못했습니다" with a retry. Announced politely, and a
 * failure assertively.
 */
export function SaveStatusLine({ status, onRetry }: { status: "idle" | "saving" | "saved" | "failed"; onRetry?: () => void }) {
  const failed = status === "failed"
  return (
    <div role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"} className="flex min-h-5 items-center gap-1 text-xs text-muted">
      {status === "saving" && <><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> 저장 중</>}
      {status === "saved" && <><Check aria-hidden="true" className="size-3.5 text-success" /> 저장했습니다</>}
      {failed && <><AlertCircle aria-hidden="true" className="size-3.5 text-danger" /> 저장하지 못했습니다 {onRetry && <Button variant="ghost" onClick={onRetry}>다시 시도</Button>}</>}
    </div>
  )
}
