/**
 * Model families: one stable picker entry per family, many API version ids per family.
 * Sources: uploads/compatibility-of-openai-with-dashscope-6.md,
 * uploads/qwen-vl-compatible-with-openai-5.md (2026-04 snapshot from Alibaba Model Studio).
 */

import type { ModelConfig, ModelParameterHints } from "../types";
import { DEFAULT_CONTEXT_LENGTH, DEFAULT_MAX_OUTPUT_TOKENS } from "./presets";

const EDIT_TOOLS = ["apply-patch", "multi-find-replace", "find-replace"];

export interface ProviderSeed {
	readonly provider: string;
	readonly providerDisplayName: string;
	readonly baseUrl: string;
	readonly documentationUrl: string;
	readonly hints: ModelParameterHints;
}

export interface ModelFamilyDefinition {
	/** Stable key within provider, e.g. qwen-max */
	readonly familyKey: string;
	readonly displayName: string;
	readonly category: string;
	readonly defaultVersionId: string;
	readonly versionIds: readonly string[];
	readonly contextLength?: number;
	readonly maxOutputTokens?: number;
	readonly vision?: boolean;
	readonly visionProxyModelId?: string | null;
	readonly temperature?: number | null;
	readonly topP?: number | null;
	readonly reasoningEffort?: string;
	readonly thinking?: "enabled" | "disabled";
	readonly extraBody?: Record<string, unknown>;
}

export function modelFamilySettingsKey(provider: string, familyKey: string): string {
	return `${normalizeProviderKey(provider)}::${familyKey.trim()}`;
}

export function normalizeProviderKey(provider: string): string {
	return provider.trim().toLowerCase();
}

export function listVersionIdsForFamily(
	family: ModelFamilyDefinition,
	customVersionIds: readonly string[] = []
): string[] {
	const builtin = new Set(family.versionIds.map((id) => id.trim()).filter(Boolean));
	const ordered = [...family.versionIds];
	for (const custom of customVersionIds) {
		const id = custom.trim();
		if (id && !builtin.has(id)) {
			ordered.push(id);
			builtin.add(id);
		}
	}
	return ordered;
}

export function resolveFamilyByKey(
	families: readonly ModelFamilyDefinition[],
	familyKey: string
): ModelFamilyDefinition | undefined {
	const key = familyKey.trim();
	return families.find((family) => family.familyKey === key);
}

export function createModelFromFamily(provider: ProviderSeed, family: ModelFamilyDefinition): ModelConfig {
	const hints = provider.hints;
	const thinkingType = family.thinking ?? hints.thinking?.recommended;
	return {
		id: family.defaultVersionId,
		displayName: family.displayName,
		modelFamilyKey: family.familyKey,
		provider: provider.provider,
		providerDisplayName: provider.providerDisplayName,
		category: family.category,
		baseUrl: provider.baseUrl,
		family: "oai-compatible",
		contextLength: family.contextLength ?? DEFAULT_CONTEXT_LENGTH,
		maxOutputTokens: family.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
		vision: family.vision ?? false,
		visionProxyModelId: family.vision === true ? (family.visionProxyModelId ?? null) : family.visionProxyModelId,
		toolCalling: true,
		temperature: family.temperature ?? hints.temperature?.recommended,
		topP: family.topP ?? hints.topP?.recommended,
		reasoningEffort: family.reasoningEffort ?? hints.reasoningEffort?.recommended,
		thinking: thinkingType ? { type: thinkingType as "enabled" | "disabled" } : undefined,
		headers: {},
		extraBody: family.extraBody ?? {},
		includeReasoningInRequest: false,
		editTools: [...EDIT_TOOLS],
		parameterHints: hints,
		documentationUrl: provider.documentationUrl,
		builtIn: true
	};
}

export function modelFamilyCatalogForClient(
	families: readonly ModelFamilyDefinition[]
): readonly { familyKey: string; displayName: string; category: string; versionIds: string[] }[] {
	return families.map((family) => ({
		familyKey: family.familyKey,
		displayName: family.displayName,
		category: family.category,
		versionIds: [...family.versionIds]
	}));
}
