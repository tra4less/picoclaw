import { IconAlertCircle, IconCheck, IconChevronDown, IconChevronRight, IconClockHour4, IconLoader2 } from "@tabler/icons-react"
import { useState } from "react"

import { cn } from "@/lib/utils"
import type { ChatStructuredProgress } from "@/store/chat"

function ToolProgressStatusIcon({ status }: { status?: string }) {
  const normalized = (status ?? "").toLowerCase()

  if (normalized === "completed") {
    return (
      <span className="mt-0.5 flex size-5 items-center justify-center rounded-full border border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
        <IconCheck className="size-3.5" />
      </span>
    )
  }
  if (normalized === "error") {
    return (
      <span className="mt-0.5 flex size-5 items-center justify-center rounded-full border border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-300">
        <IconAlertCircle className="size-3.5" />
      </span>
    )
  }
  if (normalized === "running" || normalized === "in-progress") {
    return (
      <span className="mt-0.5 flex size-5 items-center justify-center rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-300">
        <IconLoader2 className="size-3.5 animate-spin" />
      </span>
    )
  }

  return (
    <span className="mt-0.5 flex size-5 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground">
      <IconClockHour4 className="size-3" />
    </span>
  )
}

export function ToolProgressPanel({
  items,
  title,
}: {
  items: ChatStructuredProgress[]
  title?: string
}) {
  const [isOpen, setIsOpen] = useState(true)
  const completedCount = items.filter(
    (item) => (item.status ?? "").toLowerCase() === "completed",
  ).length
  const panelTitle = title?.trim() || "执行过程"

  if (items.length === 0) {
    return null
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left hover:bg-muted/20"
      >
        {isOpen ? (
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 text-sm font-medium text-foreground">
          {panelTitle}
          <span className="ml-1 text-muted-foreground">({completedCount}/{items.length})</span>
        </div>
      </button>
      {isOpen && (
        <div className="px-3 py-2">
          {items.map((item, index) => {
            const normalized = (item.status ?? "").toLowerCase()
            const itemTitle = item.title?.trim() || `执行步骤 ${index + 1}`

            return (
              <div
                key={`${itemTitle}-${index}`}
                className="flex items-start gap-3 rounded-md px-1.5 py-2 hover:bg-muted/20"
              >
                <ToolProgressStatusIcon status={item.status} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div
                    className={cn(
                      "break-words text-[14px] leading-5 text-foreground",
                      normalized === "completed" && "text-muted-foreground line-through",
                    )}
                  >
                    {itemTitle}
                  </div>
                  {item.content?.trim() && (
                    <div className="text-xs leading-5 text-muted-foreground">{item.content}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
