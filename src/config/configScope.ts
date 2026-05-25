import * as vscode from "vscode";
import type { ConfigReader } from "./contractConfig";
import { getRuntimeModelId } from "./modelIdentity";
import { stripBaseUrlFromModelRecord } from "./providerBaseUrl";
import type { ModelConfig } from "../types";
import {
	buildScopedFieldWrite,
	normalizeDefaultSaveScope,
	readMergedObjectFromInspect,
	readMergedSectionFromInspect,
	readRawConfigValueAtTarget,
	resolveFieldWriteTarget,
	resolveModelRuntimeWriteTarget,
	SCOPED_CONFIG_ROOT_FIELD,
	upsertModelConfig,
	type ConfigWriteTarget,
	type DefaultSaveScope
} from "../ui/configPanelPersistence";

export type { DefaultSaveScope } from "../ui/configPanelPersistence";
export { normalizeDefaultSaveScope, SCOPED_CONFIG_ROOT_FIELD } from "../ui/configPanelPersistence";

export function hasWorkspaceFolders(): boolean {
	return Boolean(vscode.workspace.workspaceFolders?.length);
}

export function resolveConfigurationWriteTarget(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	preference: DefaultSaveScope | "auto"
): ConfigWriteTarget {
	return resolveFieldWriteTarget(
		configuration.inspect(key),
		SCOPED_CONFIG_ROOT_FIELD,
		normalizeDefaultSaveScope(preference),
		hasWorkspaceFolders()
	);
}

export function toVsCodeConfigurationTarget(
	target: import("../ui/configPanelPersistence").ConfigWriteTarget
): vscode.ConfigurationTarget {
	if (target === "workspaceFolder") {
		return vscode.ConfigurationTarget.WorkspaceFolder;
	}
	if (target === "workspace") {
		return vscode.ConfigurationTarget.Workspace;
	}
	return vscode.ConfigurationTarget.Global;
}

export function readMergedScopedRecord<T extends Record<string, string>>(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	normalize: (input: unknown) => T
): T {
	return readMergedScopedValue(configuration, key, normalize);
}

export function readMergedScopedValue<T>(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	normalize: (input: unknown) => T
): T {
	const inspect = configuration.inspect(key);
	const merged = readMergedObjectFromInspect(inspect, normalize);
	if (
		inspect?.globalValue !== undefined
		|| inspect?.workspaceValue !== undefined
		|| inspect?.workspaceFolderValue !== undefined
	) {
		return merged;
	}
	return normalize(configuration.get(key));
}

export function readMergedScopedSection(
	configuration: vscode.WorkspaceConfiguration,
	key: string
): Record<string, unknown> {
	return readMergedSectionFromInspect(configuration.inspect(key));
}

export async function writeScopedValueField<T>(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	fieldKey: string,
	fieldValue: unknown,
	defaultPreference: DefaultSaveScope | "auto",
	normalize: (input: unknown) => T
): Promise<T> {
	const scope = normalizeDefaultSaveScope(defaultPreference);
	const inspect = configuration.inspect(key);
	const { value, target } = buildScopedFieldWrite(
		inspect,
		fieldKey,
		fieldValue,
		scope,
		hasWorkspaceFolders(),
		normalize
	);
	await configuration.update(key, value, toVsCodeConfigurationTarget(target));
	return readMergedScopedValue(configuration, key, normalize);
}

/** @alias writeScopedValueField */
export const writeScopedRecordField = writeScopedValueField;

/**
 * Patches one field inside an object-shaped configuration section at the scope that owns that field.
 */
export async function writeScopedSectionField(
	configuration: vscode.WorkspaceConfiguration,
	sectionKey: string,
	fieldKey: string,
	fieldValue: unknown,
	defaultPreference: DefaultSaveScope | "auto"
): Promise<Record<string, unknown>> {
	const scope = normalizeDefaultSaveScope(defaultPreference);
	const inspect = configuration.inspect(sectionKey);
	const { value, target } = buildScopedFieldWrite(
		inspect,
		fieldKey,
		fieldValue,
		scope,
		hasWorkspaceFolders(),
		(input) => readMergedSectionFromInspect({ globalValue: input })
	);
	await configuration.update(sectionKey, value, toVsCodeConfigurationTarget(target));
	return readMergedScopedSection(configuration, sectionKey);
}

/** @deprecated Prefer {@link writeScopedSectionField} per property for consistent field ownership. */
export async function writeScopedSectionFields(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	patch: Record<string, unknown>,
	defaultPreference: DefaultSaveScope | "auto"
): Promise<Record<string, unknown>> {
	const scope = normalizeDefaultSaveScope(defaultPreference);
	let latest = readMergedScopedSection(configuration, key);
	for (const [fieldKey, fieldValue] of Object.entries(patch)) {
		latest = await writeScopedSectionField(configuration, key, fieldKey, fieldValue, scope);
	}
	return latest;
}

export async function writeScopedModelEntry(
	configuration: vscode.WorkspaceConfiguration,
	model: Partial<ModelConfig>,
	defaultPreference: DefaultSaveScope | "auto"
): Promise<ConfigWriteTarget> {
	const scope = normalizeDefaultSaveScope(defaultPreference);
	const stripped = stripBaseUrlFromModelRecord(model as Record<string, unknown>);
	const runtimeId = getRuntimeModelId(stripped as Pick<ModelConfig, "id" | "configId" | "provider">);
	const inspect = configuration.inspect("models");
	const target = resolveModelRuntimeWriteTarget(inspect, runtimeId, scope, hasWorkspaceFolders());
	const currentRaw = readRawConfigValueAtTarget(inspect, target);
	const current = Array.isArray(currentRaw) ? currentRaw : [];
	const next = upsertModelConfig(current, stripped as Partial<ModelConfig>);
	await configuration.update("models", next, toVsCodeConfigurationTarget(target));
	return target;
}

export async function writeScopedRootValue<T>(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	value: T,
	defaultPreference: DefaultSaveScope | "auto",
	normalize: (input: unknown) => T
): Promise<T> {
	return writeScopedRecordField(
		configuration,
		key,
		SCOPED_CONFIG_ROOT_FIELD,
		value,
		defaultPreference,
		normalize
	);
}

export function resolveScopedFieldWriteTarget(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	fieldKey: string,
	defaultPreference: DefaultSaveScope | "auto"
): import("../ui/configPanelPersistence").ConfigWriteTarget {
	return resolveFieldWriteTarget(
		configuration.inspect(key),
		fieldKey,
		normalizeDefaultSaveScope(defaultPreference),
		hasWorkspaceFolders()
	);
}

/** @deprecated Use writeScopedRootValue. */
export async function writeScopedArrayAtWriteTarget<T>(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	defaultPreference: DefaultSaveScope | "auto",
	value: T,
	normalize: (input: unknown) => T
): Promise<{ value: T; target: import("../ui/configPanelPersistence").ConfigWriteTarget }> {
	const scope = normalizeDefaultSaveScope(defaultPreference);
	const inspect = configuration.inspect(key);
	const built = buildScopedFieldWrite(
		inspect,
		SCOPED_CONFIG_ROOT_FIELD,
		value,
		scope,
		hasWorkspaceFolders(),
		normalize
	);
	await configuration.update(key, built.value, toVsCodeConfigurationTarget(built.target));
	return built;
}

/** ConfigReader that shallow-merges fields across configuration scopes (same as effective read). */
export function createMergedSectionConfigReader(configuration: vscode.WorkspaceConfiguration): ConfigReader {
	return {
		get<T>(section: string, defaultValue?: T): T {
			const inspect = configuration.inspect(section);
			if (
				inspect?.globalValue !== undefined
				|| inspect?.workspaceValue !== undefined
				|| inspect?.workspaceFolderValue !== undefined
			) {
				const merged = readMergedScopedSection(configuration, section);
				if (Object.keys(merged).length > 0) {
					return merged as T;
				}
			}
			return configuration.get<T>(section, defaultValue as T);
		}
	};
}
