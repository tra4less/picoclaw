package agent

import (
	"strings"

	"github.com/sipeed/picoclaw/pkg/channels/pico"
)

// Steering prompts for different chat modes.
// These guide the agent's behavior based on the user's selected mode.
const (
	steeringPromptAsk = `Chat mode is ASK. Prioritize answering the user's question directly and clearly. Prefer explanation, diagnosis, and guidance over taking actions. Avoid tool calls unless they are required to answer accurately or the user explicitly asks you to inspect something. Do not make code changes, execute tasks, or act on behalf of the user unless they clearly request that.`

	steeringPromptPlan = `Chat mode is PLAN. Produce a concrete plan, design, or approach before execution. Do not make code changes, do not run tools that change state, and do not carry out the plan. Limit tool use to minimal read-only inspection only when necessary to produce a better plan. Emphasize steps, tradeoffs, assumptions, and risks. When the plan has discrete tasks, prefer calling the message tool with a structured todo payload for better visualization: {type:'todo', title:string, content?:string, items:[{title:string, status:'not-started'|'in-progress'|'completed', detail?:string}]}. Keep at most one item in-progress. Always include plain-text content as fallback. If using plain markdown instead, structure clearly with numbered steps or bullet points.`

	steeringPromptAgent = `Chat mode is AGENT. You may inspect the workspace, call tools, make code changes, and complete the task end-to-end when appropriate. Prefer execution over discussion when the user is asking for work to be done.`
)

// steeringPrompts maps chat mode to its steering instruction.
var steeringPrompts = map[string]string{
	pico.ChatModeAsk:   steeringPromptAsk,
	pico.ChatModePlan:  steeringPromptPlan,
	pico.ChatModeAgent: steeringPromptAgent,
}

// getModeSteeringPrompt extracts the chat mode from raw metadata and returns
// the corresponding steering prompt, or empty string if no mode is set.
func getModeSteeringPrompt(raw map[string]string) string {
	if len(raw) == 0 {
		return ""
	}
	mode := normalizeMode(raw[pico.PayloadKeyMode])
	if mode == "" {
		return ""
	}
	return steeringPrompts[mode]
}

// normalizeMode normalizes mode string (lowercase, trimmed).
func normalizeMode(mode string) string {
	mode = strings.ToLower(strings.TrimSpace(mode))
	// Validate against known modes
	switch mode {
	case pico.ChatModeAsk, pico.ChatModePlan, pico.ChatModeAgent:
		return mode
	default:
		return ""
	}
}
