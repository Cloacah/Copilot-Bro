import test from "node:test";
import assert from "node:assert/strict";
import { getRuntimeModelId } from "../config/modelIdentity";
import { normalizeEditorSelection, resolveInitialEditorSelection, selectionFromModel } from "../ui/editorSelection";
import type { ModelConfig } from "../types";

const models: ModelConfig[] = [
	{
		id: "alpha",
		configId: "builtin-alpha",
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
	},
	{
		id: "beta",
		provider: "qwen",
		baseUrl: "https://example.com/v1",
		contextLength: 128000,
		maxOutputTokens: 4096,
		vision: true,
		toolCalling: true,
		headers: {},
		extraBody: {},
		includeReasoningInRequest: false,
		editTools: []
	}
];

test("normalizeEditorSelection trims persisted values", () => {
	assert.deepEqual(normalizeEditorSelection({ provider: " deepseek ", modelRuntimeId: " alpha::builtin-alpha " }), {
		provider: "deepseek",
		modelRuntimeId: "alpha::builtin-alpha"
	});
	assert.equal(normalizeEditorSelection({ provider: " ", modelRuntimeId: " " }), undefined);
});

test("resolveInitialEditorSelection prefers a valid stored runtime id", () => {
	const selection = resolveInitialEditorSelection({
		provider: "qwen",
		modelRuntimeId: getRuntimeModelId(models[0])
	}, models);

	assert.deepEqual(selection, {
		provider: "deepseek",
		modelRuntimeId: getRuntimeModelId(models[0])
	});
});

test("resolveInitialEditorSelection falls back to the stored provider when runtime id is stale", () => {
	const selection = resolveInitialEditorSelection({
		provider: "qwen",
		modelRuntimeId: "missing::provider"
	}, models);

	assert.deepEqual(selection, {
		provider: "qwen",
		modelRuntimeId: getRuntimeModelId(models[1])
	});
});

test("resolveInitialEditorSelection falls back to the first model when no stored selection exists", () => {
	const selection = resolveInitialEditorSelection(undefined, models);

	assert.deepEqual(selection, {
		provider: "deepseek",
		modelRuntimeId: getRuntimeModelId(models[0])
	});
});

test("selectionFromModel preserves config-aware runtime ids", () => {
	assert.deepEqual(selectionFromModel(models[0]), {
		provider: "deepseek",
		modelRuntimeId: getRuntimeModelId(models[0])
	});
});