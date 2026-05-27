import type { ExtensionSettings, ModelConfig, VisionProxyModelSelectionMode } from "../types";

const MODEL_VISION_PROXY_DISABLED = "__vision_proxy_disabled__";

export type ModelVisionProxyScope = "inherit" | "disabled" | "auto" | "fixed" | "custom-list";

export interface EffectiveModelVisionProxySelection {
	scope: ModelVisionProxyScope;
	selectionMode: VisionProxyModelSelectionMode;
	fixedModelId: string;
	customModelIds: readonly string[];
	enabled: boolean;
	source: "inherit" | "model" | "disabled";
}

export function normalizeModelVisionProxyScope(value: unknown): ModelVisionProxyScope | undefined {
	if (
		value === "inherit"
		|| value === "disabled"
		|| value === "auto"
		|| value === "fixed"
		|| value === "custom-list"
	) {
		return value;
	}
	return undefined;
}

export function normalizeModelVisionProxyCustomModelIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const entry of value) {
		const id = typeof entry === "string" ? entry.trim() : "";
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		ordered.push(id);
	}
	return ordered;
}

/** Legacy + explicit scope → normalized model vision proxy fields. */
export function resolveModelVisionProxyFields(record: {
	visionProxyScope?: unknown;
	visionProxyFixedModelId?: unknown;
	visionProxyCustomModelIds?: unknown;
	visionProxyModelId?: unknown;
}): Pick<ModelConfig, "visionProxyScope" | "visionProxyFixedModelId" | "visionProxyCustomModelIds" | "visionProxyModelId"> {
	const explicitScope = normalizeModelVisionProxyScope(record.visionProxyScope);
	const legacy = normalizeLegacyVisionProxyModelId(record.visionProxyModelId);
	const fixedFromRecord = typeof record.visionProxyFixedModelId === "string" ? record.visionProxyFixedModelId.trim() : "";
	const customModelIds = normalizeModelVisionProxyCustomModelIds(record.visionProxyCustomModelIds);

	let scope: ModelVisionProxyScope;
	if (explicitScope) {
		scope = explicitScope;
	} else if (legacy.kind === "disabled") {
		scope = "disabled";
	} else if (legacy.kind === "fixed") {
		scope = "fixed";
	} else {
		scope = "inherit";
	}

	const visionProxyFixedModelId = scope === "fixed"
		? (fixedFromRecord || (legacy.kind === "fixed" ? legacy.value : "") || "")
		: "";
	const visionProxyCustomModelIds = scope === "custom-list" ? customModelIds : [];

	let visionProxyModelId: string | null | undefined;
	if (scope === "disabled") {
		visionProxyModelId = null;
	} else if (scope === "fixed") {
		visionProxyModelId = visionProxyFixedModelId || undefined;
	} else if (scope === "custom-list") {
		visionProxyModelId = visionProxyCustomModelIds[0] || undefined;
	} else if (scope === "auto") {
		visionProxyModelId = undefined;
	} else {
		visionProxyModelId = undefined;
	}

	return {
		visionProxyScope: scope,
		visionProxyFixedModelId,
		visionProxyCustomModelIds,
		visionProxyModelId
	};
}

export function resolveEffectiveModelVisionProxySelection(
	model: ModelConfig,
	settings: Pick<ExtensionSettings, "visionProxy">
): EffectiveModelVisionProxySelection {
	const scope = model.visionProxyScope ?? inferScopeFromLegacy(model.visionProxyModelId);
	if (scope === "disabled") {
		return {
			scope,
			selectionMode: "auto",
			fixedModelId: "",
			customModelIds: [],
			enabled: false,
			source: "disabled"
		};
	}
	if (scope === "inherit") {
		const global = settings.visionProxy;
		return {
			scope,
			selectionMode: global.selectionMode,
			fixedModelId: global.defaultModelId,
			customModelIds: global.customModelIds,
			enabled: global.enabled,
			source: "inherit"
		};
	}
	const selectionMode = scope === "custom-list" ? "custom-list" : scope === "fixed" ? "fixed" : "auto";
	const enabled = scope === "auto" ? !model.vision : true;
	return {
		scope,
		selectionMode,
		fixedModelId: scope === "fixed" ? (model.visionProxyFixedModelId || asLegacyFixedId(model.visionProxyModelId)) : "",
		customModelIds: scope === "custom-list" ? model.visionProxyCustomModelIds ?? [] : [],
		enabled,
		source: "model"
	};
}

function inferScopeFromLegacy(visionProxyModelId: string | null | undefined): ModelVisionProxyScope {
	const legacy = normalizeLegacyVisionProxyModelId(visionProxyModelId);
	if (legacy.kind === "disabled") {
		return "disabled";
	}
	if (legacy.kind === "fixed") {
		return "fixed";
	}
	return "inherit";
}

function asLegacyFixedId(visionProxyModelId: string | null | undefined): string {
	const legacy = normalizeLegacyVisionProxyModelId(visionProxyModelId);
	return legacy.kind === "fixed" ? legacy.value ?? "" : "";
}

function normalizeLegacyVisionProxyModelId(value: unknown): { kind: "disabled" } | { kind: "inherit" } | { kind: "fixed"; value: string } {
	if (value === null) {
		return { kind: "disabled" };
	}
	if (typeof value !== "string") {
		return { kind: "inherit" };
	}
	const normalized = value.trim();
	if (!normalized || normalized.toLowerCase() === "auto") {
		return { kind: "inherit" };
	}
	if (normalized.toLowerCase() === "null" || normalized === MODEL_VISION_PROXY_DISABLED) {
		return { kind: "disabled" };
	}
	return { kind: "fixed", value: normalized };
}
