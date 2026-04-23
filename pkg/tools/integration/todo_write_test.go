package integrationtools

import (
	"context"
	"testing"
)

func TestTodoStateRegistry_UpdateAndGet(t *testing.T) {
	reg := NewTodoStateRegistry()
	reg.Update("sess1", []TodoItem{
		{Title: "A", Status: "in-progress"},
		{Title: "B", Status: "not-started"},
	})
	items := reg.Get("sess1")
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d", len(items))
	}
	if items[0].Title != "A" || items[0].Status != "in-progress" {
		t.Errorf("unexpected item[0]: %+v", items[0])
	}
}

func TestTodoStateRegistry_HasActiveTodos(t *testing.T) {
	reg := NewTodoStateRegistry()

	if reg.HasActiveTodos("empty") {
		t.Fatal("empty session should have no active todos")
	}

	reg.Update("sess2", []TodoItem{{Title: "X", Status: "completed"}})
	if reg.HasActiveTodos("sess2") {
		t.Fatal("all-completed session should have no active todos")
	}

	reg.Update("sess2", []TodoItem{{Title: "X", Status: "in-progress"}})
	if !reg.HasActiveTodos("sess2") {
		t.Fatal("session with in-progress item should have active todos")
	}

	reg.Update("sess2", []TodoItem{{Title: "X", Status: "not-started"}})
	if !reg.HasActiveTodos("sess2") {
		t.Fatal("session with not-started item should have active todos")
	}
}

func TestTodoStateRegistry_CountCompleted(t *testing.T) {
	reg := NewTodoStateRegistry()
	reg.Update("sess3", []TodoItem{
		{Title: "A", Status: "completed"},
		{Title: "B", Status: "in-progress"},
		{Title: "C", Status: "not-started"},
	})
	done, total := reg.CountCompleted("sess3")
	if done != 1 || total != 3 {
		t.Fatalf("want (1,3), got (%d,%d)", done, total)
	}
}

func TestTodoStateRegistry_Reset(t *testing.T) {
	reg := NewTodoStateRegistry()
	reg.Update("sess4", []TodoItem{{Title: "A", Status: "in-progress"}})
	reg.Reset("sess4")
	if reg.HasActiveTodos("sess4") {
		t.Fatal("reset session should have no active todos")
	}
}

func TestTodoWriteTool_Name(t *testing.T) {
	tool := NewTodoWriteTool()
	if tool.Name() != "todo_write" {
		t.Fatalf("want 'todo_write', got %q", tool.Name())
	}
}

func TestTodoWriteTool_ExecuteBasic(t *testing.T) {
	tool := NewTodoWriteTool()

	sent := []any{}
	tool.SetStructuredSendCallback(func(_ context.Context, _, _, _, _ string, structured any) error {
		sent = append(sent, structured)
		return nil
	})

	ctx := WithToolInboundContext(context.Background(), "pico", "user1", "", "")
	ctx = WithToolSessionContext(ctx, "agent1", "sess-exec", nil)

	result := tool.Execute(ctx, map[string]any{
		"title": "My Plan",
		"items": []any{
			map[string]any{"title": "Step 1", "status": "in-progress"},
			map[string]any{"title": "Step 2", "status": "not-started"},
		},
	})

	if result.IsError {
		t.Fatalf("unexpected error: %s", result.ForLLM)
	}
	if len(sent) != 1 {
		t.Fatalf("want 1 structured send, got %d", len(sent))
	}
	payload, ok := sent[0].(map[string]any)
	if !ok {
		t.Fatalf("structured payload is not map: %T", sent[0])
	}
	if payload["type"] != "card" || payload["kind"] != "todo" {
		t.Errorf("want type=card kind=todo, got type=%v kind=%v", payload["type"], payload["kind"])
	}
	if payload["title"] != "My Plan" {
		t.Errorf("want title='My Plan', got %v", payload["title"])
	}
}

func TestTodoWriteTool_PersistsToRegistry(t *testing.T) {
	reg := NewTodoStateRegistry()
	tool := &TodoWriteTool{messageDispatchTool: newMessageDispatchTool()}
	// Override global registry for this test.
	origReg := GlobalTodoRegistry
	GlobalTodoRegistry = reg
	defer func() { GlobalTodoRegistry = origReg }()

	tool.SetStructuredSendCallback(func(_ context.Context, _, _, _, _ string, _ any) error { return nil })

	ctx := WithToolInboundContext(context.Background(), "pico", "u", "", "")
	ctx = WithToolSessionContext(ctx, "agent", "sess-persist", nil)

	tool.Execute(ctx, map[string]any{
		"items": []any{
			map[string]any{"title": "T1", "status": "in-progress"},
			map[string]any{"title": "T2", "status": "not-started"},
		},
	})

	if !reg.HasActiveTodos("sess-persist") {
		t.Fatal("registry should have active todos after Execute")
	}
	items := reg.Get("sess-persist")
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d", len(items))
	}
}

func TestTodoWriteTool_RejectsMultipleInProgress(t *testing.T) {
	tool := NewTodoWriteTool()
	tool.SetStructuredSendCallback(func(_ context.Context, _, _, _, _ string, _ any) error { return nil })

	ctx := WithToolInboundContext(context.Background(), "pico", "u", "", "")
	ctx = WithToolSessionContext(ctx, "agent", "sess-multi", nil)

	result := tool.Execute(ctx, map[string]any{
		"items": []any{
			map[string]any{"title": "A", "status": "in-progress"},
			map[string]any{"title": "B", "status": "in-progress"},
		},
	})
	if !result.IsError {
		t.Fatal("expected error for multiple in-progress items")
	}
}

func TestTodoWriteTool_HasActiveTodos(t *testing.T) {
	reg := NewTodoStateRegistry()
	tool := &TodoWriteTool{messageDispatchTool: newMessageDispatchTool()}
	origReg := GlobalTodoRegistry
	GlobalTodoRegistry = reg
	defer func() { GlobalTodoRegistry = origReg }()

	if tool.HasActiveTodos("sess-hat") {
		t.Fatal("should report no active todos for empty session")
	}

	reg.Update("sess-hat", []TodoItem{{Title: "X", Status: "in-progress"}})
	if !tool.HasActiveTodos("sess-hat") {
		t.Fatal("should report active todos after update")
	}
}

func TestRenderTodoFallback(t *testing.T) {
	items := []TodoItem{
		{Title: "Phase 1", Status: "completed"},
		{Title: "Phase 2", Status: "in-progress"},
		{Title: "Phase 3", Status: "not-started"},
	}
	got := renderTodoFallback("My Plan", items)
	if got == "" {
		t.Fatal("expected non-empty fallback text")
	}
	for _, want := range []string{"[x]", "[>]", "[ ]", "(1/3 completed)"} {
		if !containsStr(got, want) {
			t.Errorf("fallback missing %q:\n%s", want, got)
		}
	}
}

func containsStr(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && containsSubstring(s, sub))
}

func containsSubstring(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
