import { BUILT_IN_PRESETS } from "./presets";
import { ZHIPU_MODEL_FAMILIES } from "./zhipuModelFamilies";
import type { ModelFamilyDefinition } from "./modelFamilyCatalog";

function requireZhipuFamily(familyKey: string): ModelFamilyDefinition {
	const family = ZHIPU_MODEL_FAMILIES.find((entry) => entry.familyKey === familyKey);
	if (!family) {
		throw new Error(`ZHIPU_MODEL_FAMILIES missing family "${familyKey}"`);
	}
	return family;
}

const flatZhipuVersionIds = ZHIPU_MODEL_FAMILIES.flatMap((family) => family.versionIds);
const uniqueZhipuVersionIds = new Set(flatZhipuVersionIds);

const glm51Family = requireZhipuFamily("glm-5.1");
const glm5vTurboFamily = requireZhipuFamily("glm-5v-turbo");
const glm4FlashFamily = requireZhipuFamily("glm-4-flash");

/** Host UI smoke + preset-catalog contract values derived from {@link ZHIPU_MODEL_FAMILIES}. */
export const ZHIPU_HOST_UI_CONTRACT = {
	familyCount: ZHIPU_MODEL_FAMILIES.length,
	modelIdCount: flatZhipuVersionIds.length,
	uniqueModelIdCount: uniqueZhipuVersionIds.size,
	glm51FamilyKey: glm51Family.familyKey,
	glm51DefaultVersionId: glm51Family.defaultVersionId,
	glm5vTurboFamilyKey: glm5vTurboFamily.familyKey,
	glm5vTurboDefaultVersionId: glm5vTurboFamily.defaultVersionId,
	glm4FlashFamilyKey: glm4FlashFamily.familyKey,
	glm4FlashDefaultVersionId: glm4FlashFamily.defaultVersionId,
	glm4FlashVersionIds: [...glm4FlashFamily.versionIds]
} as const;

/** Returns human-readable issue codes (empty = catalog consistent with built-in presets). */
export function validateZhipuCatalogDataIntegrity(): string[] {
	const issues: string[] = [];
	if (uniqueZhipuVersionIds.size !== flatZhipuVersionIds.length) {
		issues.push("zhipu.catalog.duplicate-version-id-across-families");
	}
	const seenFamilyKeys = new Set<string>();
	for (const family of ZHIPU_MODEL_FAMILIES) {
		if (seenFamilyKeys.has(family.familyKey)) {
			issues.push(`zhipu.catalog.duplicate-family-key:${family.familyKey}`);
		}
		seenFamilyKeys.add(family.familyKey);
		if (!family.versionIds.includes(family.defaultVersionId)) {
			issues.push(`zhipu.catalog.default-not-in-versions:${family.familyKey}`);
		}
		if (family.vision && family.thinking !== "enabled" && family.thinking !== "disabled") {
			issues.push(`zhipu.catalog.vision-missing-thinking:${family.familyKey}`);
		}
	}
	const zhipuPresetRows = BUILT_IN_PRESETS.filter((model) => model.provider === "zhipu");
	if (zhipuPresetRows.length !== ZHIPU_MODEL_FAMILIES.length) {
		issues.push("zhipu.catalog.preset-row-count-mismatch");
	}
	for (const preset of zhipuPresetRows) {
		if (preset.vision && preset.visionProxyModelId !== null) {
			issues.push(`zhipu.catalog.vision-proxy-must-be-null:${preset.modelFamilyKey ?? preset.id}`);
		}
	}
	const glm51Preset = BUILT_IN_PRESETS.find((model) => model.modelFamilyKey === glm51Family.familyKey);
	if (!glm51Preset || glm51Preset.id !== glm51Family.defaultVersionId) {
		issues.push("zhipu.catalog.glm-5.1-preset-id-must-match-defaultVersionId");
	}
	if (!glm4FlashFamily.versionIds.includes("glm-4-flash")) {
		issues.push("zhipu.catalog.glm-4-flash-alias-missing");
	}
	return issues;
}
