// Structured message content renderers.
//
// Architecture principle:
//   - LLM writes flat types  (type:"form", type:"alert", …) — simple, easy to prompt.
//   - Backend normalizes flat → card+kind before sending on the wire.
//   - Renderer only handles card+kind. The legacy flat entries below are a safety net
//     for old messages stored in history before the normalization was introduced.
//
// To add a new kind: add one entry to PART_RENDERERS below.
import { type ReactNode, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type {
  ChatActionItem,
  ChatCardBlock,
  ChatStructuredAlert,
  ChatStructuredCard,
  ChatStructuredContent,
  ChatStructuredForm,
  ChatStructuredOptions,
  ChatStructuredProgress,
  ChatStructuredTodo,
  ChatTodoStatus,
  ChatUnknownBlock,
} from "@/store/chat"

import { TodoListPanel } from "./todo-panel"
import { ToolProgressPanel } from "./tool-progress-panel"

const STRUCTURED_PANEL_CLASS =
  "space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4 shadow-sm"

const STRUCTURED_SUBSECTION_CLASS =
  "rounded-lg border border-border/60 bg-background/70 p-3"

export function renderMarkdown(text: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeHighlight]}
    >
      {text}
    </ReactMarkdown>
  )
}

export const MARKDOWN_BODY_CLASS =
  "prose dark:prose-invert prose-pre:my-2 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:bg-zinc-100 prose-pre:p-0 dark:prose-pre:bg-zinc-950 max-w-none [overflow-wrap:anywhere] break-words"

function renderStructuredText(text?: string) {
  if (!text?.trim()) {
    return null
  }

  return (
    <div className="prose dark:prose-invert max-w-none text-sm [overflow-wrap:anywhere] break-words">
      {renderMarkdown(text)}
    </div>
  )
}

function StructuredMetaPill({
  children,
  tone = "default",
}: {
  children: ReactNode
  tone?: "default" | "muted" | "accent"
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "accent"
          ? "border-foreground/10 bg-foreground/5"
          : tone === "muted"
            ? "text-muted-foreground border-border/70"
            : "border-border/70",
      )}
    >
      {children}
    </span>
  )
}

function StructuredHeader({
  title,
  kind,
  badge,
  eyebrow,
}: {
  title?: string
  kind?: string
  badge?: string
  eyebrow?: string
}) {
  if (!title && !kind && !badge && !eyebrow) {
    return null
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {eyebrow && (
          <StructuredMetaPill tone="accent">{eyebrow}</StructuredMetaPill>
        )}
        {badge && <StructuredMetaPill>{badge}</StructuredMetaPill>}
        {kind && <StructuredMetaPill tone="muted">{kind}</StructuredMetaPill>}
      </div>
      {title && <div className="text-sm font-semibold tracking-tight">{title}</div>}
    </div>
  )
}

function actionVariant(action: ChatActionItem) {
  return action.variant ?? (action.url ? "outline" : "secondary")
}

function renderStructuredRawFallback(
  raw: Record<string, unknown> | undefined,
  summary: string,
) {
  if (!raw) {
    return null
  }

  return (
    <details className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-3 shadow-sm">
      <summary className="cursor-pointer text-sm font-medium">{summary}</summary>
      <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(raw, null, 2)}</pre>
    </details>
  )
}

function StructuredActions({
  actions,
  onSelectOption,
}: {
  actions: ChatActionItem[]
  onSelectOption?: (value: string) => void
}) {
  if (actions.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => {
        const key = `${action.label}-${action.value ?? action.url ?? action.action ?? "action"}`
        const commonClassName =
          "h-auto max-w-full items-start justify-start whitespace-normal text-left"

        if (action.url) {
          return (
            <Button
              key={key}
              asChild
              type="button"
              variant={actionVariant(action)}
              size="sm"
              className={commonClassName}
            >
              <a href={action.url} target="_blank" rel="noreferrer">
                {action.label}
              </a>
            </Button>
          )
        }

        return (
          <Button
            key={key}
            type="button"
            variant={actionVariant(action)}
            size="sm"
            className={commonClassName}
            onClick={() => onSelectOption?.(action.value ?? action.label)}
          >
            {action.label}
          </Button>
        )
      })}
    </div>
  )
}

function StructuredCardBlockView({
  block,
  onSelectOption,
}: {
  block: ChatCardBlock
  onSelectOption?: (value: string) => void
}) {
  switch (block.type) {
    case "text": {
      const textBlock = block
      return <p className="text-sm leading-6 whitespace-pre-wrap">{textBlock.text}</p>
    }
    case "markdown": {
      const markdownBlock = block
      return <div className="prose dark:prose-invert max-w-none text-sm">{renderMarkdown(markdownBlock.text)}</div>
    }
    case "fields": {
      const fieldsBlock = block
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {fieldsBlock.fields.map((field) => (
            <div key={`${field.label}-${field.value}`} className={STRUCTURED_SUBSECTION_CLASS}>
              <div className="text-muted-foreground text-xs">{field.label}</div>
              <div className="mt-1 text-sm font-medium break-words">{field.value}</div>
            </div>
          ))}
        </div>
      )
    }
    case "badge": {
      const badgeBlock = block
      return (
        <span className="inline-flex rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs font-medium">
          {badgeBlock.label}
        </span>
      )
    }
    case "actions": {
      const actionsBlock = block
      return <StructuredActions actions={actionsBlock.actions} onSelectOption={onSelectOption} />
    }
    case "list": {
      const listBlock = block
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {listBlock.items.map((item, index) => (
            <li key={`${item.label ?? item.text}-${index}`}>
              {item.label ? `${item.label}: ${item.text}` : item.text}
            </li>
          ))}
        </ul>
      )
    }
    case "table": {
      const tableBlock = block
      return (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/70">
          <table className="w-full min-w-80 text-sm">
            {tableBlock.headers && tableBlock.headers.length > 0 && (
              <thead className="bg-muted/60">
                <tr>
                  {tableBlock.headers.map((header, index) => (
                    <th key={`${header}-${index}`} className="px-3 py-2 text-left font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {tableBlock.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="border-t border-border/60">
                  {row.map((cell, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top break-words">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case "image": {
      const imageBlock = block
      return (
        <img
          src={imageBlock.url}
          alt={imageBlock.alt ?? "structured image"}
          className="max-h-80 rounded-xl border border-border/60 bg-background/70 object-contain"
        />
      )
    }
    case "divider":
      return <div className="border-t border-border/60" />
    case "json": {
      const jsonBlock = block
      return (
        <details className="rounded-xl border border-border/60 bg-background/60 p-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium">JSON</summary>
          <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(jsonBlock.data, null, 2)}</pre>
        </details>
      )
    }
    default: {
      const unknownBlock = block as ChatUnknownBlock
      return (
        <details className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium">Unsupported block: {unknownBlock.blockType}</summary>
          <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(unknownBlock.raw, null, 2)}</pre>
        </details>
      )
    }
  }
}

// ── Card → typed content converters ─────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function cardToFormContent(card: ChatStructuredCard): ChatStructuredForm | undefined {
  const fields = Array.isArray(card.raw?.fields)
    ? card.raw.fields
        .map((item) => {
          const entry = asRecord(item)
          const name = asString(entry?.name)
          const label = asString(entry?.label)
          if (!entry || !name || !label) {
            return null
          }
          const rawOptions = Array.isArray(entry.options) ? entry.options : undefined
          return {
            name,
            label,
            fieldType: asString(entry.type) ?? asString(entry.fieldType),
            value: asString(entry.value),
            required: asBoolean(entry.required),
            placeholder: asString(entry.placeholder),
            options: rawOptions?.map((o) => (typeof o === "string" ? o : String(o))),
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : undefined

  return {
    type: "form",
    kind: card.kind,
    version: card.version,
    title: card.title,
    content: asString(card.raw?.content) ?? asString(card.raw?.description),
    fields,
    actions: card.actions,
    raw: card.raw,
  }
}

function cardToProgressContent(card: ChatStructuredCard): ChatStructuredProgress | undefined {
  const steps = Array.isArray(card.raw?.steps)
    ? card.raw.steps
        .map((item) => {
          const entry = asRecord(item)
          const label = asString(entry?.label)
          if (!entry || !label) {
            return null
          }
          return {
            label,
            status: asString(entry.status),
            detail:
              asString(entry.detail) ??
              asString(entry.description) ??
              asString(entry.message),
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : undefined

  return {
    type: "progress",
    kind: card.kind,
    version: card.version,
    title: card.title,
    content:
      asString(card.raw?.content) ??
      asString(card.raw?.description) ??
      asString(card.raw?.message),
    status: asString(card.raw?.status),
    steps,
    raw: card.raw,
  }
}

function cardToAlertContent(card: ChatStructuredCard): ChatStructuredAlert | undefined {
  return {
    type: "alert",
    kind: card.kind,
    version: card.version,
    title: card.title,
    level:
      asString(card.raw?.level) ??
      asString(card.raw?.severity) ??
      asString(card.raw?.statusLevel),
    content:
      asString(card.raw?.content) ??
      asString(card.raw?.description) ??
      asString(card.raw?.message),
    actions: card.actions,
    raw: card.raw,
  }
}

function cardToTodoContent(card: ChatStructuredCard): ChatStructuredTodo | undefined {
  const items = Array.isArray(card.raw?.items)
    ? card.raw.items
        .map((item) => {
          const entry = asRecord(item)
          const title = asString(entry?.title)
          if (!entry || !title) {
            return null
          }
          return {
            id: asString(entry.id),
            title,
            status: (
              entry.status === "not-started" ||
              entry.status === "in-progress" ||
              entry.status === "completed"
                ? entry.status
                : undefined) as ChatTodoStatus | undefined,
            detail:
              asString(entry.detail) ??
              asString(entry.description) ??
              asString(entry.message),
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : undefined

  return {
    type: "todo",
    kind: card.kind,
    version: card.version,
    title: card.title,
    content:
      asString(card.raw?.content) ??
      asString(card.raw?.description) ??
      asString(card.raw?.message),
    items,
    raw: card.raw,
  }
}

// ── Renderer components ──────────────────────────────────────────────────────

function OptionsStructuredContent({
  structured,
  onSelectOption,
}: {
  structured: ChatStructuredOptions
  onSelectOption?: (value: string) => void
}) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [customValue, setCustomValue] = useState("")
  const mode = structured.mode ?? "single"
  const submitLabel = structured.submitLabel ?? "Send"
  const customPlaceholder = structured.customPlaceholder ?? "Enter a custom value"
  const canSubmitMultiple = selectedOptions.length > 0 || customValue.trim().length > 0
  const selectedLabels = structured.options
    .filter((option) => selectedOptions.includes(option.value))
    .map((option) => option.label)

  const toggleOption = (value: string) => {
    if (mode === "single") {
      onSelectOption?.(value)
      return
    }

    setSelectedOptions((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    )
  }

  const submitSelection = () => {
    const values = [...selectedOptions]
    if (customValue.trim()) {
      values.push(customValue.trim())
    }
    if (values.length === 0) {
      return
    }
    onSelectOption?.(mode === "multiple" ? values.join("\n") : values[0])
    setSelectedOptions([])
    setCustomValue("")
  }

  return (
    <div className={STRUCTURED_PANEL_CLASS}>
      <StructuredHeader
        eyebrow="Options"
        badge={mode === "multiple" ? "Multiple" : "Single"}
      />
      {mode === "multiple" && (
        <div className="text-muted-foreground text-xs">
          Select one or more options, then press {submitLabel}.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {structured.options.map((option) => {
          const isSelected = selectedOptions.includes(option.value)
          return (
            <Button
              key={`${option.label}-${option.value}`}
              type="button"
              variant={mode === "multiple" && isSelected ? "secondary" : "outline"}
              size="sm"
              className="h-auto max-w-full items-start justify-start whitespace-normal text-left"
              onClick={() => toggleOption(option.value)}
            >
              <span className="flex w-full flex-col items-start gap-0.5">
                <span>{option.label}</span>
                {option.description && (
                  <span className="text-muted-foreground text-xs font-normal">
                    {option.description}
                  </span>
                )}
                {mode === "multiple" && isSelected && (
                  <span className="text-xs font-medium">Selected</span>
                )}
              </span>
            </Button>
          )
        })}
      </div>
      {mode === "multiple" && selectedOptions.length > 0 && (
        <div className="text-muted-foreground rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-xs">
          Selected: {selectedLabels.join(", ")}
        </div>
      )}
      {structured.allowCustom && (
        <div className="flex gap-2">
          <Input
            value={customValue}
            placeholder={customPlaceholder}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return
              }
              event.preventDefault()
              submitSelection()
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={submitSelection}
            disabled={!customValue.trim() && mode !== "multiple"}
          >
            {submitLabel}
          </Button>
        </div>
      )}
      {mode === "multiple" && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-auto whitespace-normal"
          onClick={submitSelection}
          disabled={!canSubmitMultiple}
        >
          {submitLabel}
        </Button>
      )}
      {structured.options.length === 0 &&
        renderStructuredRawFallback(structured.raw, "Unsupported options payload")}
    </div>
  )
}

function GenericCardStructuredContent({
  structured,
  onSelectOption,
}: {
  structured: ChatStructuredCard
  onSelectOption?: (value: string) => void
}) {
  const hasRenderableContent =
    Boolean(structured.blocks?.length) || Boolean(structured.actions?.length)

  return (
    <div className={STRUCTURED_PANEL_CLASS}>
      <StructuredHeader title={structured.title} kind={structured.kind} eyebrow="Card" />
      {structured.blocks?.map((block, index) => (
        <StructuredCardBlockView key={`${block.type}-${index}`} block={block} onSelectOption={onSelectOption} />
      ))}
      {structured.actions && structured.actions.length > 0 && (
        <StructuredActions actions={structured.actions} onSelectOption={onSelectOption} />
      )}
      {!hasRenderableContent &&
        renderStructuredRawFallback(
          structured.raw,
          structured.kind ? `Custom card payload: ${structured.kind}` : "Unsupported card payload",
        )}
    </div>
  )
}

function FormStructuredContent({
  structured,
  onSelectOption,
}: {
  structured: ChatStructuredForm
  onSelectOption?: (value: string) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    structured.fields?.forEach((f) => { if (f.value) init[f.name] = f.value })
    return init
  })

  const hasRenderableContent =
    Boolean(structured.content?.trim()) ||
    Boolean(structured.fields?.length)

  const handleSubmit = () => {
    const parts = (structured.fields ?? []).map((f) => `${f.name}: ${values[f.name] ?? ""}`.trim())
    onSelectOption?.(parts.filter(Boolean).join("\n"))
  }

  const isSubmittable = (structured.fields ?? []).every(
    (f) => !f.required || (values[f.name] ?? "").trim().length > 0
  )

  return (
    <div className={STRUCTURED_PANEL_CLASS}>
      <StructuredHeader title={structured.title} kind={structured.kind} eyebrow="Form" />
      {renderStructuredText(structured.content)}
      {structured.fields?.map((field) => (
        <div key={field.name} className={STRUCTURED_SUBSECTION_CLASS}>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-sm font-medium" htmlFor={`form-field-${field.name}`}>{field.label}</label>
            {field.required && <span className="text-destructive text-xs">*</span>}
          </div>
          {field.fieldType === "select" && field.options && field.options.length > 0 ? (
            <Select
              value={values[field.name] ?? ""}
              onValueChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
            >
              <SelectTrigger id={`form-field-${field.name}`} className="w-full">
                <SelectValue placeholder={field.placeholder ?? `Select ${field.label}`} />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`form-field-${field.name}`}
              type={field.fieldType === "number" ? "number" : "text"}
              placeholder={field.placeholder ?? field.label}
              value={values[field.name] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
            />
          )}
        </div>
      ))}
      {Boolean(structured.fields?.length) && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-1"
          disabled={!isSubmittable}
          onClick={handleSubmit}
        >
          Submit
        </Button>
      )}
      {!hasRenderableContent &&
        renderStructuredRawFallback(
          structured.raw,
          structured.kind ? `Custom form payload: ${structured.kind}` : "Unsupported form payload",
        )}
    </div>
  )
}

function ProgressStructuredContent({ structured }: { structured: ChatStructuredProgress }) {
  const isToolProcess = structured.kind === "agent/tool-exec"
  const hasRenderableContent =
    Boolean(structured.content?.trim()) ||
    Boolean(structured.steps?.length) ||
    Boolean(structured.status?.trim())

  if (isToolProcess) {
    return <ToolProgressPanel items={[structured]} />
  }

  return (
    <div className="space-y-3 rounded-xl border border-sky-200/70 bg-sky-50/50 p-4 shadow-sm dark:border-sky-500/20 dark:bg-sky-500/5">
      <StructuredHeader
        title={structured.title}
        kind={structured.kind}
        badge={structured.status}
        eyebrow="Progress"
      />
      {renderStructuredText(structured.content)}
      <div className="space-y-2">
        {structured.steps?.map((step, index) => (
          <div key={`${step.label}-${index}`} className={STRUCTURED_SUBSECTION_CLASS}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium">{step.label}</div>
              {step.status && (
                <StructuredMetaPill tone="muted">{step.status}</StructuredMetaPill>
              )}
            </div>
            {step.detail && (
              <div className="text-muted-foreground mt-1 text-sm">{step.detail}</div>
            )}
          </div>
        ))}
      </div>
      {!hasRenderableContent &&
        renderStructuredRawFallback(
          structured.raw,
          structured.kind
            ? `Custom progress payload: ${structured.kind}`
            : "Unsupported progress payload",
        )}
    </div>
  )
}

function AlertStructuredContent({
  structured,
  onSelectOption,
}: {
  structured: ChatStructuredAlert
  onSelectOption?: (value: string) => void
}) {
  const levelClassName =
    structured.level === "error"
      ? "border-red-300/80 bg-red-50/70 text-red-900 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-100"
      : structured.level === "warning"
        ? "border-amber-300/80 bg-amber-50/70 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
        : "border-blue-300/80 bg-blue-50/70 text-blue-900 dark:border-blue-500/35 dark:bg-blue-500/10 dark:text-blue-100"
  const hasRenderableContent =
    Boolean(structured.title?.trim()) ||
    Boolean(structured.level?.trim()) ||
    Boolean(structured.content?.trim()) ||
    Boolean(structured.actions?.length)

  return (
    <div className={cn("space-y-3 rounded-xl border p-4 shadow-sm", levelClassName)}>
      <StructuredHeader
        title={structured.title}
        kind={structured.kind}
        badge={structured.level?.toUpperCase()}
        eyebrow="Alert"
      />
      {renderStructuredText(structured.content)}
      {structured.actions && structured.actions.length > 0 && (
        <StructuredActions actions={structured.actions} onSelectOption={onSelectOption} />
      )}
      {!hasRenderableContent &&
        renderStructuredRawFallback(
          structured.raw,
          structured.kind ? `Custom alert payload: ${structured.kind}` : "Unsupported alert payload",
        )}
    </div>
  )
}

function TodoStructuredContent({ structured }: { structured: ChatStructuredTodo }) {
  const hasRenderableContent =
    Boolean(structured.title?.trim()) ||
    Boolean(structured.content?.trim()) ||
    Boolean(structured.items?.length)

  return (
    <div className="space-y-3">
      {structured.items && structured.items.length > 0 && (
        <TodoListPanel
          title={structured.title}
          content={structured.content}
          items={structured.items}
        />
      )}
      {!hasRenderableContent &&
        renderStructuredRawFallback(
          structured.raw,
          structured.kind ? `Custom todo payload: ${structured.kind}` : "Unsupported todo payload",
        )}
    </div>
  )
}

function UnknownStructuredContent({ structured }: { structured: ChatStructuredContent }) {
  const kind = "kind" in structured ? structured.kind : undefined
  return (
    <details className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-3 shadow-sm">
      <summary className="cursor-pointer text-sm font-medium">
        Unsupported card{kind ? `: ${kind}` : ""}
      </summary>
      <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(structured.raw, null, 2)}</pre>
    </details>
  )
}

// ── card:kind adapter components ─────────────────────────────────────────────

function CardKindFormStructuredContent({
  structured,
  onSelectOption,
}: {
  structured: ChatStructuredCard
  onSelectOption?: (value: string) => void
}) {
  const content = cardToFormContent(structured)
  return content ? (
    <FormStructuredContent structured={content} onSelectOption={onSelectOption} />
  ) : (
    <GenericCardStructuredContent structured={structured} onSelectOption={onSelectOption} />
  )
}

function CardKindProgressStructuredContent({ structured }: { structured: ChatStructuredCard }) {
  const content = cardToProgressContent(structured)
  return content ? <ProgressStructuredContent structured={content} /> : <GenericCardStructuredContent structured={structured} />
}

function CardKindAlertStructuredContent({
  structured,
  onSelectOption,
}: {
  structured: ChatStructuredCard
  onSelectOption?: (value: string) => void
}) {
  const content = cardToAlertContent(structured)
  return content ? (
    <AlertStructuredContent structured={content} onSelectOption={onSelectOption} />
  ) : (
    <GenericCardStructuredContent structured={structured} onSelectOption={onSelectOption} />
  )
}

function CardKindTodoStructuredContent({ structured }: { structured: ChatStructuredCard }) {
  const content = cardToTodoContent(structured)
  return content ? <TodoStructuredContent structured={content} /> : <GenericCardStructuredContent structured={structured} />
}

// ── Dispatch table ────────────────────────────────────────────────────────────

function getStructuredPartKind(structured: ChatStructuredContent): string {
  if (structured.type === "card" && structured.kind) {
    return `card:${structured.kind}`
  }
  // Legacy: flat types from history messages pre-normalization.
  return structured.type
}

type StructuredPartRenderer = React.ComponentType<{
  structured: ChatStructuredContent
  onSelectOption?: (value: string) => void
}>

// Single registry keyed by part kind.
// Canonical protocol types sit at the top; card kinds follow.
// Legacy flat types (form/progress/todo/alert) are kept as a safety net for
// clients that haven't been updated — they route to the same renderer components.
const PART_RENDERERS: Record<string, StructuredPartRenderer> = {
  // Canonical types
  options: OptionsStructuredContent as StructuredPartRenderer,
  card: GenericCardStructuredContent as StructuredPartRenderer,
  // Canonical card kinds — backend normalizes aliases here
  "card:form": CardKindFormStructuredContent as StructuredPartRenderer,
  "card:builtin/form": CardKindFormStructuredContent as StructuredPartRenderer,
  "card:progress": CardKindProgressStructuredContent as StructuredPartRenderer,
  "card:builtin/progress": CardKindProgressStructuredContent as StructuredPartRenderer,
  "card:alert": CardKindAlertStructuredContent as StructuredPartRenderer,
  "card:builtin/alert": CardKindAlertStructuredContent as StructuredPartRenderer,
  "card:todo": CardKindTodoStructuredContent as StructuredPartRenderer,
  "card:builtin/todo": CardKindTodoStructuredContent as StructuredPartRenderer,
  // Legacy flat alias types
  form: FormStructuredContent as StructuredPartRenderer,
  progress: ProgressStructuredContent as StructuredPartRenderer,
  alert: AlertStructuredContent as StructuredPartRenderer,
  todo: TodoStructuredContent as StructuredPartRenderer,
}

export function StructuredContentView({
  structured,
  onSelectOption,
}: {
  structured: ChatStructuredContent
  onSelectOption?: (value: string) => void
}) {
  const partKind = getStructuredPartKind(structured)
  const Renderer = PART_RENDERERS[partKind] ?? UnknownStructuredContent
  return <Renderer structured={structured as never} onSelectOption={onSelectOption} />
}
