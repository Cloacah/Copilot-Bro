import { getRuntimeModelId } from "../config/modelIdentity";
import type { ModelConfig } from "../types";

export type ConfigWriteTarget = "workspaceFolder" | "workspace" | "global";
/** Default save scope for settings fields that are not yet defined at any layer. */
export type DefaultSaveScope = "workspace" | "global";
/** @deprecated Use DefaultSaveScope; kept for call-site compatibility during migration. */
export type ConfigWritePreference = DefaultSaveScope | "auto";

export const SCOPED_CONFIG_ROOT_FIELD = "__root__";

export interface ModelsConfigInspect {
	workspaceFolderValue?: unknown;
	workspaceValue?: unknown;
	globalValue?: unknown;
}

/** Same order as {@link readMergedObjectFromInspect} (later entries override earlier). */
const SCOPE_MERGE_ORDER_LOW_TO_HIGH: readonly ConfigWriteTarget[] = [
	"global",
	"workspace",
	"workspaceFolder"
];

export function normalizeDefaultSaveScope(value: unknown): DefaultSaveScope {
	if (value === "global") {
		return "global";
	}
	if (value === "workspace" || value === "auto") {
		return "workspace";
	}
	/** Missing / invalid → align with product default (User settings), not VS Code workspace file. */
	return "global";
}

export function resolveDefaultSaveTarget(
	preference: DefaultSaveScope,
	hasWorkspaceFolders: boolean
): ConfigWriteTarget {
	if (preference === "global") {
		return "global";
	}
	// "workspace" preference maps to VS Code Workspace scope, not WorkspaceFolder.
	return hasWorkspaceFolders ? "workspace" : "global";
}

function asPlainRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return { ...(value as Record<string, unknown>) };
}

/** Whether a whole configuration key (object section or array root) is materially defined at this layer. */
export function scopeLayerDefinesRootField(layerValue: unknown): boolean {
	if (layerValue === undefined) {
		return false;
	}
	if (Array.isArray(layerValue)) {
		return layerValue.length > 0;
	}
	if (layerValue && typeof layerValue === "object") {
		return Object.keys(layerValue as Record<string, unknown>).length > 0;
	}
	return true;
}

export function scopeLayerDefinesField(layerValue: unknown, fieldKey: string): boolean {
	if (fieldKey === SCOPED_CONFIG_ROOT_FIELD) {
		return scopeLayerDefinesRootField(layerValue);
	}
	if (!layerValue || typeof layerValue !== "object" || Array.isArray(layerValue)) {
		return false;
	}
	return Object.prototype.hasOwnProperty.call(layerValue, fieldKey);
}

function layerDefinesScopedField(layerValue: unknown, fieldKey: string): boolean {
	if (fieldKey === SCOPED_CONFIG_ROOT_FIELD) {
		return scopeLayerDefinesRootField(layerValue);
	}
	return scopeLayerDefinesField(layerValue, fieldKey);
}

/**
 * Read/write ownership for one field: the layer that supplies the effective merged value
 * (same priority as read merge: folder > workspace > global), otherwise default save scope.
 */
export function resolveFieldWriteTarget(
	inspect: ModelsConfigInspect | undefined,
	fieldKey: string,
	defaultPreference: DefaultSaveScope,
	hasWorkspaceFolders: boolean
): ConfigWriteTarget {
	let owner: ConfigWriteTarget | undefined;
	for (const target of SCOPE_MERGE_ORDER_LOW_TO_HIGH) {
		const layerValue = readRawConfigValueAtTarget(inspect, target);
		if (layerDefinesScopedField(layerValue, fieldKey)) {
			owner = target;
		}
	}
	return owner ?? resolveDefaultSaveTarget(defaultPreference, hasWorkspaceFolders);
}

/** @deprecated Use resolveFieldWriteTarget with SCOPED_CONFIG_ROOT_FIELD. */
export function resolveConfigWriteTarget(
	preference: ConfigWritePreference,
	inspect: ModelsConfigInspect | undefined,
	hasWorkspaceFolders: boolean
): ConfigWriteTarget {
	return resolveFieldWriteTarget(
		inspect,
		SCOPED_CONFIG_ROOT_FIELD,
		normalizeDefaultSaveScope(preference),
		hasWorkspaceFolders
	);
}

export function resolveModelsConfigWriteTarget(
	inspect: ModelsConfigInspect | undefined,
	hasWorkspaceFolders: boolean,
	defaultPreference: DefaultSaveScope = "global"
): ConfigWriteTarget {
	return resolveFieldWriteTarget(inspect, SCOPED_CONFIG_ROOT_FIELD, defaultPreference, hasWorkspaceFolders);
}

export function readRawConfigValueAtTarget(
	inspect: ModelsConfigInspect | undefined,
	target: ConfigWriteTarget
): unknown {
	if (target === "workspaceFolder") {
		return inspect?.workspaceFolderValue;
	}
	if (target === "workspace") {
		return inspect?.workspaceValue;
	}
	return inspect?.globalValue;
}

function asModelArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Best-effort runtime id for a raw settings entry (same rules as {@link getRuntimeModelId}). */
export function tryGetRuntimeModelIdFromRaw(item: unknown): string | undefined {
	if (!item || typeof item !== "object" || Array.isArray(item)) {
		return undefined;
	}
	const record = item as Partial<ModelConfig>;
	if (!record.id || !record.provider) {
		return undefined;
	}
	return getRuntimeModelId(record as Pick<ModelConfig, "id" | "configId" | "provider">);
}

/** True if this layer's `models` array contains an entry with the given runtime id. */
export function scopeLayerModelsArrayContainsRuntimeId(layerValue: unknown, runtimeId: string): boolean {
	for (const item of asModelArray(layerValue)) {
		if (tryGetRuntimeModelIdFromRaw(item) === runtimeId) {
			return true;
		}
	}
	return false;
}

/**
 * Effective `extendedModels.models` custom list: same priority as object-field merge
 * (global → workspace → workspaceFolder), but entries are keyed by runtime model id.
 */
export function readMergedCustomModelsFromInspect(inspect: ModelsConfigInspect | undefined): unknown[] {
	if (
		inspect?.globalValue === undefined
		&& inspect?.workspaceValue === undefined
		&& inspect?.workspaceFolderValue === undefined
	) {
		return [];
	}
	const byRuntimeId = new Map<string, unknown>();
	for (const item of asModelArray(inspect?.globalValue)) {
		const rid = tryGetRuntimeModelIdFromRaw(item);
		if (rid) {
			byRuntimeId.set(rid, item);
		}
	}
	for (const item of asModelArray(inspect?.workspaceValue)) {
		const rid = tryGetRuntimeModelIdFromRaw(item);
		if (rid) {
			byRuntimeId.set(rid, item);
		}
	}
	for (const item of asModelArray(inspect?.workspaceFolderValue)) {
		const rid = tryGetRuntimeModelIdFromRaw(item);
		if (rid) {
			byRuntimeId.set(rid, item);
		}
	}
	return Array.from(byRuntimeId.values());
}

/**
 * Where to read/write one custom model row: the layer that supplies the effective merged
 * entry for this runtime id (same priority as {@link readMergedCustomModelsFromInspect}),
 * otherwise {@link resolveDefaultSaveTarget}.
 */
export function resolveModelRuntimeWriteTarget(
	inspect: ModelsConfigInspect | undefined,
	runtimeId: string,
	defaultPreference: DefaultSaveScope,
	hasWorkspaceFolders: boolean
): ConfigWriteTarget {
	let owner: ConfigWriteTarget | undefined;
	for (const target of SCOPE_MERGE_ORDER_LOW_TO_HIGH) {
		const layerValue = readRawConfigValueAtTarget(inspect, target);
		if (scopeLayerModelsArrayContainsRuntimeId(layerValue, runtimeId)) {
			owner = target;
		}
	}
	return owner ?? resolveDefaultSaveTarget(defaultPreference, hasWorkspaceFolders);
}

/** Effective read: shallow-merge fields global → workspace → workspaceFolder (later wins). */
export function readMergedObjectFromInspect<T>(
	inspect: ModelsConfigInspect | undefined,
	normalize: (input: unknown) => T
): T {
	if (
		inspect?.globalValue === undefined
		&& inspect?.workspaceValue === undefined
		&& inspect?.workspaceFolderValue === undefined
	) {
		return normalize(undefined);
	}
	return normalize({
		...asPlainRecord(inspect?.globalValue),
		...asPlainRecord(inspect?.workspaceValue),
		...asPlainRecord(inspect?.workspaceFolderValue)
	});
}

export function readMergedSectionFromInspect(inspect: ModelsConfigInspect | undefined): Record<string, unknown> {
	return readMergedObjectFromInspect(inspect, (input) => asPlainRecord(input));
}

export function buildScopedFieldWrite<T>(
	inspect: ModelsConfigInspect | undefined,
	fieldKey: string,
	fieldValue: unknown,
	defaultPreference: DefaultSaveScope,
	hasWorkspaceFolders: boolean,
	normalize: (input: unknown) => T
): { value: T; target: ConfigWriteTarget } {
	const target = resolveFieldWriteTarget(inspect, fieldKey, defaultPreference, hasWorkspaceFolders);
	const layerRecord = asPlainRecord(readRawConfigValueAtTarget(inspect, target));
	let nextRecord: Record<string, unknown>;
	if (fieldKey === SCOPED_CONFIG_ROOT_FIELD) {
		nextRecord = asPlainRecord(fieldValue);
	} else if (fieldValue === undefined) {
		nextRecord = { ...layerRecord };
		delete nextRecord[fieldKey];
	} else {
		nextRecord = { ...layerRecord, [fieldKey]: fieldValue };
	}
	return {
		value: normalize(nextRecord),
		target
	};
}

export function buildScopedSectionPatch(
	inspect: ModelsConfigInspect | undefined,
	patch: Record<string, unknown>,
	defaultPreference: DefaultSaveScope,
	hasWorkspaceFolders: boolean
): { value: Record<string, unknown>; target: ConfigWriteTarget } {
	return buildScopedFieldWrite(
		inspect,
		SCOPED_CONFIG_ROOT_FIELD,
		patch,
		defaultPreference,
		hasWorkspaceFolders,
		(input) => asPlainRecord(input)
	);
}

export function upsertModelConfig(current: unknown[], model: Partial<ModelConfig>): unknown[] {
	const targetId = getRuntimeModelId(model as Pick<ModelConfig, "id" | "configId" | "provider">);
	const next = current.filter((item) => {
		if (!item || typeof item !== "object") {
			return true;
		}
		const candidate = item as Partial<ModelConfig>;
		if (!candidate.id || !candidate.provider) {
			return true;
		}
		return getRuntimeModelId(candidate as Pick<ModelConfig, "id" | "configId" | "provider">) !== targetId;
	});
	next.push(model);
	return next;
}
