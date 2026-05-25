import {
	listVersionIdsForFamily,
	modelFamilySettingsKey,
	normalizeProviderKey,
	resolveFamilyByKey,
	type ModelFamilyDefinition
} from "./modelFamilyCatalog";
import { KIMI_MODEL_FAMILIES } from "./kimiModelFamilies";
import { QWEN_MODEL_FAMILIES } from "./qwenModelFamilies";

export type ModelFamilyCustomVersions = Record<string, string[]>;

/** Implicit per-model family when no catalog family exists (generic version picker). */
export const IMPLICIT_MODEL_FAMILY_PREFIX = "id:";

export function implicitModelFamilyKey(modelId: string): string {
	return `${IMPLICIT_MODEL_FAMILY_PREFIX}${modelId.trim()}`;
}

export function isImplicitModelFamilyKey(familyKey: string): boolean {
	return familyKey.trim().startsWith(IMPLICIT_MODEL_FAMILY_PREFIX);
}

export function resolveEffectiveModelFamilyKey(model: {
	id: string;
	modelFamilyKey?: string;
}): string {
	const explicit = model.modelFamilyKey?.trim();
	if (explicit) {
		return explicit;
	}
	return implicitModelFamilyKey(model.id);
}

export function normalizeModelFamilyCustomVersions(input: unknown): ModelFamilyCustomVersions {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}
	const out: ModelFamilyCustomVersions = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		const normalizedKey = key.trim();
		if (!normalizedKey) {
			continue;
		}
		if (!Array.isArray(value)) {
			continue;
		}
		const ids = value
			.filter((entry): entry is string => typeof entry === "string")
			.map((entry) => entry.trim())
			.filter(Boolean);
		if (ids.length > 0) {
			out[normalizedKey] = Array.from(new Set(ids));
		}
	}
	return out;
}

export function getModelFamiliesForProvider(provider: string): readonly ModelFamilyDefinition[] {
	const key = normalizeProviderKey(provider);
	if (key === "qwen") {
		return QWEN_MODEL_FAMILIES;
	}
	if (key === "kimi" || key === "moonshot") {
		return KIMI_MODEL_FAMILIES;
	}
	return [];
}

function resolveCatalogFamily(
	provider: string,
	familyKey: string
): ModelFamilyDefinition | undefined {
	return resolveFamilyByKey(getModelFamiliesForProvider(provider), familyKey);
}

function implicitBaseVersionId(familyKey: string): string {
	return isImplicitModelFamilyKey(familyKey)
		? familyKey.slice(IMPLICIT_MODEL_FAMILY_PREFIX.length)
		: familyKey;
}

export function listModelVersionIds(
	provider: string,
	familyKey: string,
	customVersions: ModelFamilyCustomVersions
): string[] {
	const family = resolveCatalogFamily(provider, familyKey);
	const settingsKey = modelFamilySettingsKey(provider, familyKey);
	if (family) {
		return listVersionIdsForFamily(family, customVersions[settingsKey] ?? []);
	}
	const baseId = implicitBaseVersionId(familyKey);
	const ordered = [baseId];
	const builtin = new Set(ordered);
	for (const custom of customVersions[settingsKey] ?? []) {
		const id = custom.trim();
		if (id && !builtin.has(id)) {
			ordered.push(id);
			builtin.add(id);
		}
	}
	return ordered;
}

export function isBuiltinModelVersionId(
	provider: string,
	familyKey: string,
	versionId: string
): boolean {
	const family = resolveCatalogFamily(provider, familyKey);
	if (family) {
		return family.versionIds.includes(versionId.trim());
	}
	return versionId.trim() === implicitBaseVersionId(familyKey);
}

export function addCustomModelVersionId(
	customVersions: ModelFamilyCustomVersions,
	provider: string,
	familyKey: string,
	versionId: string
): ModelFamilyCustomVersions {
	const id = versionId.trim();
	if (!id) {
		return customVersions;
	}
	const settingsKey = modelFamilySettingsKey(provider, familyKey);
	const existing = customVersions[settingsKey] ?? [];
	if (existing.includes(id) || isBuiltinModelVersionId(provider, familyKey, id)) {
		return customVersions;
	}
	return {
		...customVersions,
		[settingsKey]: [...existing, id]
	};
}

export function removeCustomModelVersionId(
	customVersions: ModelFamilyCustomVersions,
	provider: string,
	familyKey: string,
	versionId: string
): ModelFamilyCustomVersions {
	const id = versionId.trim();
	const settingsKey = modelFamilySettingsKey(provider, familyKey);
	const existing = customVersions[settingsKey];
	if (!existing?.length || !id) {
		return customVersions;
	}
	const next = existing.filter((entry) => entry !== id);
	const out = { ...customVersions };
	if (next.length > 0) {
		out[settingsKey] = next;
	} else {
		delete out[settingsKey];
	}
	return out;
}
