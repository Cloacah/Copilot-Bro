import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_PRESETS } from "../config/presets";
import {
	implicitModelFamilyKey,
	listModelVersionIds,
	resolveEffectiveModelFamilyKey
} from "../config/modelFamilySettings";
import { attachModelVersionIdsToPresets } from "../ui/modelFamilyUi";

test("generic model version picker uses implicit family for non-catalog providers", () => {
	const deepseek = BUILT_IN_PRESETS.find((model) => model.id === "deepseek-v4-flash");
	assert.ok(deepseek);
	const familyKey = resolveEffectiveModelFamilyKey(deepseek!);
	assert.equal(familyKey, implicitModelFamilyKey("deepseek-v4-flash"));
	const versions = listModelVersionIds("deepseek", familyKey, {});
	assert.deepEqual(versions, ["deepseek-v4-flash"]);
});

test("attachModelVersionIdsToPresets adds version lists for every provider model", () => {
	const views = attachModelVersionIdsToPresets(
		BUILT_IN_PRESETS.slice(0, 5).map((model) => ({
			id: model.id,
			runtimeId: `${model.id}::${model.provider}`,
			provider: model.provider,
			modelFamilyKey: model.modelFamilyKey,
			contextLength: model.contextLength,
			maxOutputTokens: model.maxOutputTokens,
			toolCalling: model.toolCalling,
			vision: model.vision,
			editTools: model.editTools
		})),
		{}
	);
	for (const view of views) {
		assert.ok(view.modelFamilyKey);
		assert.ok(view.versionIds?.length);
	}
});
