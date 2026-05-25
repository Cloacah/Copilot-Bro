import test from "node:test";
import assert from "node:assert/strict";
import { buildHeaders, buildRequestBody } from "../openaiCompat/request";
import type { ModelConfig } from "../types";
import type { ProvideLanguageModelChatResponseOptions } from "vscode";

const model: ModelConfig = {
	id: "deepseek-v4-pro",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	contextLength: 128000,
	maxOutputTokens: 8192,
	vision: false,
	toolCalling: true,
	temperature: 1,
	topP: 1,
	reasoningEffort: "high",
	thinking: { type: "enabled" },
	headers: { "X-Test": "1" },
	extraBody: { seed: 42 },
	includeReasoningInRequest: false,
	editTools: []
};

test("buildRequestBody includes model options and extra body", () => {
	const body = buildRequestBody(
		model,
		[{ role: "user", content: "hello" }],
		{} as unknown as ProvideLanguageModelChatResponseOptions
	);

	assert.equal(body.model, "deepseek-v4-pro");
	assert.equal(body.stream, true);
	assert.equal(body.temperature, 1);
	assert.equal(body.top_p, 1);
	assert.equal(body.reasoning_effort, "high");
	assert.deepEqual(body.thinking, { type: "enabled" });
	assert.equal(body.seed, 42);
	assert.equal(body.tools, undefined);
});

test("buildHeaders merges custom headers", () => {
	const headers = buildHeaders("secret", model, { "X-Extended-Models-Request-Id": "req-1" });

	assert.equal(headers.Authorization, "Bearer secret");
	assert.equal(headers["X-Test"], "1");
	assert.equal(headers["X-Extended-Models-Request-Id"], "req-1");
	assert.equal(headers.Accept, "text/event-stream");
});

test("Kimi uses auto tool choice because required is not supported", () => {
	const body = buildRequestBody(
		{ ...model, provider: "kimi", id: "kimi-k2.6" },
		[{ role: "user", content: "hello" }],
		{ tools: [{ name: "read_file", description: "Read a file", inputSchema: { type: "object" } }] } as unknown as ProvideLanguageModelChatResponseOptions,
		"read_file"
	);

	assert.equal(body.tool_choice, "auto");
});

test("Kimi thinking requests keep all reasoning for replay", () => {
	const body = buildRequestBody(
		{ ...model, provider: "kimi", id: "kimi-k2.6", baseUrl: "https://api.moonshot.ai/v1" },
		[{ role: "user", content: "hello" }],
		{} as unknown as ProvideLanguageModelChatResponseOptions
	);

	assert.deepEqual(body.thinking, { type: "enabled", keep: "all" });
});

test("Moonshot v1 omits thinking.keep when thinking is enabled", () => {
	const body = buildRequestBody(
		{ ...model, provider: "kimi", id: "moonshot-v1-8k", baseUrl: "https://api.moonshot.cn/v1" },
		[{ role: "user", content: "hello" }],
		{} as unknown as ProvideLanguageModelChatResponseOptions
	);

	assert.deepEqual(body.thinking, { type: "enabled" });
});

test("Moonshot v1 and non-Kimi models omit thinking.keep", () => {
	const moonshot = buildRequestBody(
		{ ...model, provider: "kimi", id: "moonshot-v1-8k", baseUrl: "https://api.moonshot.ai/v1" },
		[{ role: "user", content: "hello" }],
		{} as unknown as ProvideLanguageModelChatResponseOptions
	);
	assert.deepEqual(moonshot.thinking, { type: "enabled" });

	const deepseek = buildRequestBody(model, [{ role: "user", content: "hello" }], {} as unknown as ProvideLanguageModelChatResponseOptions);
	assert.deepEqual(deepseek.thinking, { type: "enabled" });
});

test("Qwen presets do not send unsupported generic thinking object", () => {
	const body = buildRequestBody(
		{ ...model, provider: "qwen", id: "qwq-plus", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
		[{ role: "user", content: "hello" }],
		{} as unknown as ProvideLanguageModelChatResponseOptions
	);

	assert.equal(body.thinking, undefined);
});

test("required tool mode with multiple tools uses OpenAI required tool choice", () => {
	const body = buildRequestBody(
		model,
		[{ role: "user", content: "hello" }],
		{
			toolMode: 2,
			tools: [
				{ name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
				{ name: "list_files", description: "List files", inputSchema: { type: "object" } }
			]
		} as unknown as ProvideLanguageModelChatResponseOptions,
		"required"
	);

	assert.equal(body.tool_choice, "required");
});

test("DeepSeek tool requests keep thinking enabled when configured", () => {
	const body = buildRequestBody(
		model,
		[{ role: "user", content: "hello" }],
		{ tools: [{ name: "read_file", description: "Read a file", inputSchema: { type: "object" } }] } as unknown as ProvideLanguageModelChatResponseOptions,
		"read_file"
	);

	assert.deepEqual(body.thinking, { type: "enabled" });
	assert.equal(body.reasoning_effort, "high");
	assert.deepEqual(body.tool_choice, { type: "function", function: { name: "read_file" } });
});
