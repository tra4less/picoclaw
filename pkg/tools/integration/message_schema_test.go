package integrationtools

import (
	"encoding/json"
	"testing"
)

// TestMessageToolSchemaSimplified verifies that the simplified schema is
// more LLM-friendly while maintaining backwards compatibility.
func TestMessageToolSchemaSimplified(t *testing.T) {
	tool := NewMessageTool()
	params := tool.Parameters()

	// Verify the schema is an object
	if params["type"] != "object" {
		t.Fatalf("expected type=object, got %v", params["type"])
	}

	// Verify required fields
	required, ok := params["required"].([]string)
	if !ok || len(required) != 1 || required[0] != "content" {
		t.Fatalf("expected required=[content], got %v", params["required"])
	}

	// Verify structured field has simplified description-based schema
	props, ok := params["properties"].(map[string]any)
	if !ok {
		t.Fatal("properties must be a map")
	}

	structured, ok := props["structured"].(map[string]any)
	if !ok {
		t.Fatal("structured property must exist")
	}

	desc, ok := structured["description"].(string)
	if !ok || desc == "" {
		t.Fatal("structured.description must be a non-empty string")
	}

	// The simplified schema should mention examples in the description.
	// Note: PROGRESS and TODO are intentionally absent from message tool;
	// progress is handled internally, todos use the dedicated todo_write tool.
	if !contains(desc, "OPTIONS") {
		t.Error("description should mention OPTIONS type with example")
	}
	if !contains(desc, "FORM") {
		t.Error("description should mention FORM type with example")
	}
	if !contains(desc, "ALERT") {
		t.Error("description should mention ALERT type with example")
	}

	// Verify the schema is simpler (no nested oneOf)
	if _, hasOneOf := structured["oneOf"]; hasOneOf {
		t.Error("simplified schema should not use complex oneOf patterns at the structured level")
	}

	// Verify schema can be serialized (will be sent to LLM)
	schemaJSON, err := json.MarshalIndent(params, "", "  ")
	if err != nil {
		t.Fatalf("schema must be JSON-serializable: %v", err)
	}

	// The simplified schema should be significantly smaller
	if len(schemaJSON) > 3000 {
		t.Logf("Schema size: %d bytes", len(schemaJSON))
		t.Error("simplified schema should be under 3KB")
	}
}

// TestMessageToolBackwardsCompatible verifies that the backend validation
// still works correctly even though the LLM-facing schema is simplified.
func TestMessageToolBackwardsCompatible(t *testing.T) {
	tests := []struct {
		name      string
		args      map[string]any
		wantError bool
	}{
		{
			name: "plain text message",
			args: map[string]any{
				"content": "Hello, world!",
			},
			wantError: false,
		},
		{
			name: "options structured",
			args: map[string]any{
				"content": "Choose one:",
				"structured": map[string]any{
					"type": "options",
					"options": []any{
						map[string]any{"label": "Yes", "value": "yes"},
						map[string]any{"label": "No", "value": "no"},
					},
				},
			},
			wantError: false,
		},
		{
			name: "todo structured",
			args: map[string]any{
				"content": "Plan:",
				"structured": map[string]any{
					"type":  "todo",
					"title": "Implementation",
					"items": []any{
						map[string]any{"title": "Phase 1", "status": "in-progress"},
						map[string]any{"title": "Phase 2", "status": "not-started"},
					},
				},
			},
			wantError: false,
		},
		{
			name: "alert structured",
			args: map[string]any{
				"content": "Warning",
				"structured": map[string]any{
					"type":    "alert",
					"level":   "warning",
					"content": "This action cannot be undone",
				},
			},
			wantError: false,
		},
		{
			name: "invalid: empty options",
			args: map[string]any{
				"content": "Choose:",
				"structured": map[string]any{
					"type":    "options",
					"options": []any{},
				},
			},
			wantError: true,
		},
		{
			name: "invalid: malformed structured",
			args: map[string]any{
				"content":    "Test",
				"structured": "not an object",
			},
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseMessageStructuredArgs(tt.args)
			if tt.wantError && err == nil {
				t.Error("expected error but got nil")
			}
			if !tt.wantError && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && findSubstring(s, substr))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
