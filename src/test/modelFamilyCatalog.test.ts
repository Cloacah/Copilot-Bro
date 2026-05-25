import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_PRESETS } from "../config/presets";
import { KIMI_MODEL_FAMILIES } from "../config/kimiModelFamilies";
import { QWEN_MODEL_FAMILIES } from "../config/qwenModelFamilies";
import { QWEN_HOST_UI_CONTRACT, validateQwenCatalogDataIntegrity } from "../config/qwenCatalogContract";
import { ZHIPU_HOST_UI_CONTRACT, validateZhipuCatalogDataIntegrity } from "../config/zhipuCatalogContract";
import { ZHIPU_MODEL_FAMILIES } from "../config/zhipuModelFamilies";
import { getRuntimeModelId } from "../config/modelIdentity";
import {
	addCustomModelVersionId,
	isBuiltinModelVersionId,
	listModelVersionIds,
	normalizeModelFamilyCustomVersions,
	removeCustomModelVersionId
} from "../config/modelFamilySettings";

test("qwen catalog data integrity (Host UI + preset contract)", () => {
	assert.deepEqual(validateQwenCatalogDataIntegrity(), []);
});

test("zhipu catalog data integrity (Host UI + preset contract)", () => {
	assert.deepEqual(validateZhipuCatalogDataIntegrity(), []);
});

test("qwen built-in presets expose one row per model family", () => {
	const qwenPresets = BUILT_IN_PRESETS.filter((model) => model.provider === "qwen");
	assert.equal(qwenPresets.length, QWEN_MODEL_FAMILIES.length, "one built-in preset row per Bailian family");
	assert.equal(QWEN_MODEL_FAMILIES.length, QWEN_HOST_UI_CONTRACT.familyCount);
	const catalogModelIds = QWEN_MODEL_FAMILIES.flatMap((family) => family.versionIds);
	assert.equal(catalogModelIds.length, QWEN_HOST_UI_CONTRACT.modelIdCount);
	assert.equal(new Set(catalogModelIds).size, QWEN_HOST_UI_CONTRACT.uniqueModelIdCount, "catalog model ids must be unique");
	const openSource = QWEN_MODEL_FAMILIES.find((family) => family.familyKey === "qwen3.6-open-source");
	assert.ok(openSource);
	assert.equal(openSource?.displayName, "Qwen3.6 Open Source");
	assert.equal(openSource?.category, "qwen3.6");
	assert.equal(openSource?.versionIds.length, 2);
	const vlOpenSource = QWEN_MODEL_FAMILIES.find((family) => family.familyKey === QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey);
	assert.ok(vlOpenSource);
	assert.equal(vlOpenSource?.displayName, "Qwen3-VL Open Source");
	assert.equal(vlOpenSource?.versionIds.length, QWEN_HOST_UI_CONTRACT.vlOpenSourceVersionCount);
	assert.equal(vlOpenSource?.defaultVersionId, QWEN_HOST_UI_CONTRACT.vlOpenSourceDefaultVersionId);
	const familyKeys = new Set(qwenPresets.map((model) => model.modelFamilyKey));
	assert.equal(familyKeys.size, QWEN_MODEL_FAMILIES.length);
	for (const preset of qwenPresets) {
		assert.ok(preset.modelFamilyKey);
		assert.match(preset.modelFamilyKey ?? "", /^[a-z0-9.-]+$/);
	assert.equal(getRuntimeModelId(preset), `${preset.modelFamilyKey}::qwen`);
	}
});

test("zhipu built-in presets expose one row per model family", () => {
	const zhipuPresets = BUILT_IN_PRESETS.filter((model) => model.provider === "zhipu");
	assert.equal(zhipuPresets.length, ZHIPU_MODEL_FAMILIES.length, "one built-in preset row per Zhipu family");
	assert.equal(ZHIPU_MODEL_FAMILIES.length, ZHIPU_HOST_UI_CONTRACT.familyCount);
	const catalogModelIds = ZHIPU_MODEL_FAMILIES.flatMap((family) => family.versionIds);
	assert.equal(catalogModelIds.length, ZHIPU_HOST_UI_CONTRACT.modelIdCount);
	assert.equal(new Set(catalogModelIds).size, ZHIPU_HOST_UI_CONTRACT.uniqueModelIdCount);
	const glm51 = ZHIPU_MODEL_FAMILIES.find((family) => family.familyKey === "glm-5.1");
	assert.ok(glm51);
	assert.equal(glm51?.thinking, "enabled");
	const glm5v = ZHIPU_MODEL_FAMILIES.find((family) => family.familyKey === "glm-5v-turbo");
	assert.ok(glm5v?.vision);
	assert.equal(glm5v?.thinking, "disabled");
	const glm41Thinking = ZHIPU_MODEL_FAMILIES.find((family) => family.familyKey === "glm-4.1v-thinking");
	assert.ok(glm41Thinking);
	assert.equal(glm41Thinking?.thinking, "enabled");
	assert.ok(glm41Thinking?.versionIds.includes("glm-4.1v-thinking-flashx"));
	for (const preset of zhipuPresets) {
		assert.ok(preset.modelFamilyKey);
		if (preset.vision) {
			assert.equal(preset.visionProxyModelId, null);
		}
	}
});

test("kimi built-in presets expose one row per model family", () => {
	const kimiPresets = BUILT_IN_PRESETS.filter((model) => model.provider === "kimi");
	assert.equal(kimiPresets.length, KIMI_MODEL_FAMILIES.length, "one built-in preset row per Kimi family");
	const k26 = KIMI_MODEL_FAMILIES.find((family) => family.familyKey === "kimi-k2.6");
	assert.ok(k26);
	assert.equal(k26?.displayName, "Kimi K2.6");
	assert.equal(k26?.versionIds.length, 1);
	const moonshot = KIMI_MODEL_FAMILIES.find((family) => family.familyKey === "moonshot-v1");
	assert.ok(moonshot);
	assert.equal(moonshot?.displayName, "Moonshot V1");
	assert.equal(moonshot?.versionIds.length, 6);
	const catalogModelIds = KIMI_MODEL_FAMILIES.flatMap((family) => family.versionIds);
	assert.equal(catalogModelIds.length, 8);
	assert.equal(new Set(catalogModelIds).size, 8);
	assert.equal(KIMI_MODEL_FAMILIES.some((family) => family.familyKey === "kimi-k2"), false);
	assert.equal(KIMI_MODEL_FAMILIES.some((family) => family.familyKey === "kimi-k2-thinking"), false);
});

test("model family custom versions merge with builtin catalog ids", () => {
	let custom = normalizeModelFamilyCustomVersions({});
	assert.ok(isBuiltinModelVersionId("qwen", "qwen3-max", "qwen3-max"));
	custom = addCustomModelVersionId(custom, "qwen", "qwen3-max", "my-qwen3-max-snapshot");
	const versions = listModelVersionIds("qwen", "qwen3-max", custom);
	assert.ok(versions.includes("qwen3-max"));
	assert.ok(versions.includes("my-qwen3-max-snapshot"));
	custom = removeCustomModelVersionId(custom, "qwen", "qwen3-max", "my-qwen3-max-snapshot");
	assert.deepEqual(listModelVersionIds("qwen", "qwen3-max", custom), listModelVersionIds("qwen", "qwen3-max", {}));
});
