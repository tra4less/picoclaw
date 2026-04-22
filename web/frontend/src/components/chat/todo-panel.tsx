import { IconCheck, IconChevronDown, IconChevronRight, IconClockHour4, IconLoader2 } from "@tabler/icons-react"
import { useState } from "react"

import { cn } from "@/lib/utils"
import type { ChatTodoItem } from "@/store/chat"

export function TodoStatusIcon({ status }: { status?: ChatTodoItem["status"] }) {
  if (status === "completed") {
    return (
      <span className="mt-0.5 flex size-5 items-center justify-center rounded-full border border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
        <IconCheck className="size-3.5" />
      </span>
    )
  }
  if (status === "in-progress") {
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

function isPlanLikeTodo(title?: string, content?: string, items: ChatTodoItem[] = []): boolean {
  const normalized = [title, content, ...items.map((item) => item.title)]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .toLowerCase()

  return /计划|规划|待办|任务|执行|步骤|拆解|plan|todo|task|tasks|step|steps|phase|milestone|implement|fix|review|verify|ship|refactor/.test(
    normalized,
  )
}

function hasInformationalTitleShape(title: string): boolean {
  if (/[:：]/.test(title)) {
    return true
  }

  return /km|公里|m\b|米|预算|时间|海拔|难度|装备|温差|距离|费用|日期|人数|路线|目录|文件|路径|版本|状态|配置|说明|摘要|总结|结果/i.test(
    title,
  )
}

function hasInformationalPanelTitle(title?: string): boolean {
  if (!title?.trim()) {
    return false
  }

  return /概述|概览|总览|摘要|总结|路线|信息|说明|结果|清单|一览|概况|overview|summary|outline|brief/i.test(
    title,
  )
}

function isInformationalTodo(
  title: string | undefined,
  content: string | undefined,
  items: ChatTodoItem[],
): boolean {
  if (items.length === 0 || items.some((item) => item.status)) {
    return false
  }

  if (hasInformationalPanelTitle(title)) {
    return true
  }

  if (isPlanLikeTodo(title, content, items)) {
    return false
  }

  const informationalCount = items.filter((item) => hasInformationalTitleShape(item.title)).length
  return informationalCount >= Math.max(1, Math.ceil(items.length / 2))
}

function splitInformationalTitle(title: string): { label: string; value?: string } {
  const match = title.match(/^([^:：]+)[:：]\s*(.+)$/)
  if (!match) {
    return { label: title }
  }

  return {
    label: match[1]?.trim() ?? title,
    value: match[2]?.trim() || undefined,
  }
}

function InformationalListPanel({
  title,
  content,
  items,
}: {
  title?: string
  content?: string
  items: ChatTodoItem[]
}) {
  const [isOpen, setIsOpen] = useState(true)
  const panelTitle = title?.trim() || "信息摘要"

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
        <div className="min-w-0 text-sm font-medium text-foreground">{panelTitle}</div>
      </button>
      {isOpen && (
        <div>
          {content?.trim() && (
            <div className="border-b border-border/60 px-4 py-2 text-sm leading-6 text-muted-foreground">
              {content}
            </div>
          )}
          <div className="px-3 py-2">
            {items.map((item, index) => {
              const { label, value } = splitInformationalTitle(item.title)

              return (
                <div
                  key={`${item.id ?? item.title}-${index}`}
                  className="flex items-start gap-3 rounded-md px-1.5 py-2 hover:bg-muted/20"
                >
                  <span className="mt-2 size-2 shrink-0 rounded-full bg-muted-foreground/45" />
                  <div className="min-w-0 flex-1 space-y-1">
                    {value ? (
                      <div className="text-[14px] leading-6 text-foreground">
                        <span className="font-medium">{label}:</span>{" "}
                        <span>{value}</span>
                      </div>
                    ) : (
                      <div className="break-words text-[14px] leading-6 text-foreground">
                        {label}
                      </div>
                    )}
                    {item.detail && (
                      <div className="text-xs leading-5 text-muted-foreground">
                        {item.detail}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function TodoListPanel({
  title,
  content,
  items,
}: {
  title?: string
  content?: string
  items: ChatTodoItem[]
}) {
  const [isOpen, setIsOpen] = useState(true)

  if (items.length === 0) {
    return null
  }
  if (isInformationalTodo(title, content, items)) {
    return <InformationalListPanel title={title} content={content} items={items} />
  }
  const completedCount = items.filter((item) => item.status === "completed").length
  const panelTitle = title?.trim() || "待办事项"

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
        <div>
          {content?.trim() && (
            <div className="border-b border-border/60 px-4 py-2 text-sm leading-6 text-muted-foreground">
              {content}
            </div>
          )}
          <div className="px-3 py-2">
            {items.map((item, index) => (
              <div
                key={`${item.id ?? item.title}-${index}`}
                className="flex items-start gap-3 rounded-md px-1.5 py-2 hover:bg-muted/20"
              >
                <TodoStatusIcon status={item.status} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div
                    className={cn(
                      "break-words text-[14px] leading-5 text-foreground",
                      item.status === "completed" && "text-muted-foreground line-through",
                    )}
                  >
                    {item.title}
                  </div>
                  {item.detail && (
                    <div className="text-xs leading-5 text-muted-foreground">
                      {item.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function extractPlanPreviewItems(content: string): ChatTodoItem[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const items: ChatTodoItem[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const headingMatch = line.match(/^#{2,6}\s+(.+)$/)
    if (headingMatch) {
      const title = headingMatch[1]?.replace(/[*_`#]/g, "").trim() ?? ""
      if (/阶段|phase|milestone|任务/i.test(title) && !/项目目标|核心特性|任务分解/i.test(title)) {
        items.push({ title, status: "not-started" })
      }
      continue
    }

    const bulletMatch = line.match(/^[-*+]\s*(?:\[(?: |x|X)\]\s*)?(.+)$/)
    if (bulletMatch && items.length < 8) {
      const title = bulletMatch[1]?.replace(/[*_`]/g, "").trim() ?? ""
      if (title && !/^T\d/.test(title)) {
        items.push({ title, status: /done|completed|已完成/i.test(title) ? "completed" : "not-started" })
      }
    }
  }

  const deduped: ChatTodoItem[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.title && !seen.has(item.title)) {
      seen.add(item.title)
      deduped.push(item)
    }
  }
  if (deduped.length > 0 && !deduped.some((item) => item.status === "in-progress" || item.status === "completed")) {
    deduped[0] = { ...deduped[0], status: "in-progress" }
  }
  return deduped.slice(0, 6)
}

export function InlinePlanPreview({ content }: { content: string }) {
  const items = extractPlanPreviewItems(content)
  if (items.length < 2) {
    return null
  }

  return <TodoListPanel title="Plan" items={items} />
}
