import test from "node:test";
import assert from "node:assert/strict";
import {
	buildThinkingOnlyFallbackText,
	hasSubstantiveChatResponse,
	usageIndicatesLengthStop
} from "../responseCompletion";

test("hasSubstantiveChatResponse accepts text or tool calls", () => {
	assert.equal(hasSubstantiveChatResponse({ textParts: [], toolCalls: [], reasoningParts: [] }), false);
	assert.equal(hasSubstantiveChatResponse({ textParts: ["hi"], toolCalls: [], reasoningParts: [] }), true);
	assert.equal(hasSubstantiveChatResponse({ textParts: [], toolCalls: [{}], reasoningParts: [] }), true);
});

test("buildThinkingOnlyFallbackText covers length stop and reasoning-only completion", () => {
	const lengthMsg = buildThinkingOnlyFallbackText({
		textParts: [],
		toolCalls: [],
		reasoningParts: ["step one"],
		finishReason: "length"
	});
	assert.match(lengthMsg, /token limit/i);

	const reasoningMsg = buildThinkingOnlyFallbackText({
		textParts: [],
		toolCalls: [],
		reasoningParts: ["planned summary"],
		finishReason: "stop"
	});
	assert.match(reasoningMsg, /reasoning phase/i);
	assert.match(reasoningMsg, /thinking section/i);
});

test("usageIndicatesLengthStop reads completion_tokens_details.finish_reason", () => {
	assert.equal(usageIndicatesLengthStop(undefined), false);
	assert.equal(
		usageIndicatesLengthStop({
			prompt_tokens: 1,
			completion_tokens: 1,
			total_tokens: 2,
			completion_tokens_details: { finish_reason: "length" }
		}),
		true
	);
});
