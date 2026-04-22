package agent

import "github.com/sipeed/picoclaw/pkg/tools"

// resetSentTrackingTools calls ResetSentInRound on all tools that implement SentTracker.
func resetSentTrackingTools(agent *AgentInstance, sessionKey string) {
	if agent == nil {
		return
	}
	for _, name := range agent.Tools.List() {
		tool, ok := agent.Tools.Get(name)
		if !ok {
			continue
		}
		if tracker, ok := tool.(tools.SentTracker); ok {
			tracker.ResetSentInRound(sessionKey)
		}
	}
}

// anySentTrackingToolSentTo returns true if any tool implementing SentTracker
// has sent a message to the specified channel+chatID during the current round.
func anySentTrackingToolSentTo(agent *AgentInstance, sessionKey, channel, chatID string) bool {
	if agent == nil {
		return false
	}
	for _, name := range agent.Tools.List() {
		tool, ok := agent.Tools.Get(name)
		if !ok {
			continue
		}
		if tracker, ok := tool.(tools.SentTracker); ok {
			if tracker.HasSentTo(sessionKey, channel, chatID) {
				return true
			}
		}
	}
	return false
}
