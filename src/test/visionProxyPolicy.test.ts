import test from "node:test";
import assert from "node:assert/strict";
import { resolveVisionProxyPolicy } from "../visionProxyPolicy";
import type { ExtensionSettings, ModelConfig } from "../types";
import { visionProxyFixture } from "./visionProxyTestFixtures";

const baseModel: ModelConfig = {
	id: "deepseek-v4-flash",
	provider: "deepseek",
	baseUrl: "https://example.com/v1",
	contextLength: 128000,
	maxOutputTokens: 4096,
	vision: false,
	visionProxyModelId: "",
	toolCalling: true,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: []
};

const baseSettings: Pick<ExtensionSettings, "visionProxy"> = {
	visionProxy: visionProxyFixture({ defaultModelId: "copilot-vision", selectionMode: "fixed" })
};

test("vision proxy policy treats self-referencing proxy as disabled", () => {
	assert.deepEqual(resolveVisionProxyPolicy({
		...baseModel,
		vision: true,
		visionProxyModelId: "deepseek-v4-flash"
	}, baseSettings), {
		enabled: false,
		required: false,
		requestedModelId: "deepseek-v4-flash",
		reason: "self-disabled"
	});

	assert.equal(resolveVisionProxyPolicy({
		...baseModel,
		vision: true,
		visionProxyModelId: "deepseek-v4-flash::deepseek"
	}, baseSettings).enabled, false);
});

test("vision proxy policy distinguishes configured proxy from native default", () => {
	assert.deepEqual(resolveVisionProxyPolicy({
		...baseModel,
		vision: true,
		visionProxyModelId: ""
	}, { visionProxy: { ...baseSettings.visionProxy, defaultModelId: "" } }), {
		enabled: false,
		required: false,
		reason: "native-default"
	});

	assert.deepEqual(resolveVisionProxyPolicy({
		...baseModel,
		vision: true,
		visionProxyModelId: "copilot-vision"
	}, baseSettings), {
		enabled: true,
		required: true,
		requestedModelId: "copilot-vision",
		reason: "model-configured"
	});
});

test("vision proxy policy keeps non-vision Bro models on global auto proxy", () => {
	assert.deepEqual(resolveVisionProxyPolicy({
		...baseModel,
		vision: false,
		visionProxyModelId: ""
	}, { visionProxy: { ...baseSettings.visionProxy, defaultModelId: "" } }), {
		enabled: true,
		required: true,
		reason: "global-auto"
	});
});
