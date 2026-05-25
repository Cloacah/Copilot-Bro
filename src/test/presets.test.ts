import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_PRESETS } from "../config/presets";
import { QWEN_HOST_UI_CONTRACT } from "../config/qwenCatalogContract";

test("built-in presets include official provider families", () => {
	const providers = new Set(BUILT_IN_PRESETS.map((model) => model.provider));

	for (const provider of ["deepseek", "zhipu", "minimax", "kimi", "qwen"]) {
		assert.equal(providers.has(provider), true);
	}

	const kimiK26 = BUILT_IN_PRESETS.find((model) => model.id === "kimi-k2.6");
	assert.ok(kimiK26?.vision);
	assert.equal(kimiK26?.modelFamilyKey, "kimi-k2.6");
	assert.equal(kimiK26?.displayName, "Kimi K2.6");
	const kimiK25 = BUILT_IN_PRESETS.find((model) => model.modelFamilyKey === "kimi-k2.5");
	assert.ok(kimiK25?.vision);
	assert.equal(kimiK25?.id, "kimi-k2.5");
	assert.equal(BUILT_IN_PRESETS.filter((model) => model.provider === "kimi").length, 3);
	assert.ok(BUILT_IN_PRESETS.some((model) => model.id === "MiniMax-M2.7" && model.extraBody.reasoning_split === true));
	const qwenCoder = BUILT_IN_PRESETS.find((model) => model.id === "qwen3-coder-next");
	assert.ok(qwenCoder, "Bailian catalog should include 通义千问3-Coder-Next");
	assert.equal(qwenCoder?.modelFamilyKey, "qwen3-open-source");
	assert.equal(qwenCoder?.id, "qwen3-coder-next");
	assert.equal(qwenCoder?.vision, false);
	const qwen3Max = BUILT_IN_PRESETS.find((model) => model.modelFamilyKey === "qwen3-max");
	assert.ok(qwen3Max);
	assert.equal(qwen3Max?.id, QWEN_HOST_UI_CONTRACT.qwen3MaxDefaultVersionId);
	assert.equal(qwen3Max?.vision, false);
	const qwenVl = BUILT_IN_PRESETS.find((model) => model.modelFamilyKey === "qwenvl-plus");
	assert.ok(qwenVl?.vision);
	assert.equal(qwenVl?.visionProxyModelId, null);
	assert.ok(BUILT_IN_PRESETS.some((model) => model.id === "deepseek-v4-pro" && model.maxOutputTokens >= 32768 && model.contextLength === 1048576 && !model.vision));
	assert.deepEqual(BUILT_IN_PRESETS.find((model) => model.id === "deepseek-v4-pro")?.parameterHints?.reasoningEffort?.options, ["high", "max"]);
	assert.ok(BUILT_IN_PRESETS.every((model) => model.parameterHints));
	const zhipuCount = BUILT_IN_PRESETS.filter((model) => model.provider === "zhipu").length;
	assert.ok(zhipuCount >= 20, "Zhipu catalog should include text + vision families from BigModel docs");
	const glm47Flash = BUILT_IN_PRESETS.find((model) => model.modelFamilyKey === "glm-4.7-flash");
	assert.ok(glm47Flash);
	assert.equal(glm47Flash?.thinking?.type, "enabled");
});
