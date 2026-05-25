import {
	listVersionIdsForFamily,
	modelFamilySettingsKey,
	resolveFamilyByKey,
	type ModelFamilyDefinition
} from "../config/modelFamilyCatalog";
import {
	getModelFamiliesForProvider,
	isBuiltinModelVersionId,
	listModelVersionIds,
	resolveEffectiveModelFamilyKey,
	type ModelFamilyCustomVersions
} from "../config/modelFamilySettings";
import type { ModelConfig } from "../types";

export interface ConfigPanelPresetView {
	id: string;
	configId?: string;
	runtimeId: string;
	displayName?: string;
	modelFamilyKey?: string;
	versionIds?: string[];
	builtinVersionIds?: string[];
	provider: string;
	providerDisplayName?: string;
	category?: string;
	baseUrl?: string;
	contextLength: number;
	maxOutputTokens: number;
	toolCalling: boolean;
	vision: boolean;
	visionProxyModelId?: string | null;
	temperature?: number | null;
	topP?: number | null;
	reasoningEffort?: string;
	thinking?: { type?: "enabled" | "disabled" };
	parameterHints?: ModelConfig["parameterHints"];
	documentationUrl?: string;
	editTools: string[];
	modelSource?: ModelConfig["modelSource"];
	builtIn?: boolean;
}

export function attachModelVersionIdsToPresets(
	presets: readonly ConfigPanelPresetView[],
	customVersions: ModelFamilyCustomVersions
): ConfigPanelPresetView[] {
	return presets.map((preset) => {
		const familyKey = resolveEffectiveModelFamilyKey(preset);
		const family = resolveFamilyDefinition(preset.provider, familyKey);
		const versionIds = listModelVersionIds(preset.provider, familyKey, customVersions);
		const builtinVersionIds = family
			? [...family.versionIds]
			: versionIds.filter((versionId) => isBuiltinModelVersionId(preset.provider, familyKey, versionId));
		return {
			...preset,
			modelFamilyKey: familyKey,
			builtinVersionIds,
			versionIds
		};
	});
}

export function resolveFamilyDefinition(
	provider: string,
	familyKey: string
): ModelFamilyDefinition | undefined {
	return resolveFamilyByKey(getModelFamiliesForProvider(provider), familyKey);
}

export function versionIdsForPreset(
	preset: Pick<ModelConfig, "id" | "provider" | "modelFamilyKey">,
	customVersions: ModelFamilyCustomVersions
): string[] {
	const familyKey = resolveEffectiveModelFamilyKey(preset);
	return listModelVersionIds(preset.provider, familyKey, customVersions);
}

export function familySettingsKeyForPreset(
	preset: Pick<ModelConfig, "id" | "provider" | "modelFamilyKey">
): string {
	return modelFamilySettingsKey(preset.provider, resolveEffectiveModelFamilyKey(preset));
}

export function mergePresetVersionChoice(
	preset: ModelConfig,
	versionId: string,
	customVersions: ModelFamilyCustomVersions
): ModelConfig {
	const familyKey = resolveEffectiveModelFamilyKey(preset);
	const family = resolveFamilyByKey(getModelFamiliesForProvider(preset.provider), familyKey);
	const allowed = family
		? listVersionIdsForFamily(family, customVersions[modelFamilySettingsKey(preset.provider, familyKey)] ?? [])
		: listModelVersionIds(preset.provider, familyKey, customVersions);
	const nextId = versionId.trim();
	if (!nextId || !allowed.includes(nextId)) {
		return preset;
	}
	return { ...preset, id: nextId, modelFamilyKey: family?.familyKey ?? preset.modelFamilyKey };
}
