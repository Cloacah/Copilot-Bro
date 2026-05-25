import test from "node:test";
import assert from "node:assert/strict";
import { convertMessages, encodeReasoningMarker, estimateTokens, repairReasoningToolHistory } from "../openaiCompat/messages";
import { fingerprintAssistantTurn, ReasoningCache } from "../reasoningCache";
import type { ModelConfig } from "../types";

const model: ModelConfig = {
	id: "test-model",
	provider: "test",
	baseUrl: "https://example.com/v1",
	contextLength: 128000,
	maxOutputTokens: 4096,
	vision: true,
	toolCalling: true,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: true,
	editTools: []
};

test("convertMessages emits OpenAI text and image content", () => {
	const messages = [
		{
			role: "user",
			content: [
				{ value: "describe this" },
				{ mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }
			]
		}
	] as any;

	const converted = convertMessages(messages, model, { user: "user", assistant: "assistant" });

	assert.equal(converted.length, 1);
	assert.equal(converted[0].role, "user");
	assert.deepEqual(converted[0].content, [
		{ type: "text", text: "describe this" },
		{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }
	]);
});

test("convertMessages omits tool-result image bytes from OpenAI tool text channel", () => {
	const messages = [
		{
			role: "assistant",
			content: [{ callId: "call-1", name: "screenshot_page", input: {} }]
		},
		{
			role: "user",
			content: [
				{
					callId: "call-1",
					content: [{ mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }]
				}
			]
		}
	] as any;

	const converted = convertMessages(messages, { ...model, vision: false }, { user: "user", assistant: "assistant" });
	const toolMessage = converted.find((entry) => entry.role === "tool");
	assert.match(String(toolMessage?.content), /Image binary omitted/);
	assert.equal(JSON.stringify(converted).includes("image_url"), false);
});

test("convertMessages emits assistant tool calls and tool results", () => {
	const messages = [
		{
			role: "assistant",
			content: [
				{ value: "I will inspect it." },
				{ callId: "call-1", name: "read_file", input: { path: "a.ts" } }
			]
		},
		{
			role: "user",
			content: [
				{ callId: "call-1", content: [{ value: "file contents" }] }
			]
		}
	] as any;

	const converted = convertMessages(messages, model, { user: "user", assistant: "assistant" });

	assert.equal(converted[0].role, "assistant");
	assert.equal(converted[0].tool_calls?.[0].function.name, "read_file");
	assert.equal(converted[1].role, "tool");
	assert.equal(converted[1].content, "file contents");
});

test("convertMessages replays hidden reasoning markers for DeepSeek thinking mode", () => {
	const marker = encodeReasoningMarker("inspect first");
	assert.equal(marker.includes("extended-models-reasoning"), false);
	assert.equal(marker.includes("inspect first"), false);

	const messages = [
		{
			role: "assistant",
			content: [
				{ value: marker },
				{ value: "I will inspect it." },
				{ callId: "call-1", name: "read_file", input: { path: "a.ts" } }
			]
		}
	] as any;

	const converted = convertMessages(messages, {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, { user: "user", assistant: "assistant" });

	assert.equal(converted[0].role, "assistant");
	assert.equal(converted[0].content, "I will inspect it.");
	assert.equal(converted[0].reasoning_content, "inspect first");
	assert.equal(converted[0].tool_calls?.[0].id, "call-1");
});

test("convertMessages strips rendered thinking details while replaying reasoning", () => {
	const messages = [
		{
			role: "assistant",
			content: [
				{
					value: [
						encodeReasoningMarker("inspect first"),
						"<details data-extended-models-reasoning=\"true\">",
						"<summary>思考过程 · inspect first</summary>",
						"",
						"inspect first",
						"</details>",
						"",
						"I will inspect it."
					].join("\n")
				},
				{ callId: "call-1", name: "read_file", input: { path: "a.ts" } }
			]
		}
	] as any;

	const converted = convertMessages(messages, {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, { user: "user", assistant: "assistant" });

	assert.equal(converted[0].content, "I will inspect it.");
	assert.equal(converted[0].reasoning_content, "inspect first");
});

test("convertMessages normalizes VS Code tool call suffixes before DeepSeek replay", () => {
	const marker = encodeReasoningMarker("inspect first");
	const messages = [
		{
			role: "assistant",
			content: [
				{ value: marker },
				{ callId: "call_00_KbuilOPaLYfPUBl1MHSSNNFf__vscode-1777465611355", name: "read_file", input: { path: "a.ts" } }
			]
		},
		{
			role: "user",
			content: [
				{ callId: "call_00_KbuilOPaLYfPUBl1MHSSNNFf__vscode-1777465611355", content: [{ value: "file contents" }] }
			]
		}
	] as any;

	const converted = convertMessages(messages, {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, { user: "user", assistant: "assistant" });

	assert.equal(converted[0].tool_calls?.[0].id, "call_00_KbuilOPaLYfPUBl1MHSSNNFf");
	assert.equal(converted[0].reasoning_content, "inspect first");
	assert.equal(converted[1].tool_call_id, "call_00_KbuilOPaLYfPUBl1MHSSNNFf");
});

test("convertMessages replays thinking attached to VS Code tool call parts", () => {
	const messages = [
		{
			role: "assistant",
			content: [
				{
					callId: "call-1__vscode-1777465611355",
					name: "read_file",
					input: { path: "a.ts" },
					thinking: JSON.stringify({ id: "thinking-1", text: "attached reasoning" })
				}
			]
		}
	] as any;

	const converted = convertMessages(messages, {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, { user: "user", assistant: "assistant" });

	assert.equal(converted[0].reasoning_content, "attached reasoning");
	assert.equal(converted[0].tool_calls?.[0].id, "call-1");
});

test("convertMessages does not send reasoning markers to providers that do not need replay", () => {
	const messages = [
		{
			role: "assistant",
			content: [
				{ value: encodeReasoningMarker("hidden") },
				{ value: "visible" }
			]
		}
	] as any;

	const converted = convertMessages(messages, {
		...model,
		provider: "other",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, { user: "user", assistant: "assistant" });

	assert.equal(converted[0].content, "visible");
	assert.equal(converted[0].reasoning_content, undefined);
});

test("convertMessages strips DeepSeek reasoning markers for non-tool assistant turns", () => {
	const messages = [
		{
			role: "assistant",
			content: [
				{ value: encodeReasoningMarker("hidden") },
				{ value: "visible" }
			]
		}
	] as any;

	const converted = convertMessages(messages, {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, { user: "user", assistant: "assistant" });

	assert.equal(converted[0].content, "visible");
	assert.equal(converted[0].reasoning_content, undefined);
});

test("repairReasoningToolHistory inserts cached assistant tool calls before orphan tool results", () => {
	const repaired = repairReasoningToolHistory([
		{ role: "user", content: "continue" },
		{ role: "tool", tool_call_id: "call-1__vscode-1777465611355", content: "result" }
	], {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, {
		getReasoning: () => undefined,
		getAssistantMessage: (callId) => callId === "call-1"
			? {
				role: "assistant",
				content: "",
				reasoning_content: "cached reasoning",
				tool_calls: [
					{
						id: "call-1",
						type: "function",
						function: {
							name: "read_file",
							arguments: "{\"path\":\"a.ts\"}"
						}
					},
					{
						id: "call-2",
						type: "function",
						function: {
							name: "list_dir",
							arguments: "{\"path\":\"src\"}"
						}
					}
				]
			}
			: undefined
	});

	assert.equal(repaired[1].role, "assistant");
	assert.equal(repaired[1].reasoning_content, "cached reasoning");
	assert.deepEqual(repaired[1].tool_calls?.map((toolCall) => toolCall.id), ["call-1"]);
	assert.equal(repaired[2].role, "tool");
	assert.equal(repaired[2].tool_call_id, "call-1");
});

test("repairReasoningToolHistory trims assistant tool calls to the available tool results", () => {
	const repaired = repairReasoningToolHistory([
		{
			role: "assistant",
			reasoning_content: "cached reasoning",
			tool_calls: [
				{
					id: "call-1__vscode-1777465611355",
					type: "function",
					function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" }
				},
				{
					id: "call-2__vscode-1777465611355",
					type: "function",
					function: { name: "list_dir", arguments: "{\"path\":\"src\"}" }
				}
			]
		},
		{ role: "tool", tool_call_id: "call-1__vscode-1777465611355", content: "result" },
		{ role: "user", content: "continue" }
	], {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, {
		getReasoning: () => undefined,
		getAssistantMessage: () => undefined
	});

	assert.deepEqual(repaired[0].tool_calls?.map((toolCall) => toolCall.id), ["call-1"]);
	assert.equal(repaired[1].tool_call_id, "call-1");
	assert.equal(repaired[2].role, "user");
});

test("repairReasoningToolHistory drops unrecoverable orphan tool results for DeepSeek", () => {
	const repaired = repairReasoningToolHistory([
		{ role: "user", content: "continue" },
		{ role: "tool", tool_call_id: "missing-call", content: "result" }
	], {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, {
		getReasoning: () => undefined,
		getAssistantMessage: () => undefined
	});

	assert.equal(repaired.length, 1);
	assert.equal(repaired[0].role, "user");
});

test("repairReasoningToolHistory drops assistant tool calls when true DeepSeek reasoning is unavailable", () => {
	const repaired = repairReasoningToolHistory([
		{
			role: "assistant",
			tool_calls: [
				{
					id: "call-missing__vscode-1777465611355",
					type: "function",
					function: { name: "create_file", arguments: "{\"path\":\"blank.html\"}" }
				}
			]
		},
		{ role: "tool", tool_call_id: "call-missing__vscode-1777465611355", content: "created" },
		{ role: "user", content: "continue" }
	], {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, {
		getReasoning: () => undefined,
		getAssistantMessage: () => undefined
	});

	assert.deepEqual(repaired, [
		{ role: "user", content: "continue" }
	]);
});

test("repairReasoningToolHistory applies replay rules to Kimi thinking mode", () => {
	const repaired = repairReasoningToolHistory([
		{
			role: "assistant",
			tool_calls: [
				{
					id: "call-kimi__vscode-1777465611355",
					type: "function",
					function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" }
				}
			]
		},
		{ role: "tool", tool_call_id: "call-kimi__vscode-1777465611355", content: "file" },
		{ role: "user", content: "continue" }
	], {
		...model,
		provider: "kimi",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, {
		getReasoning: () => undefined,
		getAssistantMessage: () => undefined
	});

	assert.deepEqual(repaired, [
		{ role: "user", content: "continue" }
	]);
});

test("repairReasoningToolHistory restores reasoning by assistant fingerprint", () => {
	const cachedAssistant = {
		role: "assistant" as const,
		content: "Done.",
		reasoning_content: "final reasoning"
	};
	const cache = new ReasoningCache();
	cache.set(fingerprintAssistantTurn(cachedAssistant), "final reasoning");

	const repaired = repairReasoningToolHistory([
		{
			role: "assistant",
			reasoning_content: "tool reasoning",
			tool_calls: [
				{
					id: "call-1",
					type: "function",
					function: { name: "create_file", arguments: "{}" }
				}
			]
		},
		{ role: "tool", tool_call_id: "call-1", content: "created" },
		{ role: "assistant", content: "Done." }
	], {
		...model,
		provider: "deepseek",
		thinking: { type: "enabled" },
		includeReasoningInRequest: false
	}, {
		getReasoning: () => undefined,
		getAssistantMessage: () => undefined,
		getReasoningForAssistant: (message) => cache.get(fingerprintAssistantTurn(message))
	});

	assert.equal(repaired[2].role, "assistant");
	assert.equal(repaired[2].reasoning_content, "final reasoning");
});

test("estimateTokens includes image cost", () => {
	const count = estimateTokens({
		role: "user",
		content: [
			{ value: "hello" },
			{ mimeType: "image/png", data: new Uint8Array([1]) }
		]
	} as any);

	assert.ok(count > 1000);
});

test("estimateTokens counts serialized text fields for token UI", () => {
	const count = estimateTokens({
		role: "user",
		content: [
			{ type: 1, text: "hello world from serialized copilot log" }
		]
	} as any);

	assert.ok(count > 4);
});
