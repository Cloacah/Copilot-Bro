import test from "node:test";
import assert from "node:assert/strict";
import {
	isCopilotAutoVisionModelId,
	matchesVisionProxyRequestedId,
	resolveExtensionVisionProxyTarget
} from "../visionProxyModelSelection";
import type { ModelConfig } from "../types";

const qwenFlash: ModelConfig = {
	id: "qwen3.5-flash",
	provider: "qwen",
	modelFamilyKey: "qwen3.5-flash",
	baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
	contextLength: 128000,
	maxOutputTokens: 8192,
	vision: true,
	visionProxyModelId: "",
	toolCalling: true,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: []
};

test("matchesVisionProxyRequestedId accepts runtime id and bare model id", () => {
	assert.equal(matchesVisionProxyRequestedId(qwenFlash, "qwen3.5-flash::qwen"), true);
	assert.equal(matchesVisionProxyRequestedId(qwenFlash, "qwen3.5-flash"), true);
	assert.equal(matchesVisionProxyRequestedId(qwenFlash, "other-model"), false);
});

test("resolveExtensionVisionProxyTarget returns qwen runtime id for global default", () => {
	const target = resolveExtensionVisionProxyTarget(
		"qwen3.5-flash::qwen",
		[qwenFlash],
		new Set(["deepseek-v4-flash::deepseek"])
	);
	assert.deepEqual(target, {
		kind: "extended",
		runtimeId: "qwen3.5-flash::qwen",
		modelId: "qwen3.5-flash"
	});
});

test("resolveExtensionVisionProxyTarget matches bare id saved in settings", () => {
	const target = resolveExtensionVisionProxyTarget(
		"qwen3.5-flash",
		[qwenFlash],
		new Set()
	);
	assert.equal(target?.kind, "extended");
	assert.equal(target?.runtimeId, "qwen3.5-flash::qwen");
});

test("resolveExtensionVisionProxyTarget rejects self-referential proxy", () => {
	const target = resolveExtensionVisionProxyTarget(
		"qwen3.5-flash::qwen",
		[qwenFlash],
		new Set(["qwen3.5-flash::qwen", "qwen3.5-flash"])
	);
	assert.equal(target, undefined);
});

test("isCopilotAutoVisionModelId detects copilot auto routes", () => {
	assert.equal(isCopilotAutoVisionModelId("auto", "copilot"), true);
	assert.equal(isCopilotAutoVisionModelId("claude-sonnet-4.6", "copilot"), false);
});
