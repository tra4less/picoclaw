package integrationtools

import (
	"context"
	"fmt"
	"strings"
)

// TodoWriteTool is a dedicated tool for writing and updating the structured task list.
// It maintains authoritative server-side state via GlobalTodoRegistry and sends a
// visual todo card to the user via the same structured dispatch as MessageTool.
//
// Design follows learn-claude-code s03 TodoWrite:
//   - Agent calls todo_write at the start of a multi-step task and after each status change.
//   - The Nag Reminder mechanism (in pipeline_execute.go) injects a reminder when the agent
//     hasn't called todo_write for 3 or more consecutive tool-execution iterations.
//   - At most one item may be in-progress at a time.
type TodoWriteTool struct {
	messageDispatchTool
}

// NewTodoWriteTool creates a new TodoWriteTool backed by GlobalTodoRegistry.
func NewTodoWriteTool() *TodoWriteTool {
	return &TodoWriteTool{messageDispatchTool: newMessageDispatchTool()}
}

func (t *TodoWriteTool) Name() string { return "todo_write" }

func (t *TodoWriteTool) Description() string {
	return "Write or update the task list. " +
		"Call at the start of any multi-step work to lay out all planned tasks, " +
		"and again whenever a task status changes (not-started → in-progress → completed). " +
		"Keep exactly one task in-progress at a time. " +
		"Renders a visual task card to the user; include 'content' as a plain-text fallback."
}

func (t *TodoWriteTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title": map[string]any{
				"type":        "string",
				"description": "Optional title for the task list.",
			},
			"items": map[string]any{
				"type":        "array",
				"description": "Complete task list (all tasks, not just changed ones).",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"title": map[string]any{
							"type":        "string",
							"description": "Task description.",
						},
						"status": map[string]any{
							"type":        "string",
							"enum":        []string{"not-started", "in-progress", "completed"},
							"description": "Current status. At most one item may be in-progress.",
						},
						"detail": map[string]any{
							"type":        "string",
							"description": "Optional additional detail or sub-steps for this task.",
						},
					},
					"required": []string{"title", "status"},
				},
			},
			"content": map[string]any{
				"type":        "string",
				"description": "Plain-text fallback for clients that don't support todo card rendering.",
			},
		},
		"required": []string{"items"},
	}
}

func (t *TodoWriteTool) Execute(ctx context.Context, args map[string]any) *ToolResult {
	rawItems, ok := args["items"].([]any)
	if !ok {
		return ErrorResult("todo_write: items must be an array")
	}

	title, _ := args["title"].(string)

	// Normalize and validate items using the shared block normalizer.
	normalized, err := normalizeTodoItems(rawItems, "items")
	if err != nil {
		return ErrorResult(fmt.Sprintf("todo_write: %v", err))
	}

	// Enforce at most one in-progress.
	inProgressCount := 0
	for _, raw := range normalized {
		if item, ok := raw.(map[string]any); ok {
			if item["status"] == "in-progress" {
				inProgressCount++
			}
		}
	}
	if inProgressCount > 1 {
		return ErrorResult("todo_write: at most one item may have status 'in-progress'")
	}

	// Build server-side TodoItem slice and persist.
	items := make([]TodoItem, 0, len(normalized))
	for _, raw := range normalized {
		if item, ok := raw.(map[string]any); ok {
			ti := TodoItem{
				Title:  item["title"].(string),
				Status: item["status"].(string),
			}
			if d, ok := item["detail"].(string); ok {
				ti.Detail = d
			}
			items = append(items, ti)
		}
	}

	sessionKey := ToolSessionKey(ctx)
	if sessionKey != "" {
		GlobalTodoRegistry.Update(sessionKey, items)
	}

	// Build text fallback if not provided by the caller.
	content, _ := args["content"].(string)
	if content == "" {
		content = renderTodoFallback(title, items)
	}

	// Build structured payload in card+kind wire format.
	// Architecture: LLM interface uses flat "todo", wire/render layer uses card+kind.
	structured := map[string]any{
		"type":    "card",
		"kind":    "todo",
		"items":   normalized,
		"content": content,
	}
	if title != "" {
		structured["title"] = title
	}

	return t.executeSend(ctx, args, content, structured)
}

// HasActiveTodos implements tools.TodoStateReader.
// Returns true if the session has any not-started or in-progress items.
func (t *TodoWriteTool) HasActiveTodos(sessionKey string) bool {
	return GlobalTodoRegistry.HasActiveTodos(sessionKey)
}

// renderTodoFallback builds a plain-text task list summary.
func renderTodoFallback(title string, items []TodoItem) string {
	var sb strings.Builder
	if title != "" {
		sb.WriteString(title)
		sb.WriteString("\n")
	}
	done := 0
	for _, item := range items {
		marker := "[ ]"
		switch item.Status {
		case "in-progress":
			marker = "[>]"
		case "completed":
			marker = "[x]"
			done++
		}
		sb.WriteString(marker)
		sb.WriteString(" ")
		sb.WriteString(item.Title)
		if item.Detail != "" {
			sb.WriteString(" — ")
			sb.WriteString(item.Detail)
		}
		sb.WriteString("\n")
	}
	fmt.Fprintf(&sb, "(%d/%d completed)", done, len(items))
	return sb.String()
}
