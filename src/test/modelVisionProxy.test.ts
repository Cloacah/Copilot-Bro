import test from "node:test";
import assert from "node:assert/strict";
import {
	resolveEffectiveModelVisionProxySelection,
	resolveModelVisionProxyFields
} from "../config/modelVisionProxy";
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
	toolCalling: true,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: []
};

const baseSettings: Pick<ExtensionSettings, "visionProxy"> = {
	visionProxy: visionProxyFixture({ defaultModelId: "copilot-vision", selectionMode: "fixed" })
};

test("resolveModelVisionProxyFields migrates legacy null to disabled scope", () => {
	assert.deepEqual(resolveModelVisionProxyFields({ visionProxyModelId: null }), {
		visionProxyScope: "disabled",
		visionProxyFixedModelId: "",
		visionProxyCustomModelIds: [],
		visionProxyModelId: null
	});
});

test("resolveModelVisionProxyFields migrates legacy fixed id", () => {
	assert.deepEqual(resolveModelVisionProxyFields({ visionProxyModelId: "glm-4.6v" }), {
		visionProxyScope: "fixed",
		visionProxyFixedModelId: "glm-4.6v",
		visionProxyCustomModelIds: [],
		visionProxyModelId: "glm-4.6v"
	});
});

test("model custom-list overrides global fixed chain policy", () => {
	const model: ModelConfig = {
		...baseModel,
		visionProxyScope: "custom-list",
		visionProxyCustomModelIds: ["proxy-a", "proxy-b"],
		visionProxyFixedModelId: "",
		visionProxyModelId: "proxy-a"
	};
	const effective = resolveEffectiveModelVisionProxySelection(model, baseSettings);
	assert.equal(effective.selectionMode, "custom-list");
	assert.deepEqual(effective.customModelIds, ["proxy-a", "proxy-b"]);
	assert.equal(resolveVisionProxyPolicy(model, baseSettings).reason, "model-custom-list");
});

test("model inherit uses global selection mode", () => {
	const model: ModelConfig = {
		...baseModel,
		visionProxyScope: "inherit",
		visionProxyModelId: undefined
	};
	const effective = resolveEffectiveModelVisionProxySelection(model, {
		visionProxy: visionProxyFixture({ selectionMode: "custom-list", customModelIds: ["g1", "g2"] })
	});
	assert.equal(effective.selectionMode, "custom-list");
	assert.deepEqual(effective.customModelIds, ["g1", "g2"]);
});

test("model auto sets effective.enabled false when model has native vision", () => {
	const model: ModelConfig = {
		...baseModel,
		vision: true,
		visionProxyScope: "auto"
	};
	const effective = resolveEffectiveModelVisionProxySelection(model, baseSettings);
	assert.equal(effective.enabled, false);
	assert.equal(resolveVisionProxyPolicy(model, baseSettings).reason, "native-default");
});

test("model auto enables proxy for non-vision even when global disabled", () => {
	const model: ModelConfig = {
		...baseModel,
		vision: false,
		visionProxyScope: "auto"
	};
	const settings = {
		visionProxy: visionProxyFixture({ enabled: false, selectionMode: "auto", defaultModelId: "" })
	};
	assert.equal(resolveEffectiveModelVisionProxySelection(model, settings).enabled, true);
	assert.equal(resolveVisionProxyPolicy(model, settings).reason, "model-auto");
});
