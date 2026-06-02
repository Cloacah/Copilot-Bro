import type { ChatCompletionUsage } from "./types";

/** Mirrors provider replay tracking used to decide whether Chat received a substantive response. */
export interface ChatResponseReplaySnapshot {
	textParts: string[];
	toolCalls: readonly unknown[];
	reasoningParts: string[];
	finishReason?: string;
}

export function hasSubstantiveChatResponse(state: ChatResponseReplaySnapshot): boolean {
	return state.textParts.join("").trim().length > 0 || state.toolCalls.length > 0;
}

/**
 * VS Code Copilot treats thinking-only streams as "no response". Emit a visible TextPart when the
 * provider ended after reasoning/tool rounds without answer text.
 */
export function buildThinkingOnlyFallbackText(state: ChatResponseReplaySnapshot): string {
	const reasoning = state.reasoningParts.join("").trim();
	if (state.finishReason === "length") {
		return [
			"The model reached the output token limit before producing a separate answer.",
			reasoning
				? "Partial reasoning was streamed above; retry with a shorter prompt or increase max output tokens."
				: "Retry with a shorter prompt or increase max output tokens."
		].join(" ");
	}
	if (state.finishReason === "content_filter") {
		return "The provider ended the stream due to content filtering without a separate answer.";
	}
	if (reasoning) {
		return [
			"The model finished an extended reasoning phase without a separate answer block.",
			"See the thinking section above, retry with a shorter prompt, or run /compact if the session accumulated large tool/terminal outputs.",
			"If the provider hit an output token limit, increase max output tokens when possible."
		].join(" ");
	}
	return "The provider ended the stream without returning visible content. Retry the request or adjust max output tokens.";
}

export function usageIndicatesLengthStop(usage?: ChatCompletionUsage): boolean {
	if (!usage || typeof usage !== "object") {
		return false;
	}
	const details = usage.completion_tokens_details;
	if (!details || typeof details !== "object") {
		return false;
	}
	const reason = (details as { finish_reason?: unknown }).finish_reason;
	return reason === "length";
}
