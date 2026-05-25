import type { OpenAIMessage } from "../types";
import { createDisabledVisionContent, createPlanOnlyContent, createTextFallbackContent } from "./outputSemantics";

export function buildFallbackPlan(reason: string, originalMessages: OpenAIMessage[]): OpenAIMessage {
	const latestUserText = originalMessages
		.slice()
		.reverse()
		.find((message) => message.role === "user");
	const summary = typeof latestUserText?.content === "string" ? latestUserText.content : "review the attached visual task";
	return {
		role: "assistant",
		content: createPlanOnlyContent(reason, summary)
	};
}

export function buildTextFallback(reason: string): OpenAIMessage {
	return {
		role: "assistant",
		content: createTextFallbackContent(reason)
	};
}

export function buildDisabledVisionMessage(reason: string): OpenAIMessage {
	return {
		role: "assistant",
		content: createDisabledVisionContent(reason)
	};
}