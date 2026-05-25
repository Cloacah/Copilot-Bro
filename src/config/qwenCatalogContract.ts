import { BUILT_IN_PRESETS } from "./presets";
import { QWEN_MODEL_FAMILIES } from "./qwenModelFamilies";
import type { ModelFamilyDefinition } from "./modelFamilyCatalog";

function requireQwenFamily(familyKey: string): ModelFamilyDefinition {
	const family = QWEN_MODEL_FAMILIES.find((entry) => entry.familyKey === familyKey);
	if (!family) {
		throw new Error(`QWEN_MODEL_FAMILIES missing family "${familyKey}"`);
	}
	return family;
}

const flatQwenVersionIds = QWEN_MODEL_FAMILIES.flatMap((family) => family.versionIds);
const uniqueQwenVersionIds = new Set(flatQwenVersionIds);

const qwen3MaxFamily = requireQwenFamily("qwen3-max");
const qwenVlOpenSourceFamily = requireQwenFamily("qwen3-vl-open-source");

/**
 * Values derived from {@link QWEN_MODEL_FAMILIES} for Host UI smoke, preset-catalog logs, and assertions.
 * Regenerating the catalog updates these automatically — avoid duplicating magic numbers elsewhere.
 */
export const QWEN_HOST_UI_CONTRACT = {
	familyCount: QWEN_MODEL_FAMILIES.length,
	modelIdCount: flatQwenVersionIds.length,
	uniqueModelIdCount: uniqueQwenVersionIds.size,
	vlOpenSourceFamilyKey: qwenVlOpenSourceFamily.familyKey,
	vlOpenSourceVersionCount: qwenVlOpenSourceFamily.versionIds.length,
	vlOpenSourceDefaultVersionId: qwenVlOpenSourceFamily.defaultVersionId,
	qwen3MaxFamilyKey: qwen3MaxFamily.familyKey,
	qwen3MaxDefaultVersionId: qwen3MaxFamily.defaultVersionId
} as const;

/** Returns human-readable issue codes (empty = catalog consistent with built-in presets). */
export function validateQwenCatalogDataIntegrity(): string[] {
	const issues: string[] = [];
	if (uniqueQwenVersionIds.size !== flatQwenVersionIds.length) {
		issues.push("qwen.catalog.duplicate-version-id-across-families");
	}
	const seenFamilyKeys = new Set<string>();
	for (const family of QWEN_MODEL_FAMILIES) {
		if (seenFamilyKeys.has(family.familyKey)) {
			issues.push(`qwen.catalog.duplicate-family-key:${family.familyKey}`);
		}
		seenFamilyKeys.add(family.familyKey);
		if (!family.versionIds.includes(family.defaultVersionId)) {
			issues.push(`qwen.catalog.default-not-in-versions:${family.familyKey}`);
		}
	}
	const qwenPresetRows = BUILT_IN_PRESETS.filter((model) => model.provider === "qwen");
	if (qwenPresetRows.length !== QWEN_MODEL_FAMILIES.length) {
		issues.push("qwen.catalog.preset-row-count-mismatch");
	}
	const qwen3MaxPreset = BUILT_IN_PRESETS.find((model) => model.modelFamilyKey === "qwen3-max");
	if (!qwen3MaxPreset || qwen3MaxPreset.id !== qwen3MaxFamily.defaultVersionId) {
		issues.push("qwen.catalog.qwen3-max-preset-id-must-match-defaultVersionId");
	}
	const qwenVlPreset = BUILT_IN_PRESETS.find((model) => model.modelFamilyKey === qwenVlOpenSourceFamily.familyKey);
	if (!qwenVlPreset || qwenVlPreset.id !== qwenVlOpenSourceFamily.defaultVersionId) {
		issues.push("qwen.catalog.qwen3-vl-open-source-preset-id-must-match-defaultVersionId");
	}
	return issues;
}
