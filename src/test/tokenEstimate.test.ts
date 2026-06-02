import test from "node:test";
import assert from "node:assert/strict";
import {
	estimateChatCompletionRequestTokens,
	estimateOpenAIMessageTokens,
	estimateTextTokens,
	estimateTokens,
	estimateToolsDefinitionTokens
} from "../openaiCompat/tokenEstimate";
import { compactToolResultText } from "../openaiCompat/toolResultCompaction";

test("estimateTextTokens uses conservative class heuristic", () => {
	const english = estimateTextTokens("hello world from token estimator");
	const cjk = estimateTextTokens("魔法之塔策划案更新");
	assert.ok(english >= 4);
	assert.ok(cjk >= 6);
});

test("estimateTokens counts tool results with compaction applied", () => {
	const huge = "x".repeat(8000) + "\nERROR: failed\n" + "y".repeat(8000);
	const prior = process.env.COPILOT_BRO_TOOL_RESULT_COMPACT;
	process.env.COPILOT_BRO_TOOL_RESULT_COMPACT = "off";
	const fullTokens = estimateTokens({
		role: 2,
		content: [{ callId: "call_1", content: [huge] }]
	} as any);
	if (prior === undefined) {
		delete process.env.COPILOT_BRO_TOOL_RESULT_COMPACT;
	} else {
		process.env.COPILOT_BRO_TOOL_RESULT_COMPACT = prior;
	}
	const compactTokens = estimateTokens({
		role: 2,
		content: [{ callId: "call_1", content: [compactToolResultText(huge).text] }]
	} as any);
	assert.ok(compactTokens < fullTokens);
});

test("estimateOpenAIMessageTokens includes reasoning_content and tool_calls", () => {
	const tokens = estimateOpenAIMessageTokens([
		{
			role: "assistant",
			reasoning_content: "step by step reasoning ".repeat(20),
			tool_calls: [{
				id: "call_a",
				type: "function",
				function: { name: "run_terminal", arguments: "{\"cmd\":\"ls\"}" }
			}]
		},
		{ role: "tool", tool_call_id: "call_a", content: "ok\n" }
	]);
	assert.ok(tokens > 50);
});

test("estimateChatCompletionRequestTokens includes tools schema overhead", () => {
	const messages = [{ role: "user", content: "hi" }] as const;
	const withoutTools = estimateChatCompletionRequestTokens(messages);
	const withTools = estimateChatCompletionRequestTokens(messages, [{
		name: "run_terminal_cmd",
		description: "Run a command".repeat(40),
		inputSchema: { type: "object", properties: { cmd: { type: "string" } } }
	}]);
	assert.ok(withTools > withoutTools);
	assert.ok(estimateToolsDefinitionTokens([]) === 0);
});
