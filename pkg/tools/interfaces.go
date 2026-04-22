package tools

// TodoStateReader is implemented by tools that maintain a server-side task list.
// The agent pipeline queries this to decide whether to inject a nag reminder.
type TodoStateReader interface {
	// HasActiveTodos returns true if the session has any not-started or in-progress tasks.
	HasActiveTodos(sessionKey string) bool
}

// SentTracker is implemented by tools that track where messages were sent
// to avoid duplicate sends in the same conversation round.
type SentTracker interface {
	// ResetSentInRound resets the send tracking state for the given session.
	// Called by the agent loop at the start of each inbound message round.
	ResetSentInRound(sessionKey string)

	// HasSentTo returns true if the tool sent a message to the specified
	// channel+chatID combination during the current round.
	HasSentTo(sessionKey, channel, chatID string) bool
}
