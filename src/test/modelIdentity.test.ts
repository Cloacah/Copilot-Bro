import test from "node:test";
import assert from "node:assert/strict";
import { getRuntimeModelId, isWrappedLanguageModelConfig } from "../config/modelIdentity";
import type { ModelConfig } from "../types";

const remoteModel: ModelConfig = {
	id: "alpha",
	provider: "deepseek",
	baseUrl: "https://example.com/v1",
	contextLength: 128000,
	maxOutputTokens: 4096,
	vision: false,
	toolCalling: true,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: []
};

const wrappedModel: ModelConfig = {
	id: "copilot/gpt-4.1",
	displayName: "GPT-4.1 (Wrapped)",
	provider: "copilot",
	contextLength: 128000,
	maxOutputTokens: 8192,
	vision: false,
	toolCalling: true,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: [],
	modelSource: "vscode-lm-wrapper",
	wrappedLanguageModelId: "copilot/gpt-4.1",
	wrappedLanguageModelVendor: "copilot"
};

test("getRuntimeModelId preserves remote ids and namespaces wrapped vscode models", () => {
	assert.equal(getRuntimeModelId(remoteModel), "alpha::deepseek");
	assert.equal(getRuntimeModelId(wrappedModel), "vscode-lm::copilot::copilot/gpt-4.1");
	assert.notEqual(getRuntimeModelId(remoteModel), getRuntimeModelId(wrappedModel));
});

test("getRuntimeModelId uses modelFamilyKey as stable picker identity", () => {
	const familyModel: ModelConfig = {
		...remoteModel,
		id: "qwen3-max",
		provider: "qwen",
		modelFamilyKey: "qwen-max"
	};
	assert.equal(getRuntimeModelId(familyModel), "qwen-max::qwen");
	familyModel.id = "qwen-max-latest";
	assert.equal(getRuntimeModelId(familyModel), "qwen-max::qwen");
});

test("isWrappedLanguageModelConfig only matches explicit wrapper configs", () => {
	assert.equal(isWrappedLanguageModelConfig(remoteModel), false);
	assert.equal(isWrappedLanguageModelConfig(wrappedModel), true);
	assert.equal(isWrappedLanguageModelConfig({ modelSource: "vscode-lm-wrapper" }), false);
});