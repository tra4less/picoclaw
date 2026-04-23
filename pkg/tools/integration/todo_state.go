package integrationtools

import "sync"

// TodoItem is a single item in a server-side task list.
type TodoItem struct {
	Title  string
	Status string // "not-started" | "in-progress" | "completed"
	Detail string
}

// todoSessionState holds the current todo list for one session.
type todoSessionState struct {
	items []TodoItem
}

// TodoStateRegistry tracks the current todo list per session.
// It is the authoritative server-side state that todo_write writes to
// and that the nag-reminder mechanism queries.
type TodoStateRegistry struct {
	mu       sync.RWMutex
	sessions map[string]*todoSessionState
}

// NewTodoStateRegistry creates an empty registry.
func NewTodoStateRegistry() *TodoStateRegistry {
	return &TodoStateRegistry{sessions: make(map[string]*todoSessionState)}
}

// GlobalTodoRegistry is the process-wide todo state registry used by TodoWriteTool.
var GlobalTodoRegistry = NewTodoStateRegistry()

// Update replaces the todo list for the given session.
func (r *TodoStateRegistry) Update(sessionKey string, items []TodoItem) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := make([]TodoItem, len(items))
	copy(cp, items)
	r.sessions[sessionKey] = &todoSessionState{items: cp}
}

// Get returns a copy of the current todo list for a session.
func (r *TodoStateRegistry) Get(sessionKey string) []TodoItem {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s := r.sessions[sessionKey]
	if s == nil {
		return nil
	}
	cp := make([]TodoItem, len(s.items))
	copy(cp, s.items)
	return cp
}

// HasActiveTodos returns true if the session has any not-started or in-progress items.
func (r *TodoStateRegistry) HasActiveTodos(sessionKey string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s := r.sessions[sessionKey]
	if s == nil {
		return false
	}
	for _, item := range s.items {
		if item.Status == "not-started" || item.Status == "in-progress" {
			return true
		}
	}
	return false
}

// CountCompleted returns (completed, total) counts for a session.
func (r *TodoStateRegistry) CountCompleted(sessionKey string) (int, int) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s := r.sessions[sessionKey]
	if s == nil {
		return 0, 0
	}
	done := 0
	for _, item := range s.items {
		if item.Status == "completed" {
			done++
		}
	}
	return done, len(s.items)
}

// Reset clears the todo list for a session.
func (r *TodoStateRegistry) Reset(sessionKey string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, sessionKey)
}
