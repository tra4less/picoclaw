package integrationtools

import (
	"context"
	"fmt"
)

type MessageTool struct {
	messageDispatchTool
}

func NewMessageTool() *MessageTool {
	return &MessageTool{
		messageDispatchTool: newMessageDispatchTool(),
	}
}

func (t *MessageTool) Name() string {
	return "message"
}

func (t *MessageTool) Description() string {
	return "Send a message to the user. Supports plain text and rich UI elements: options (single/multi select), forms (collect input), alerts. For task lists use todo_write. Always include 'content' as a text fallback."
}

func (t *MessageTool) Parameters() map[string]any {
	// Simplified schema: use description + examples instead of complex nested oneOf.
	// The backend validation (message_structured.go) handles the detailed schema,
	// keeping the LLM-facing interface simple and example-driven.
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"content": map[string]any{
				"type":        "string",
				"description": "Plain text message. Always required as fallback for non-structured clients.",
			},
			"channel": map[string]any{
				"type":        "string",
				"description": "Optional: target channel (telegram, whatsapp, etc.)",
			},
			"chat_id": map[string]any{
				"type":        "string",
				"description": "Optional: target chat/user ID",
			},
			"reply_to_message_id": map[string]any{
				"type":        "string",
				"description": "Optional: reply target message ID for channels that support threaded replies",
			},
			"structured": map[string]any{
				"type": "object",
				"description": `Optional rich UI payload. Can be a single object or array of objects. Each object must have a 'type' field.

Supported types:

1. OPTIONS - Let the user pick from a fixed list. Use when no free-text input is needed.
   Single select: {type:"options", options:[{label:"Yes",value:"yes"},{label:"No",value:"no"}], mode:"single"}
   Multi select:  {type:"options", options:[{label:"A",value:"a"},{label:"B",value:"b"}], mode:"multiple"}

2. FORM - Collect free-text or structured input from the user. Use when you need typed values (name, email, number, etc.) rather than a simple pick from a list.
   {type:"form", title:"Settings", fields:[{name:"email",label:"Email",type:"text",required:true},{name:"role",label:"Role",type:"select",options:["admin","user"],required:true}]}
   Note: a Submit button is rendered automatically; do NOT include an 'actions' field.

3. ALERT - Highlight important information:
   {type:"alert", level:"warning", content:"This action cannot be undone"}

Note: for task lists use the dedicated todo_write tool instead.
All types accept optional 'title' and 'content' fields.`,
			},
		},
		"required": []string{"content"},
	}
}

func (t *MessageTool) Execute(ctx context.Context, args map[string]any) *ToolResult {
	content, ok := args["content"].(string)
	if !ok {
		return &ToolResult{ForLLM: "content is required", IsError: true}
	}

	structured, err := parseMessageStructuredArgs(args)
	if err != nil {
		return &ToolResult{ForLLM: err.Error(), IsError: true}
	}
	return t.executeSend(ctx, args, content, structured)
}

func parseMessageStructuredArgs(args map[string]any) (any, error) {
	if _, exists := args["options"]; exists {
		return nil, fmt.Errorf("message does not accept top-level options; use structured.type='options'")
	}

	if rawStructured, ok := args["structured"]; ok && rawStructured != nil {
		return normalizeStructuredPayload(rawStructured)
	}

	return nil, nil
}

func normalizeStructuredPayload(rawStructured any) (any, error) {
	switch structured := rawStructured.(type) {
	case map[string]any:
		return normalizeStructuredEntry(structured, "structured")
	case []any:
		if len(structured) == 0 {
			return nil, fmt.Errorf("structured must not be empty")
		}
		result := make([]any, 0, len(structured))
		for index, item := range structured {
			entry, ok := item.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("structured[%d] must be an object", index)
			}
			normalized, err := normalizeStructuredEntry(entry, fmt.Sprintf("structured[%d]", index))
			if err != nil {
				return nil, err
			}
			result = append(result, normalized)
		}
		return result, nil
	default:
		return nil, fmt.Errorf("structured must be an object or array")
	}
}

// StructuredPart is implemented by every canonical and alias structured part type.
// Parse validates and ingests raw LLM input; ToMap serializes back to the wire format.
// This mirrors VS Code's ChatResponsePart design: each kind owns its own schema.
