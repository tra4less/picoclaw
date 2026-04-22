// PicoClaw - Ultra-lightweight personal AI agent

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/constants"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/providers"
	"github.com/sipeed/picoclaw/pkg/tools"
	"github.com/sipeed/picoclaw/pkg/utils"
)

// parallelSlot holds the pre-computed state and result for one tool call
// in a concurrent execution batch.
type parallelSlot struct {
	toolName   string
	toolCallID string
	toolArgs   map[string]any
	// filled after execution
	toolResult  *tools.ToolResult
	duration    time.Duration
	hardAborted bool
}

// executeToolsBatchParallel executes all tool calls in parallelised goroutines and
// assembles results in the original call order.
//
// It is only called when:
//   - len(normalizedToolCalls) > 1
//   - al.hooks == nil  (no hook middleware is installed)
//   - parallel_tool_execution is enabled (default: true)
//
// Behavioural differences vs the sequential path:
//   - Tool feedback notifications for all tools are sent before any execution begins.
//   - Steering / graceful-interrupt is checked once after all tools finish rather
//     than between each pair.
//   - The hard-abort flag is checked once before launching and once after joining.
func (p *Pipeline) executeToolsBatchParallel(
	ctx context.Context,
	turnCtx context.Context,
	ts *turnState,
	exec *turnExecution,
	iteration int,
) ToolControl {
	al := p.al
	normalizedToolCalls := exec.normalizedToolCalls
	n := len(normalizedToolCalls)

	messages := exec.messages
	handledAttachments := make([]providers.Attachment, 0)
	todoWriteCalledThisBatch := false

	slots := make([]parallelSlot, n)

	// ── Phase 1: pre-launch  (sequential) ────────────────────────────────────
	// Emit start events and send feedback for every tool before any goroutine
	// is launched so the user sees all upcoming tool names immediately.
	for i, tc := range normalizedToolCalls {
		toolName := tc.Name
		toolArgs := tc.Arguments
		if toolArgs == nil {
			toolArgs = map[string]any{}
		}

		argsJSON, _ := json.Marshal(toolArgs)
		argsPreview := utils.Truncate(string(argsJSON), 200)
		logger.InfoCF("agent", fmt.Sprintf("[parallel] Tool call: %s(%s)", toolName, argsPreview),
			map[string]any{
				"agent_id":  ts.agent.ID,
				"tool":      toolName,
				"iteration": iteration,
			})
		al.emitEvent(
			EventKindToolExecStart,
			ts.eventMeta("runTurn", "turn.tool.start"),
			ToolExecStartPayload{
				Tool:      toolName,
				Arguments: cloneEventArguments(toolArgs),
			},
		)

		if al.cfg.Agents.Defaults.IsToolFeedbackEnabled() &&
			ts.channel != "" &&
			!ts.opts.SuppressToolFeedback {
			feedbackPreview := utils.Truncate(
				string(argsJSON),
				al.cfg.Agents.Defaults.GetToolFeedbackMaxArgsLength(),
			)
			feedbackMsg := utils.FormatToolFeedbackMessage(tc.Name, feedbackPreview)
			fbCtx, fbCancel := context.WithTimeout(turnCtx, 3*time.Second)
			_ = al.bus.PublishOutbound(fbCtx, outboundMessageForTurn(ts, feedbackMsg))
			fbCancel()
		}

		if ts.channel == "pico" && ts.chatID != "" {
			al.publishPicoToolProgress(turnCtx, ts.chatID, toolName, "running", "Tool execution started.")
		}

		slots[i] = parallelSlot{
			toolName:   toolName,
			toolCallID: tc.ID,
			toolArgs:   toolArgs,
		}
	}

	// ── Phase 2: concurrent execution ────────────────────────────────────────
	var wg sync.WaitGroup
	for i := range slots {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			slot := &slots[idx]
			asyncToolName := slot.toolName

			asyncCallback := func(_ context.Context, result *tools.ToolResult) {
				if !result.Silent && result.ForUser != "" {
					outCtx, outCancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer outCancel()
					_ = al.bus.PublishOutbound(outCtx, outboundMessageForTurn(ts, result.ForUser))
				}

				content := result.ContentForLLM()
				if content == "" {
					return
				}
				content = al.cfg.FilterSensitiveData(content)

				logger.InfoCF("agent", "Async tool completed, publishing result",
					map[string]any{
						"tool":        asyncToolName,
						"content_len": len(content),
						"channel":     ts.channel,
					})
				al.emitEvent(
					EventKindFollowUpQueued,
					ts.scope.meta(iteration, "runTurn", "turn.follow_up.queued"),
					FollowUpQueuedPayload{
						SourceTool: asyncToolName,
						ContentLen: len(content),
					},
				)
				pubCtx, pubCancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer pubCancel()
				_ = al.bus.PublishInbound(pubCtx, bus.InboundMessage{
					Context: bus.InboundContext{
						Channel:  "system",
						ChatID:   fmt.Sprintf("%s:%s", ts.channel, ts.chatID),
						ChatType: "direct",
						SenderID: fmt.Sprintf("async:%s", asyncToolName),
					},
					Content: content,
				})
			}

			execCtx := tools.WithToolInboundContext(
				turnCtx,
				ts.channel,
				ts.chatID,
				ts.opts.Dispatch.MessageID(),
				ts.opts.Dispatch.ReplyToMessageID(),
			)
			execCtx = tools.WithToolSessionContext(
				execCtx,
				ts.agent.ID,
				ts.sessionKey,
				ts.opts.Dispatch.SessionScope,
			)

			start := time.Now()
			result := ts.agent.Tools.ExecuteWithContext(
				execCtx,
				slot.toolName,
				slot.toolArgs,
				ts.channel,
				ts.chatID,
				asyncCallback,
			)
			slot.duration = time.Since(start)
			slot.toolResult = result

			if ts.hardAbortRequested() {
				slot.hardAborted = true
			}
		}(i)
	}

	wg.Wait()

	// ── Phase 3: result processing  (sequential, in original order) ──────────
	for i := range slots {
		slot := &slots[i]

		if slot.hardAborted {
			exec.abortedByHardAbort = true
			exec.messages = messages
			return ToolControlBreak
		}

		toolName := slot.toolName
		toolCallID := slot.toolCallID
		toolResult := slot.toolResult
		toolDuration := slot.duration

		if toolName == "todo_write" {
			todoWriteCalledThisBatch = true
		}

		if toolResult == nil {
			toolResult = tools.ErrorResult("tool returned nil result")
		}

		// Deliver media attachments that are "response handled" (e.g. sent
		// directly to the channel rather than going back to the LLM).
		if len(toolResult.Media) > 0 && toolResult.ResponseHandled {
			parts := make([]bus.MediaPart, 0, len(toolResult.Media))
			for _, ref := range toolResult.Media {
				part := bus.MediaPart{Ref: ref}
				if al.mediaStore != nil {
					if _, meta, err := al.mediaStore.ResolveWithMeta(ref); err == nil {
						part.Filename = meta.Filename
						part.ContentType = meta.ContentType
						part.Type = inferMediaType(meta.Filename, meta.ContentType)
					}
				}
				parts = append(parts, part)
			}
			outboundMedia := bus.OutboundMediaMessage{
				Channel: ts.channel,
				ChatID:  ts.chatID,
				Context: outboundContextFromInbound(
					ts.opts.Dispatch.InboundContext,
					ts.channel,
					ts.chatID,
					ts.opts.Dispatch.ReplyToMessageID(),
				),
				AgentID:    ts.agent.ID,
				SessionKey: ts.sessionKey,
				Scope:      outboundScopeFromSessionScope(ts.opts.Dispatch.SessionScope),
				Parts:      parts,
			}
			if al.channelManager != nil && ts.channel != "" && !constants.IsInternalChannel(ts.channel) {
				if err := al.channelManager.SendMedia(ctx, outboundMedia); err != nil {
					logger.WarnCF("agent", "Failed to deliver handled tool media",
						map[string]any{
							"agent_id": ts.agent.ID,
							"tool":     toolName,
							"channel":  ts.channel,
							"chat_id":  ts.chatID,
							"error":    err.Error(),
						})
					toolResult = tools.ErrorResult(fmt.Sprintf("failed to deliver attachment: %v", err)).WithError(err)
				} else {
					handledAttachments = append(
						handledAttachments,
						buildProviderAttachments(al.mediaStore, toolResult.Media)...,
					)
				}
			} else if al.bus != nil {
				al.bus.PublishOutboundMedia(ctx, outboundMedia)
				toolResult.ResponseHandled = false
			}
		}

		if len(toolResult.Media) > 0 && !toolResult.ResponseHandled {
			toolResult.ArtifactTags = buildArtifactTags(al.mediaStore, toolResult.Media)
		}

		if !toolResult.ResponseHandled {
			exec.allResponsesHandled = false
		}

		if toolResult.ShouldPublishDirectly(ts.opts.SendResponse) {
			al.bus.PublishOutbound(ctx, outboundMessageForTurn(ts, toolResult.ForUser))
		}

		contentForLLM := toolResult.ContentForLLM()
		if al.cfg.Tools.IsFilterSensitiveDataEnabled() {
			contentForLLM = al.cfg.FilterSensitiveData(contentForLLM)
		}

		toolResultMsg := providers.Message{
			Role:       "tool",
			Content:    contentForLLM,
			ToolCallID: toolCallID,
		}
		if len(toolResult.Media) > 0 && !toolResult.ResponseHandled {
			toolResultMsg.Media = append(toolResultMsg.Media, toolResult.Media...)
		}

		al.emitEvent(
			EventKindToolExecEnd,
			ts.eventMeta("runTurn", "turn.tool.end"),
			ToolExecEndPayload{
				Tool:       toolName,
				Duration:   toolDuration,
				ForLLMLen:  len(contentForLLM),
				ForUserLen: len(toolResult.ForUser),
				IsError:    toolResult.IsError,
				Async:      toolResult.Async,
			},
		)

		messages = append(messages, toolResultMsg)
		if !ts.opts.NoHistory {
			ts.agent.Sessions.AddFullMessage(ts.sessionKey, toolResultMsg)
			ts.recordPersistedMessage(toolResultMsg)
			ts.ingestMessage(turnCtx, al, toolResultMsg)
		}
	}

	exec.messages = messages

	// ── Phase 4: steering / continuation checks ───────────────────────────────
	if todoWriteCalledThisBatch {
		exec.roundsSinceTodoUpdate = 0
	} else {
		exec.roundsSinceTodoUpdate++
	}

	// Collect any steering messages queued while tools were running.
	if steerMsgs := al.dequeueSteeringMessagesForScope(ts.sessionKey); len(steerMsgs) > 0 {
		exec.pendingMessages = append(exec.pendingMessages, steerMsgs...)
	}

	if len(exec.pendingMessages) > 0 {
		logger.InfoCF("agent", "[parallel] Pending steering after batch tool execution; continuing turn",
			map[string]any{
				"agent_id":      ts.agent.ID,
				"pending_count": len(exec.pendingMessages),
			})
		exec.allResponsesHandled = false
		return ToolControlContinue
	}

	if gracefulPending, _ := ts.gracefulInterruptRequested(); gracefulPending {
		logger.InfoCF("agent", "[parallel] Graceful interrupt after batch; breaking",
			map[string]any{"agent_id": ts.agent.ID})
		exec.allResponsesHandled = false
		return ToolControlContinue
	}

	// Drain pendingResults channel (subturn follow-up).
	if ts.pendingResults != nil {
		select {
		case result, ok := <-ts.pendingResults:
			if ok && result != nil && result.ForLLM != "" {
				content := al.cfg.FilterSensitiveData(result.ForLLM)
				msg := providers.Message{Role: "user", Content: fmt.Sprintf("[SubTurn Result] %s", content)}
				exec.messages = append(exec.messages, msg)
				ts.agent.Sessions.AddFullMessage(ts.sessionKey, msg)
			}
		default:
		}
	}

	if exec.allResponsesHandled {
		summaryMsg := providers.Message{
			Role:        "assistant",
			Content:     handledToolResponseSummary,
			Attachments: append([]providers.Attachment(nil), handledAttachments...),
		}
		if !ts.opts.NoHistory {
			ts.agent.Sessions.AddFullMessage(ts.sessionKey, summaryMsg)
			ts.recordPersistedMessage(summaryMsg)
			ts.ingestMessage(turnCtx, al, summaryMsg)
			if err := ts.agent.Sessions.Save(ts.sessionKey); err != nil {
				logger.WarnCF("agent", "Failed to save session after parallel tool delivery",
					map[string]any{
						"agent_id": ts.agent.ID,
						"error":    err.Error(),
					})
			}
		}
		if ts.opts.EnableSummary {
			al.contextManager.Compact(turnCtx, &CompactRequest{
				SessionKey: ts.sessionKey,
				Reason:     ContextCompressReasonSummarize,
				Budget:     ts.agent.ContextWindow,
			})
		}
		ts.setPhase(TurnPhaseCompleted)
		ts.setFinalContent("")
		logger.InfoCF("agent", "[parallel] Tool output satisfied delivery; ending turn without follow-up LLM",
			map[string]any{
				"agent_id":   ts.agent.ID,
				"iteration":  iteration,
				"tool_count": n,
			})
		return ToolControlBreak
	}

	ts.agent.Tools.TickTTL()

	if exec.roundsSinceTodoUpdate >= nagTodoRoundsThreshold && hasTodoActiveTasks(ts.agent, ts.sessionKey) {
		nagMsg := providers.Message{
			Role:    "user",
			Content: nagTodoReminderText,
		}
		exec.messages = append(exec.messages, nagMsg)
		exec.roundsSinceTodoUpdate = 0
	}

	return ToolControlContinue
}
