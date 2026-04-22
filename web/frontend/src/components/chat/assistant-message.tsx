import { IconBrain, IconCheck, IconCopy, IconDownload, IconFileText } from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { inferStructuredContentFromText } from "@/features/chat/structured"
import { formatMessageTime } from "@/hooks/use-pico-chat"
import { cn } from "@/lib/utils"
import type { ChatAttachment, ChatStructuredContent, ChatStructuredProgress, ChatStructuredValue } from "@/store/chat"

import { MARKDOWN_BODY_CLASS, StructuredContentView, renderMarkdown } from "./structured-content"
import { InlinePlanPreview } from "./todo-panel"
import { ToolProgressPanel } from "./tool-progress-panel"

const MESSAGE_CONTENT_CLASS = "min-w-0 flex-1 space-y-2"

interface AssistantMessageProps {
  content: string
  attachments?: ChatAttachment[]
  isThought?: boolean
  timestamp?: string | number
  structured?: ChatStructuredValue
  onSelectOption?: (value: string) => void
}

function isToolProgressStructured(
  structured: ChatStructuredContent,
): structured is ChatStructuredProgress {
  return structured.type === "progress" && structured.kind === "agent/tool-exec"
}

function splitStructuredParts(structured: ChatStructuredValue | undefined): {
  toolProgressParts: ChatStructuredProgress[]
  otherParts: ChatStructuredContent[]
} {
  if (!structured) {
    return { toolProgressParts: [], otherParts: [] }
  }

  const parts = Array.isArray(structured) ? structured : [structured]
  const toolProgressParts: ChatStructuredProgress[] = []
  const otherParts: ChatStructuredContent[] = []

  for (const part of parts) {
    if (isToolProgressStructured(part)) {
      toolProgressParts.push(part)
      continue
    }
    otherParts.push(part)
  }

  return { toolProgressParts, otherParts }
}

function shouldPreferStructuredPanel(structured: ChatStructuredValue | undefined): boolean {
  if (!structured) {
    return false
  }

  const parts = Array.isArray(structured) ? structured : [structured]
  return parts.some(
    (part) =>
      part.type === "todo" ||
      (part.type === "progress" && part.kind === "agent/tool-exec"),
  )
}

export function AssistantMessage({
  content,
  attachments = [],
  isThought = false,
  timestamp = "",
  structured,
  onSelectOption,
}: AssistantMessageProps) {
  const { t } = useTranslation()
  const [isCopied, setIsCopied] = useState(false)
  const formattedTimestamp = timestamp !== "" ? formatMessageTime(timestamp) : ""
  const hasBody = Boolean(content.trim())
  const shouldCollapseThought = isThought && content.trim().length > 160
  const inferredStructured =
    !structured && !isThought ? inferStructuredContentFromText(content) : undefined
  const effectiveStructured = structured ?? inferredStructured
  const { toolProgressParts, otherParts } = splitStructuredParts(effectiveStructured)
  const hasToolProgress = toolProgressParts.length > 0
  const preferStructuredPanel = shouldPreferStructuredPanel(effectiveStructured)
  const shouldShowInlinePlanPreview =
    !effectiveStructured && /规划|计划|阶段|任务分解|项目目标|任务|plan/i.test(content)

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    })
  }

  return (
    <div className="group flex w-full max-w-[820px] gap-3">
      <div className="bg-muted text-muted-foreground mt-5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 text-[11px] font-semibold uppercase">
        AI
      </div>

      <div className={MESSAGE_CONTENT_CLASS}>
        <div className="text-muted-foreground flex items-center gap-2 text-[11px] uppercase tracking-[0.14em]">
          <span>PicoClaw</span>
          {isThought && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium tracking-normal normal-case text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
              <IconBrain className="size-3" />
              <span>{t("chat.reasoningLabel")}</span>
            </span>
          )}
          {formattedTimestamp ? <span className="opacity-60">{formattedTimestamp}</span> : null}
        </div>

        {hasToolProgress && (
          <div className={cn(!hasBody && "pt-1")}>
            <ToolProgressPanel items={toolProgressParts} />
          </div>
        )}

        {hasBody && !isThought && (!preferStructuredPanel || hasToolProgress) && (
          <div className="relative rounded-lg px-1 py-0.5">
            {shouldShowInlinePlanPreview && (
              <div className="mb-3">
                <InlinePlanPreview content={content} />
              </div>
            )}
            <div className={cn(MARKDOWN_BODY_CLASS, "prose-p:my-2 text-[14px] leading-6 text-foreground")}>
              {renderMarkdown(content)}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-0 right-0 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={handleCopy}
            >
              {isCopied ? (
                <IconCheck className="h-4 w-4 text-green-500" />
              ) : (
                <IconCopy className="text-muted-foreground h-4 w-4" />
              )}
            </Button>
          </div>
        )}

        {hasBody && isThought && !shouldCollapseThought && (
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 text-amber-950 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/8 dark:text-amber-100">
            <div className={cn(MARKDOWN_BODY_CLASS, "prose-p:my-1.5 text-[13px] leading-relaxed opacity-90")}>
              {renderMarkdown(content)}
            </div>
          </div>
        )}

        {hasBody && isThought && shouldCollapseThought && (
          <details className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 text-amber-950 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/8 dark:text-amber-100">
            <summary className="cursor-pointer text-sm font-medium opacity-90">
              {t("chat.reasoningLabel")}
            </summary>
            <div className={cn(MARKDOWN_BODY_CLASS, "mt-3 text-[13px] leading-relaxed opacity-90")}>
              {renderMarkdown(content)}
            </div>
          </details>
        )}

        {effectiveStructured && (
          <div className={cn(!hasBody && "pt-1")}>
            {otherParts.length > 0 ? (
              <div className="space-y-3">
                {otherParts.map((part, index) => (
                  <StructuredContentView
                    key={`${part.type}-${index}`}
                    structured={part}
                    onSelectOption={onSelectOption}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}

        {attachments && attachments.length > 0 && (
          <div className="flex flex-col gap-3">
            {attachments
              .filter((a) => a.type === "image")
              .map((attachment, index) => (
                <a
                  key={`${attachment.url}-${index}`}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-hidden rounded-xl border"
                >
                  <img
                    src={attachment.url}
                    alt={attachment.filename || "Attachment"}
                    className="max-h-72 max-w-full object-cover"
                  />
                </a>
              ))}
            {attachments
              .filter((a) => a.type !== "image")
              .map((attachment, index) => (
                <a
                  key={`${attachment.url}-${index}`}
                  href={attachment.url}
                  download={attachment.filename}
                  className="bg-background/70 hover:bg-background/90 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <IconFileText className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate text-sm">{attachment.filename || "Download attachment"}</span>
                  </span>
                  <IconDownload className="text-muted-foreground size-4 shrink-0" />
                </a>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
