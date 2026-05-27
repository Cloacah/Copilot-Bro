import * as vscode from "vscode";
import type {
	ConfigWriteScope,
	ExtensionSettings,
	LogLevel,
	ModelConfig,
	PromptPresetSettings,
	RetrySettings,
	RequestAttributionConfig,
	VisionAgentConfig,
	VisionIntegrityConfig,
	VisionProcessingConfig,
	VisionProxySettings,
} from "../types";
import {
	DEFAULT_REQUEST_ATTRIBUTION,
	DEFAULT_VISION_AGENT,
	DEFAULT_VISION_INTEGRITY,
	DEFAULT_VISION_PROCESSING,
	getNormalizedRequestAttributionConfig as readNormalizedRequestAttributionConfig,
	getNormalizedVisionAgentConfig as readNormalizedVisionAgentConfig,
	getNormalizedVisionIntegrityConfig as readNormalizedVisionIntegrityConfig,
	getNormalizedVisionProcessingConfig as readNormalizedVisionProcessingConfig
} from "./contractConfig";
import { BUILT_IN_PRESETS, DEFAULT_CONTEXT_LENGTH, DEFAULT_MAX_OUTPUT_TOKENS } from "./presets";
import { enrichModelsWithProviderBaseUrl, normalizeProviderCustomBaseUrls } from "./providerBaseUrl";
import { normalizeProviderEndpointsConfig } from "./providerEndpoints";
export { getRuntimeModelId, isWrappedLanguageModelConfig } from "./modelIdentity";
import { getRuntimeModelId, isWrappedLanguageModelConfig } from "./modelIdentity";
import { resolveModelVisionProxyFields } from "./modelVisionProxy";
import { createMergedSectionConfigReader, readMergedScopedRecord, readMergedScopedSection, readMergedScopedValue } from "./configScope";
import { readMergedCustomModelsFromInspect } from "../ui/configPanelPersistence";
import { normalizeModelFamilyCustomVersions } from "./modelFamilySettings";

const DEFAULT_RETRY: RetrySettings = {
	enabled: true,
	maxAttempts: 3,
	baseDelayMs: 1000,
	statusCodes: []
};

const DEFAULT_VISION_PROXY: VisionProxySettings = {
	enabled: true,
	selectionMode: "auto",
	defaultModelId: "",
	customModelIds: [],
	customListMaxRetriesPerModel: 3,
	customListMaxDelayMs: 60_000,
	customPrompt: ""
};

const DEFAULT_PROMPT_PRESETS: PromptPresetSettings = {
	selectedId: ""
};

const DEFAULT_CONFIG_WRITE_SCOPE: ConfigWriteScope = "global";
export const MODEL_VISION_PROXY_DISABLED = "__vision_proxy_disabled__";

export function getSettings(): ExtensionSettings {
	return getFullConfig();
}

export function getFullConfig(): ExtensionSettings {
	const config = vscode.workspace.getConfiguration("extendedModels");
	const mergedSectionReader = createMergedSectionConfigReader(config);
	const includeBuiltInPresets = config.get<boolean>("includeBuiltInPresets", true);
	const customModels = normalizeModels(readMergedCustomModelsFromInspect(config.inspect("models")));
	const providerCustomBaseUrls = readMergedScopedRecord(config, "providerCustomBaseUrls", normalizeProviderCustomBaseUrls);
	const visionProxy = normalizeVisionProxy(readMergedScopedSection(config, "visionProxy") as Partial<VisionProxySettings>);
	const promptPresets = normalizePromptPresets(readMergedScopedSection(config, "promptPresets") as Partial<PromptPresetSettings>);
	const retry = normalizeRetry(readMergedScopedSection(config, "retry") as Partial<RetrySettings>);
	const visionAgent = readNormalizedVisionAgentConfig(mergedSectionReader);
	const visionIntegrity = readNormalizedVisionIntegrityConfig(mergedSectionReader);
	const visionProcessing = readNormalizedVisionProcessingConfig(mergedSectionReader);
	const requestAttribution = readNormalizedRequestAttributionConfig(mergedSectionReader);
	const requestTimeoutMs = Math.max(1000, config.get<number>("requestTimeoutMs", 120000));
	const logLevel = config.get<LogLevel>("logLevel", "info");
	const uiLanguage = config.get<"zh" | "en">("uiLanguage", "zh");
	const configWriteScope = normalizeConfigWriteScope(config.get<unknown>("configWriteScope", DEFAULT_CONFIG_WRITE_SCOPE));
	const providerEndpoints = readMergedScopedRecord(config, "providerEndpoints", normalizeProviderEndpointsConfig);
	const modelFamilyCustomVersions = readMergedScopedValue(config, "modelFamilyCustomVersions", normalizeModelFamilyCustomVersions);
	const builtIns = includeBuiltInPresets
		? enrichModelsWithProviderBaseUrl([...BUILT_IN_PRESETS], providerEndpoints, providerCustomBaseUrls)
		: [];
	const models = enrichModelsWithProviderBaseUrl(
		includeBuiltInPresets ? mergeModels(builtIns, customModels) : customModels,
		providerEndpoints,
		providerCustomBaseUrls
	);

	return {
		includeBuiltInPresets,
		defaultBaseUrl: "",
		providerEndpoints,
		providerCustomBaseUrls,
		modelFamilyCustomVersions,
		models,
		visionProxy,
		promptPresets,
		retry,
		requestTimeoutMs,
		logLevel,
		uiLanguage,
		configWriteScope,
		visionAgent,
		visionIntegrity,
		visionProcessing,
		requestAttribution
	};
}

export function findModelConfig(runtimeId: string, models: readonly ModelConfig[]): ModelConfig | undefined {
	return models.find((model) => getRuntimeModelId(model) === runtimeId)
		?? models.find((model) => model.id === runtimeId);
}

export function listProviders(models: readonly ModelConfig[]): string[] {
	return Array.from(
		new Set(models.map((model) => model.provider.trim().toLowerCase()).filter(Boolean))
	).sort((a, b) => a.localeCompare(b));
}

export function validateModelConfig(model: ModelConfig): string | undefined {
	if (!model.id.trim()) {
		return "Model id is required.";
	}
	if (!model.provider.trim()) {
		return `Provider is required for model ${model.id}.`;
	}
	if (isWrappedLanguageModelConfig(model)) {
		if (model.maxOutputTokens < 1) {
			return `maxOutputTokens for model ${model.id} must be greater than zero.`;
		}
		if (model.contextLength <= model.maxOutputTokens) {
			return `contextLength for model ${model.id} must be greater than maxOutputTokens.`;
		}
		return undefined;
	}
	if (!model.baseUrl?.trim()) {
		return `Provider ${model.provider} has no base URL. Set the provider gateway in model settings.`;
	}
	if (!/^https?:\/\//i.test(model.baseUrl)) {
		return `Base URL for provider ${model.provider} must start with http:// or https://.`;
	}
	if (model.maxOutputTokens < 1) {
		return `maxOutputTokens for model ${model.id} must be greater than zero.`;
	}
	if (model.contextLength <= model.maxOutputTokens) {
		return `contextLength for model ${model.id} must be greater than maxOutputTokens.`;
	}
	if (model.maxCompletionTokens !== undefined && model.contextLength <= model.maxCompletionTokens) {
		return `contextLength for model ${model.id} must be greater than maxCompletionTokens.`;
	}
	return undefined;
}

export function mergeModels(builtIn: ModelConfig[], custom: ModelConfig[]): ModelConfig[] {
	const out = new Map<string, ModelConfig>();
	for (const model of builtIn) {
		out.set(getRuntimeModelId(model), model);
	}
	for (const model of custom) {
		const key = getRuntimeModelId(model);
		const base = out.get(key);
		out.set(key, base ? { ...base, ...model, builtIn: base.builtIn } : model);
	}
	return Array.from(out.values());
}

function normalizeRetry(input: Partial<RetrySettings> | undefined): RetrySettings {
	return {
		enabled: input?.enabled ?? DEFAULT_RETRY.enabled,
		maxAttempts: Math.max(1, Number(input?.maxAttempts ?? DEFAULT_RETRY.maxAttempts)),
		baseDelayMs: Math.max(1, Number(input?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs)),
		statusCodes: Array.isArray(input?.statusCodes) ? input.statusCodes.filter((code) => Number.isFinite(code)) : []
	};
}

function normalizeModels(input: unknown[] | undefined): ModelConfig[] {
	if (!Array.isArray(input)) {
		return [];
	}

	const models: ModelConfig[] = [];
	for (const raw of input) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const record = raw as Record<string, unknown>;
		const id = asString(record.id);
		const provider = asString(record.provider || record.owned_by || record.ownedBy);
		if (!id || !provider) {
			continue;
		}

		const visionProxyFields = resolveModelVisionProxyFields({
			visionProxyScope: record.visionProxyScope,
			visionProxyFixedModelId: record.visionProxyFixedModelId,
			visionProxyCustomModelIds: record.visionProxyCustomModelIds,
			visionProxyModelId: record.visionProxyModelId ?? record.vision_proxy_model_id
		});
		models.push({
			id,
			displayName: asString(record.displayName) || undefined,
			modelFamilyKey: asString(record.modelFamilyKey) || undefined,
			configId: asString(record.configId) || undefined,
			provider,
			providerDisplayName: asString(record.providerDisplayName) || undefined,
			category: asString(record.category) || undefined,
			family: asString(record.family) || "oai-compatible",
			contextLength: asPositiveNumber(record.contextLength, DEFAULT_CONTEXT_LENGTH),
			maxOutputTokens: asPositiveNumber(record.maxOutputTokens ?? record.max_tokens, DEFAULT_MAX_OUTPUT_TOKENS),
			maxCompletionTokens: asOptionalPositiveNumber(record.maxCompletionTokens ?? record.max_completion_tokens),
			vision: asBoolean(record.vision, false),
			...visionProxyFields,
			toolCalling: asBoolean(record.toolCalling, true),
			temperature: asNullableNumber(record.temperature),
			topP: asNullableNumber(record.topP ?? record.top_p),
			reasoningEffort: asString(record.reasoningEffort ?? record.reasoning_effort) || undefined,
			thinking: normalizeThinking(record.thinking),
			headers: normalizeStringRecord(record.headers),
			extraBody: normalizeSafeObject(record.extraBody ?? record.extra),
			includeReasoningInRequest: asBoolean(record.includeReasoningInRequest ?? record.include_reasoning_in_request, false),
			editTools: normalizeStringArray(record.editTools),
			parameterHints: normalizeObject(record.parameterHints) as ModelConfig["parameterHints"],
			documentationUrl: asString(record.documentationUrl) || undefined,
			modelSource: asString(record.modelSource) === "vscode-lm-wrapper" ? "vscode-lm-wrapper" : undefined,
			wrappedLanguageModelId: asString(record.wrappedLanguageModelId ?? record.hostModelId ?? record.vscodeLmModelId) || undefined,
			wrappedLanguageModelVendor: asString(record.wrappedLanguageModelVendor ?? record.hostModelVendor ?? record.vscodeLmVendor) || undefined,
			wrappedLanguageModelFamily: asString(record.wrappedLanguageModelFamily ?? record.hostModelFamily ?? record.vscodeLmFamily) || undefined
		});
	}
	return models;
}

function normalizeVisionProxy(input: Partial<VisionProxySettings> | undefined): VisionProxySettings {
	const defaultModelId = asString(input?.defaultModelId) || DEFAULT_VISION_PROXY.defaultModelId;
	const customModelIds = normalizeVisionProxyCustomModelIds(input?.customModelIds);
	const selectionMode = normalizeVisionProxySelectionMode(input?.selectionMode, defaultModelId, customModelIds);
	return {
		enabled: input?.enabled ?? DEFAULT_VISION_PROXY.enabled,
		selectionMode,
		defaultModelId: selectionMode === "auto" ? "" : defaultModelId,
		customModelIds: selectionMode === "custom-list" ? customModelIds : [],
		customListMaxRetriesPerModel: clampNumber(
			input?.customListMaxRetriesPerModel,
			DEFAULT_VISION_PROXY.customListMaxRetriesPerModel,
			1,
			10
		),
		customListMaxDelayMs: clampNumber(
			input?.customListMaxDelayMs,
			DEFAULT_VISION_PROXY.customListMaxDelayMs,
			500,
			120_000
		),
		customPrompt: asString(input?.customPrompt) || asString((input as { prompt?: unknown })?.prompt) || DEFAULT_VISION_PROXY.customPrompt
	};
}

function normalizeVisionProxyCustomModelIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const entry of value) {
		const id = asString(entry).trim();
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		ordered.push(id);
	}
	return ordered;
}

function normalizeVisionProxySelectionMode(
	value: unknown,
	defaultModelId: string,
	customModelIds: readonly string[]
): import("../types").VisionProxyModelSelectionMode {
	if (value === "auto" || value === "fixed" || value === "custom-list") {
		return value;
	}
	if (customModelIds.length > 0) {
		return "custom-list";
	}
	if (defaultModelId.trim()) {
		return "fixed";
	}
	return "auto";
}

function normalizePromptPresets(input: Partial<PromptPresetSettings> | undefined): PromptPresetSettings {
	return {
		selectedId: asString(input?.selectedId) || DEFAULT_PROMPT_PRESETS.selectedId
	};
}

export function getNormalizedVisionAgentConfig(config = vscode.workspace.getConfiguration("extendedModels")): VisionAgentConfig {
	return readNormalizedVisionAgentConfig(createMergedSectionConfigReader(config));
}

export function getNormalizedVisionIntegrityConfig(config = vscode.workspace.getConfiguration("extendedModels")): VisionIntegrityConfig {
	return readNormalizedVisionIntegrityConfig(createMergedSectionConfigReader(config));
}

export function getNormalizedVisionProcessingConfig(config = vscode.workspace.getConfiguration("extendedModels")): VisionProcessingConfig {
	return readNormalizedVisionProcessingConfig(createMergedSectionConfigReader(config));
}

export function getNormalizedRequestAttributionConfig(config = vscode.workspace.getConfiguration("extendedModels")): RequestAttributionConfig {
	return readNormalizedRequestAttributionConfig(createMergedSectionConfigReader(config));
}

function normalizeThinking(value: unknown): { type?: "enabled" | "disabled" } | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const type = asString((value as Record<string, unknown>).type);
	if (type === "enabled" || type === "disabled") {
		return { type };
	}
	return undefined;
}

function normalizeObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function normalizeStringRecord(value: unknown): Record<string, string> {
	const object = normalizeObject(value);
	const out: Record<string, string> = {};
	for (const [key, item] of Object.entries(object)) {
		if (typeof item === "string" && !isSensitiveKey(key)) {
			out[key] = item;
		}
	}
	return out;
}

function normalizeSafeObject(value: unknown): Record<string, unknown> {
	const object = normalizeObject(value);
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(object)) {
		if (!isSensitiveKey(key)) {
			out[key] = item;
		}
	}
	return out;
}

function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return normalized.includes("authorization")
		|| normalized.includes("api-key")
		|| normalized.includes("apikey")
		|| normalized.includes("api_key")
		|| normalized.includes("token")
		|| normalized.includes("secret")
		|| normalized.includes("password")
		|| normalized === "cookie";
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeModelVisionProxyValue(value: unknown): string | null | undefined {
	if (value === null) {
		return null;
	}
	const text = asString(value);
	if (!text) {
		return undefined;
	}
	if (text === MODEL_VISION_PROXY_DISABLED || text.toLowerCase() === "null") {
		return null;
	}
	return text;
}

function normalizeConfigWriteScope(value: unknown): ConfigWriteScope {
	if (value === "global") {
		return "global";
	}
	if (value === "workspace" || value === "auto") {
		return "workspace";
	}
	return DEFAULT_CONFIG_WRITE_SCOPE;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		return fallback;
	}
	return Math.min(maximum, Math.max(minimum, numeric));
}

function asPositiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function asOptionalPositiveNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asNullableNumber(value: unknown): number | null | undefined {
	if (value === null) {
		return null;
	}
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
