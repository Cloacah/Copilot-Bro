import * as vscode from "vscode";
import process from "node:process";
import {
	CUSTOM_ENDPOINT_PROFILE_ID,
	mergeProviderEndpointsPreference,
	normalizeProviderEndpointsConfig,
	providerEndpointCatalogForClient,
	resolveProviderEndpointBaseUrl,
	resolveStoredProviderEndpointProfileId
} from "../config/providerEndpoints";
import {
	hasWorkspaceFolders,
	normalizeDefaultSaveScope,
	readMergedScopedRecord,
	readMergedScopedSection,
	readMergedScopedValue,
	toVsCodeConfigurationTarget,
	writeScopedModelEntry,
	writeScopedSectionField,
	writeScopedValueField
} from "../config/configScope";
import {
	readRawConfigValueAtTarget,
	resolveFieldWriteTarget,
	resolveModelRuntimeWriteTarget,
	upsertModelConfig
} from "./configPanelPersistence";
import { modelFamilySettingsKey } from "../config/modelFamilyCatalog";
import { normalizeProviderCustomBaseUrls, stripBaseUrlFromModelRecord } from "../config/providerBaseUrl";
import { getSettings, MODEL_VISION_PROXY_DISABLED } from "../config/settings";
import { isHostUiSmokeMode } from "../smokeModeGate";
import { getRuntimeModelId, listProviders } from "../config/settings";
import { getSelectedPromptPresetId, listPromptPresets } from "../promptPresets";
import { providerSecretKey } from "../secrets";
import type { ModelConfig } from "../types";
import { getCachedWrappedLanguageModelConfigs, refreshWrappedLanguageModelConfigs } from "../vscodeLmWrapper";
import {
	addCustomModelVersionId,
	listModelVersionIds,
	normalizeModelFamilyCustomVersions,
	removeCustomModelVersionId
} from "../config/modelFamilySettings";
import { normalizeEditorSelection, resolveInitialEditorSelection, selectionFromModel } from "./editorSelection";
import { QWEN_HOST_UI_CONTRACT } from "../config/qwenCatalogContract";
import { attachModelVersionIdsToPresets } from "./modelFamilyUi";
import { renderPhase1Field, renderProviderOptions, resolveConfigPanelLanguage } from "./configPanelShared";
import {
	getPhase1SectionSpec,
	getPhase1SectionValue,
	getVisiblePhase1Sections,
	sanitizePhase1SectionValue,
	type Phase1ConfigSectionKey
} from "./phase1ConfigUi";
import { CONFIG_PANEL_POST_COMMANDS_REQUIRING_CONFIG_WRITE_SCOPE } from "./configPanelWriteScopePostCommands";
import {
	emptyHostUiSmokeModelState,
	parseHostUiSmokeConfigResult,
	type HostUiSmokeConfigResult
} from "./hostUiSmokeConfigResult";

export type {
	HostUiSmokeConfigResult,
	HostUiSmokeModelState,
	HostUiSmokeModelVersionUiResult,
	HostUiSmokeProviderEndpointUiResult,
	HostUiSmokeQwenCatalogUiResult
} from "./hostUiSmokeConfigResult";

const CONFIG_PANEL_SELECTION_KEY = "extendedModels.configPanel.selection";
const HOST_UI_SMOKE_PRIMARY_MODEL_RUNTIME_ID = "deepseek-v4-flash::deepseek";
const HOST_UI_SMOKE_SECONDARY_MODEL_RUNTIME_ID = "deepseek-v4-pro::deepseek";
const HOST_UI_SMOKE_TARGET_TEMPERATURE = "1.4";
const HOST_UI_SMOKE_ORIGINAL_TEMPERATURE = "1";

export class ConfigPanel {
	static async open(context: vscode.ExtensionContext): Promise<HostUiSmokeConfigResult | undefined> {
		const panel = vscode.window.createWebviewPanel(
			"extendedModelsConfig",
			"Copilot Bro Model Settings",
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		let resolveHostUiSmokeReady: (() => void) | undefined;
		let resolveHostUiSmokeResult: ((result: HostUiSmokeConfigResult) => void) | undefined;

		const rerender = async (): Promise<void> => {
			try {
				panel.webview.html = await renderHtml(panel.webview, context);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				panel.webview.html = renderErrorHtml(message);
				vscode.window.showErrorMessage(`Copilot Bro Model Settings failed to load: ${message}`);
			}
		};

		panel.onDidDispose(() => {
			resolveHostUiSmokeReady?.();
			resolveHostUiSmokeResult?.({
				ok: false,
				initial: emptyHostUiSmokeModelState(),
				afterSave: emptyHostUiSmokeModelState(),
				proState: emptyHostUiSmokeModelState(),
				roundtrip: emptyHostUiSmokeModelState(),
				restored: emptyHostUiSmokeModelState(),
				error: "Config panel closed before host UI smoke finished."
			});
			resolveHostUiSmokeReady = undefined;
			resolveHostUiSmokeResult = undefined;
		});

		panel.webview.html = renderLoadingHtml();
		panel.webview.onDidReceiveMessage(async (message: unknown) => {
			try {
			if (!message || typeof message !== "object") {
				return;
			}
			const payload = message as Record<string, unknown>;
			const command = payload.command;
			if (command === "hostUiSmokeReady") {
				resolveHostUiSmokeReady?.();
				resolveHostUiSmokeReady = undefined;
				return;
			}
			if (command === "hostUiSmokeResult") {
				resolveHostUiSmokeResult?.(parseHostUiSmokeConfigResult(payload.result));
				resolveHostUiSmokeResult = undefined;
				return;
			}
			if (command === "rememberEditorSelection") {
				await rememberEditorSelection(context, payload.selection);
				return;
			}
			if (command === "setProviderEndpoint") {
				const requestId = (message as { requestId?: unknown }).requestId;
				const hostUiSmoke = (message as { hostUiSmoke?: unknown }).hostUiSmoke === true;
				const endpointSaveSeq = (message as { endpointSaveSeq?: unknown }).endpointSaveSeq;
				await setProviderEndpoint(
					payload.provider,
					payload.profileId,
					payload.baseUrl,
					payload.configWriteScope
				);
				const configuration = vscode.workspace.getConfiguration("extendedModels");
				const persisted = readMergedScopedRecord(
					configuration,
					"providerEndpoints",
					normalizeProviderEndpointsConfig
				);
				const providerName = typeof payload.provider === "string" ? payload.provider : "";
				const requestedProfileId = typeof payload.profileId === "string" ? payload.profileId.trim() : "";
				const savedProfileId = requestedProfileId
					|| resolveStoredProviderEndpointProfileId(providerName, persisted)
					|| "";
				if (hostUiSmoke && isHostUiSmokeMode()) {
					await panel.webview.postMessage({
						command: "providerEndpointSaved",
						requestId,
						profileId: savedProfileId,
						endpointSaveSeq
					});
				} else {
					await panel.webview.postMessage({
						command: "providerEndpointSaved",
						provider: providerName,
						profileId: savedProfileId,
						providerEndpoints: persisted,
						providerCustomBaseUrls: readMergedScopedRecord(
							configuration,
							"providerCustomBaseUrls",
							normalizeProviderCustomBaseUrls
						),
						endpointSaveSeq
					});
				}
				return;
			}
			if (command === "hostUiSmokeSaveModel") {
				const model = (message as { model?: unknown }).model;
				const requestId = (message as { requestId?: unknown }).requestId;
				try {
					await withTimeout(
						(async () => {
							await saveModel(model, payload.configWriteScope);
							await rememberEditorSelection(context, selectionFromModel(model));
						})(),
						40_000,
						"hostUiSmokeSaveModel"
					);
					await panel.webview.postMessage({ command: "hostUiSmokeSaved", requestId });
				} catch (error) {
					const messageText = error instanceof Error ? error.message : String(error);
					await panel.webview.postMessage({ command: "panelError", message: messageText });
					vscode.window.showErrorMessage(`Copilot Bro: ${messageText}`);
					await panel.webview.postMessage({ command: "hostUiSmokeSaved", requestId, error: messageText });
				}
				return;
			}
			if (command !== "setProviderEndpoint") {
				await rememberEditorSelection(context, payload.selection);
			}
			if (command === "openSettings") {
				await vscode.commands.executeCommand("extendedModels.openScopedSettingsJson", (payload as { configWriteScope?: unknown }).configWriteScope);
			} else if (command === "addProvider") {
				const provider = typeof payload.provider === "string" ? payload.provider : "";
				await addCustomProvider(provider);
				await rerender();
			} else if (command === "deleteProvider") {
				const provider = typeof payload.provider === "string" ? payload.provider : "";
				await deleteProvider(provider);
				await rerender();
			} else if (command === "setProviderKey") {
				await vscode.commands.executeCommand("extendedModels.setProviderApiKey", payload.provider);
				await rerender();
			} else if (command === "exportModels") {
				await vscode.commands.executeCommand("extendedModels.exportModels");
			} else if (command === "importModels") {
				await vscode.commands.executeCommand("extendedModels.importModels");
			} else if (command === "showOutput") {
				await vscode.commands.executeCommand("extendedModels.showOutput");
			} else if (command === "selectPromptPreset") {
				await vscode.commands.executeCommand("extendedModels.selectPromptPreset");
				await rerender();
			} else if (command === "openPromptPresetFolder") {
				await vscode.commands.executeCommand("extendedModels.openPromptPresetFolder");
			} else if (command === "saveVisionProxyPrompt") {
				await saveVisionProxyPrompt((message as { prompt?: unknown }).prompt, payload.configWriteScope);
				await panel.webview.postMessage({ command: "savedVisionProxyPrompt" });
			} else if (command === "saveVisionProxyBase") {
				await saveVisionProxyBase((message as { visionProxy?: unknown }).visionProxy, payload.configWriteScope);
				await panel.webview.postMessage({ command: "savedVisionProxyBase" });
			} else if (command === "savePhase1Section") {
				const sectionKey = (message as { sectionKey?: unknown }).sectionKey;
				const value = (message as { value?: unknown }).value;
				const savedSection = await savePhase1Section(sectionKey, value, payload.configWriteScope);
				if (savedSection) {
					await panel.webview.postMessage({ command: "savedPhase1Section", sectionKey: savedSection });
				}
			} else if (command === "addModelFamilyVersion") {
				const provider = typeof payload.provider === "string" ? payload.provider : "";
				const familyKey = typeof payload.familyKey === "string" ? payload.familyKey : "";
				const versionId = typeof payload.versionId === "string" ? payload.versionId : "";
				const customVersions = await addModelFamilyVersionSetting(
					provider,
					familyKey,
					versionId,
					payload.configWriteScope
				);
				await panel.webview.postMessage({
					command: "modelFamilyVersionsUpdated",
					customVersions,
					provider,
					familyKey,
					versionIds: listModelVersionIds(provider, familyKey, customVersions)
				});
			} else if (command === "removeModelFamilyVersion") {
				const provider = typeof payload.provider === "string" ? payload.provider : "";
				const familyKey = typeof payload.familyKey === "string" ? payload.familyKey : "";
				const versionId = typeof payload.versionId === "string" ? payload.versionId : "";
				const customVersions = await removeModelFamilyVersionSetting(
					provider,
					familyKey,
					versionId,
					payload.configWriteScope
				);
				await panel.webview.postMessage({
					command: "modelFamilyVersionsUpdated",
					customVersions,
					provider,
					familyKey,
					versionIds: listModelVersionIds(provider, familyKey, customVersions)
				});
			} else if (command === "saveModel") {
				const model = (message as { model?: unknown }).model;
				await saveModel(model, payload.configWriteScope);
				await rememberEditorSelection(context, selectionFromModel(model));
				await panel.webview.postMessage({ command: "saved" });
			} else if (command === "deleteModel") {
				const runtimeId = typeof payload.runtimeId === "string" ? payload.runtimeId : "";
				await deleteModel(runtimeId, payload.configWriteScope);
				await rerender();
			} else if (command === "saveCustomModel") {
				const model = (message as { model?: unknown }).model;
				await saveModel(model, payload.configWriteScope);
				await rememberEditorSelection(context, selectionFromModel(model));
				await panel.webview.postMessage({ command: "saved" });
				await rerender();
			} else if (command === "setLanguage") {
				const language = (message as { language?: unknown }).language === "en" ? "en" : "zh";
				await vscode.workspace.getConfiguration("extendedModels").update("uiLanguage", language, vscode.ConfigurationTarget.Global);
				await rerender();
			} else if (command === "setConfigWriteScope") {
				const scope = normalizeConfigWritePreference((message as { configWriteScope?: unknown }).configWriteScope);
				await vscode.workspace.getConfiguration("extendedModels").update("configWriteScope", scope, vscode.ConfigurationTarget.Global);
			}
			} catch (error) {
				const messageText = error instanceof Error ? error.message : String(error);
				void panel.webview.postMessage({ command: "panelError", message: messageText });
				vscode.window.showErrorMessage(`Copilot Bro: ${messageText}`);
			}
		});

		await rerender();
		if (!isHostUiSmokeMode()) {
			return undefined;
		}

		const readyPromise = new Promise<void>((resolve) => {
			resolveHostUiSmokeReady = resolve;
		});
		const resultPromise = new Promise<HostUiSmokeConfigResult>((resolve) => {
			resolveHostUiSmokeResult = resolve;
		});

		try {
			await Promise.race([
				readyPromise,
				new Promise<void>((resolve) => setTimeout(resolve, 12_000))
			]);
			await panel.webview.postMessage({
				command: "hostUiSmokeRun",
				primaryModelRuntimeId: HOST_UI_SMOKE_PRIMARY_MODEL_RUNTIME_ID,
				secondaryModelRuntimeId: HOST_UI_SMOKE_SECONDARY_MODEL_RUNTIME_ID,
				targetTemperature: HOST_UI_SMOKE_TARGET_TEMPERATURE,
				originalTemperature: HOST_UI_SMOKE_ORIGINAL_TEMPERATURE
			});
			return await Promise.race([
				resultPromise,
				new Promise<HostUiSmokeConfigResult>((resolve) => setTimeout(() => resolve({
					ok: false,
					initial: emptyHostUiSmokeModelState(),
					afterSave: emptyHostUiSmokeModelState(),
					proState: emptyHostUiSmokeModelState(),
					roundtrip: emptyHostUiSmokeModelState(),
					restored: emptyHostUiSmokeModelState(),
					error: "Timed out waiting for host UI smoke config result."
				}), 150_000))
			]);
		} finally {
			resolveHostUiSmokeReady = undefined;
			resolveHostUiSmokeResult = undefined;
		}
	}
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
		void promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

async function rememberEditorSelection(context: vscode.ExtensionContext, value: unknown): Promise<void> {
	const selection = normalizeEditorSelection(value);
	if (!selection) {
		return;
	}
	await context.workspaceState.update(CONFIG_PANEL_SELECTION_KEY, selection);
}

function normalizeConfigWritePreference(value: unknown) {
	return normalizeDefaultSaveScope(value);
}

async function saveModel(value: unknown, scope: unknown): Promise<void> {
	if (!value || typeof value !== "object") {
		return;
	}
	const model = value as Partial<ModelConfig>;
	const isWrappedModel = model.modelSource === "vscode-lm-wrapper";
	if (isWrappedModel) {
		throw new Error("Wrapped Copilot models are read-only and cannot be modified.");
	}
	if (!model.id || !model.provider) {
		throw new Error("Model id and provider are required.");
	}
	delete model.builtIn;
	delete model.baseUrl;
	delete (model as { runtimeId?: string }).runtimeId;
	model.headers = removeSensitiveStringRecord(model.headers);
	model.extraBody = removeSensitiveObject(model.extraBody);
	const configuration = vscode.workspace.getConfiguration("extendedModels");
	const defaultScope = normalizeConfigWritePreference(scope);
	const stripped = stripBaseUrlFromModelRecord(model as Record<string, unknown>);
	await writeScopedModelEntry(configuration, stripped as Partial<ModelConfig>, defaultScope);
	if (!isHostUiSmokeMode()) {
		vscode.window.showInformationMessage(`Saved model ${model.displayName ?? model.id}. API keys remain in local SecretStorage only.`);
	}
}

async function writeModelFamilyVersionsField(
	provider: string,
	familyKey: string,
	versionIds: string[] | undefined,
	scope: unknown
): Promise<Record<string, string[]>> {
	const configuration = vscode.workspace.getConfiguration("extendedModels");
	const defaultScope = normalizeConfigWritePreference(scope);
	const fieldKey = modelFamilySettingsKey(provider, familyKey);
	return writeScopedValueField(
		configuration,
		"modelFamilyCustomVersions",
		fieldKey,
		versionIds,
		defaultScope,
		normalizeModelFamilyCustomVersions
	);
}

async function addModelFamilyVersionSetting(
	provider: string,
	familyKey: string,
	versionId: string,
	scope: unknown
): Promise<Record<string, string[]>> {
	const configuration = vscode.workspace.getConfiguration("extendedModels");
	const merged = readMergedScopedValue(
		configuration,
		"modelFamilyCustomVersions",
		normalizeModelFamilyCustomVersions
	);
	const next = addCustomModelVersionId(merged, provider, familyKey, versionId);
	const fieldKey = modelFamilySettingsKey(provider, familyKey);
	return writeModelFamilyVersionsField(provider, familyKey, next[fieldKey], scope);
}

async function removeModelFamilyVersionSetting(
	provider: string,
	familyKey: string,
	versionId: string,
	scope: unknown
): Promise<Record<string, string[]>> {
	const configuration = vscode.workspace.getConfiguration("extendedModels");
	const merged = readMergedScopedValue(
		configuration,
		"modelFamilyCustomVersions",
		normalizeModelFamilyCustomVersions
	);
	const next = removeCustomModelVersionId(merged, provider, familyKey, versionId);
	const fieldKey = modelFamilySettingsKey(provider, familyKey);
	return writeModelFamilyVersionsField(provider, familyKey, next[fieldKey], scope);
}

async function setProviderEndpoint(
	provider: unknown,
	profileId: unknown,
	baseUrl: unknown,
	scope: unknown
): Promise<void> {
	const providerName = typeof provider === "string" ? provider : "";
	const profile = typeof profileId === "string" ? profileId : "";
	if (!providerName.trim()) {
		return;
	}
	const configuration = vscode.workspace.getConfiguration("extendedModels");
	const defaultScope = normalizeConfigWritePreference(scope);
	const providerKey = providerName.trim().toLowerCase();
	const endpointsInspect = configuration.inspect("providerEndpoints");
	const endpointsTarget = resolveFieldWriteTarget(
		endpointsInspect,
		providerKey,
		defaultScope,
		hasWorkspaceFolders()
	);
	const currentEndpoints = normalizeProviderEndpointsConfig(readRawConfigValueAtTarget(endpointsInspect, endpointsTarget));
	const nextEndpoints = mergeProviderEndpointsPreference(currentEndpoints, providerName, profile);
	await configuration.update("providerEndpoints", nextEndpoints, toVsCodeConfigurationTarget(endpointsTarget));

	const customInspect = configuration.inspect("providerCustomBaseUrls");
	const customTarget = resolveFieldWriteTarget(
		customInspect,
		providerKey,
		defaultScope,
		hasWorkspaceFolders()
	);
	const currentCustom = normalizeProviderCustomBaseUrls(readRawConfigValueAtTarget(customInspect, customTarget));
	const nextCustom = { ...currentCustom };
	if (profile === CUSTOM_ENDPOINT_PROFILE_ID) {
		const customUrl = typeof baseUrl === "string" ? baseUrl.trim() : "";
		if (customUrl) {
			nextCustom[providerKey] = customUrl;
		} else {
			delete nextCustom[providerKey];
		}
	} else {
		delete nextCustom[providerKey];
	}
	await configuration.update("providerCustomBaseUrls", nextCustom, toVsCodeConfigurationTarget(customTarget));
}

async function addCustomProvider(provider: string): Promise<void> {
	const normalizedProvider = provider.trim().toLowerCase();
	if (!normalizedProvider) {
		throw new Error("Provider key is required.");
	}
	const configuration = vscode.workspace.getConfiguration("extendedModels");
	const existing = configuration.get<string[]>("customProviders", []);
	const next = Array.from(new Set([
		...existing
			.filter((item) => typeof item === "string")
			.map((item) => item.trim().toLowerCase())
			.filter(Boolean),
		normalizedProvider
	])).sort((left, right) => left.localeCompare(right));
	await configuration.update("customProviders", next, vscode.ConfigurationTarget.Global);
	vscode.window.showInformationMessage(`Added provider ${normalizedProvider}.`);
}

async function deleteProvider(provider: string): Promise<void> {
	const normalizedProvider = provider.trim().toLowerCase();
	if (!normalizedProvider) {
		return;
	}
	const configuration = vscode.workspace.getConfiguration("extendedModels");
	const customProviders = configuration.get<string[]>("customProviders", []);
	const nextProviders = customProviders
		.filter((item) => typeof item === "string")
		.map((item) => item.trim().toLowerCase())
		.filter((item) => item && item !== normalizedProvider);
	await configuration.update("customProviders", nextProviders, vscode.ConfigurationTarget.Global);

	const modelsInspect = configuration.inspect("models");
	for (const layerTarget of ["workspaceFolder", "workspace", "global"] as const) {
		const currentRaw = readRawConfigValueAtTarget(modelsInspect, layerTarget);
		if (!Array.isArray(currentRaw) || currentRaw.length === 0) {
			continue;
		}
		const nextModels = currentRaw.filter((item) => {
			if (!item || typeof item !== "object") {
				return true;
			}
			const candidateProvider = typeof (item as { provider?: unknown }).provider === "string"
				? ((item as { provider: string }).provider).trim().toLowerCase()
				: "";
			return candidateProvider !== normalizedProvider;
		});
		if (nextModels.length !== currentRaw.length) {
			await configuration.update("models", nextModels, toVsCodeConfigurationTarget(layerTarget));
		}
	}
	vscode.window.showInformationMessage(`Deleted provider ${normalizedProvider} and its custom models.`);
}

async function deleteModel(runtimeId: string, scope: unknown): Promise<void> {
	const normalizedRuntimeId = runtimeId.trim();
	if (!normalizedRuntimeId) {
		return;
	}
	const settings = getSettings();
	const runtimeModels = mergeRuntimeModels(settings.models, getCachedWrappedLanguageModelConfigs());
	const targetRuntimeModel = runtimeModels.find((model) => getRuntimeModelId(model) === normalizedRuntimeId);
	if (targetRuntimeModel?.builtIn || targetRuntimeModel?.modelSource === "vscode-lm-wrapper") {
		vscode.window.showErrorMessage(`Built-in and wrapped models cannot be deleted: ${normalizedRuntimeId}.`);
		return;
	}
	const configuration = vscode.workspace.getConfiguration("extendedModels");
	const defaultScope = normalizeConfigWritePreference(scope);
	const modelsInspect = configuration.inspect("models");
	const modelsTarget = resolveModelRuntimeWriteTarget(
		modelsInspect,
		normalizedRuntimeId,
		defaultScope,
		hasWorkspaceFolders()
	);
	const currentRaw = readRawConfigValueAtTarget(modelsInspect, modelsTarget);
	const currentModels = Array.isArray(currentRaw) ? currentRaw : [];
	// Check if model is built-in before allowing deletion
	for (const item of currentModels) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const candidate = item as Partial<ModelConfig>;
		if (!candidate.id || !candidate.provider) {
			continue;
		}
		if (getRuntimeModelId(candidate as Pick<ModelConfig, "id" | "configId" | "provider">) === normalizedRuntimeId) {
			if (candidate.builtIn) {
				vscode.window.showErrorMessage(`Built-in models cannot be deleted: ${normalizedRuntimeId}.`);
				return;
			}
			break;
		}
	}
	const nextModels = currentModels.filter((item) => {
		if (!item || typeof item !== "object") {
			return true;
		}
		const candidate = item as Partial<ModelConfig>;
		if (!candidate.id || !candidate.provider) {
			return true;
		}
		return getRuntimeModelId(candidate as Pick<ModelConfig, "id" | "configId" | "provider">) !== normalizedRuntimeId;
	});
	await configuration.update("models", nextModels, toVsCodeConfigurationTarget(modelsTarget));
	vscode.window.showInformationMessage(`Deleted model ${normalizedRuntimeId}.`);
}

async function saveVisionProxyPrompt(value: unknown, scope: unknown): Promise<void> {
	const prompt = typeof value === "string" ? value.trim() : "";
	const config = vscode.workspace.getConfiguration("extendedModels");
	const defaultScope = normalizeConfigWritePreference(scope);
	await writeScopedSectionField(config, "visionProxy", "customPrompt", prompt || undefined, defaultScope);
	vscode.window.showInformationMessage("Saved Copilot Bro image description prompt.");
}

async function saveVisionProxyBase(value: unknown, scope: unknown): Promise<void> {
	if (!value || typeof value !== "object") {
		return;
	}
	const record = value as Record<string, unknown>;
	const config = vscode.workspace.getConfiguration("extendedModels");
	const defaultScope = normalizeConfigWritePreference(scope);
	await writeScopedSectionField(config, "visionProxy", "enabled", record.enabled === true, defaultScope);
	await writeScopedSectionField(
		config,
		"visionProxy",
		"defaultModelId",
		typeof record.defaultModelId === "string" ? record.defaultModelId.trim() : "",
		defaultScope
	);
	vscode.window.showInformationMessage("Saved Copilot Bro vision proxy base settings.");
}

function isPhase1ConfigSectionKey(value: unknown): value is Phase1ConfigSectionKey {
	return typeof value === "string" && Boolean(getPhase1SectionSpec(value as Phase1ConfigSectionKey));
}

async function savePhase1Section(sectionKey: unknown, value: unknown, scope: unknown): Promise<Phase1ConfigSectionKey | undefined> {
	if (!isPhase1ConfigSectionKey(sectionKey)) {
		return undefined;
	}
	const sanitized = sanitizePhase1SectionValue(sectionKey, value);
	const config = vscode.workspace.getConfiguration("extendedModels");
	const defaultScope = normalizeConfigWritePreference(scope);
	for (const [fieldKey, fieldValue] of Object.entries(sanitized as Record<string, unknown>)) {
		await writeScopedSectionField(config, sectionKey, fieldKey, fieldValue, defaultScope);
	}
	vscode.window.showInformationMessage(`Saved Copilot Bro ${sectionKey} settings.`);
	return sectionKey;
}

function removeSensitiveStringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object") {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (typeof item === "string" && !isSensitiveKey(key)) {
			out[key] = item;
		}
	}
	return out;
}

function removeSensitiveObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") {
		return {};
	}
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
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

async function renderHtml(webview: vscode.Webview, context: vscode.ExtensionContext): Promise<string> {
	const nonce = getNonce();
	const writeScopePostCommandsJson = JSON.stringify([...CONFIG_PANEL_POST_COMMANDS_REQUIRING_CONFIG_WRITE_SCOPE]);
	const qwenHostUiContractJson = JSON.stringify(QWEN_HOST_UI_CONTRACT);
	await refreshWrappedLanguageModelConfigs().catch(() => undefined);
	const settings = getSettings();
	const runtimeModels = mergeRuntimeModels(settings.models, getCachedWrappedLanguageModelConfigs());
	const language = resolveConfigPanelLanguage(settings.uiLanguage);
	const text = UI_TEXT[language] as ConfigPanelText;
	const phase1Sections = getVisiblePhase1Sections();
	const visionAgentSection = phase1Sections.find((s) => s.key === "visionAgent");
	const visionIntegritySection = phase1Sections.find((s) => s.key === "visionIntegrity");
	const visionProcessingSection = phase1Sections.find((s) => s.key === "visionProcessing");
	const visionAgentValue = visionAgentSection
		? getPhase1SectionValue(settings, "visionAgent") as unknown as Record<string, unknown>
		: {};
	const visionIntegrityValue = visionIntegritySection
		? getPhase1SectionValue(settings, "visionIntegrity") as unknown as Record<string, unknown>
		: {};
	const visionProcessingValue = visionProcessingSection
		? getPhase1SectionValue(settings, "visionProcessing") as unknown as Record<string, unknown>
		: {};
	const phase1SectionCards = phase1Sections
		.filter((section) => !["visionAgent", "visionIntegrity", "visionProcessing"].includes(section.key))
		.map((section) => renderPhase1SectionCard(
			section,
			getPhase1SectionValue(settings, section.key) as unknown as Record<string, unknown>,
			language,
			text
		)).join("\n");
	const providers = listProviders(runtimeModels);
	const keyedProviders = await getKeyedProviders(context.secrets, providers);
	const hasDefaultKey = Boolean(await context.secrets.get("extendedModels.apiKey"));
	const promptPresets = await listPromptPresets(context).catch(() => []);
	const selectedPromptPresetId = getSelectedPromptPresetId(context, settings);
	const selectedPromptPreset = promptPresets.find((preset) => preset.id === selectedPromptPresetId);
	const visionProxyCandidates = await getVisionProxyCandidates(runtimeModels);
	const initialSelection = resolveInitialEditorSelection(context.workspaceState.get<unknown>(CONFIG_PANEL_SELECTION_KEY), runtimeModels);
	const presets = attachModelVersionIdsToPresets(runtimeModels.map((preset) => ({
		id: preset.id,
		configId: preset.configId,
		runtimeId: getRuntimeModelId(preset),
		displayName: preset.displayName,
		modelFamilyKey: preset.modelFamilyKey,
		provider: preset.provider,
		providerDisplayName: preset.providerDisplayName,
		category: preset.category,
		baseUrl: preset.baseUrl,
		contextLength: preset.contextLength,
		maxOutputTokens: preset.maxOutputTokens,
		toolCalling: preset.toolCalling,
		vision: preset.vision,
		visionProxyModelId: preset.visionProxyModelId,
		temperature: preset.temperature,
		topP: preset.topP,
		reasoningEffort: preset.reasoningEffort,
		thinking: preset.thinking,
		parameterHints: preset.parameterHints,
		documentationUrl: preset.documentationUrl,
		editTools: preset.editTools,
		modelSource: preset.modelSource,
		builtIn: preset.builtIn
	})), settings.modelFamilyCustomVersions);
	const configuredCustomProviders = vscode.workspace.getConfiguration("extendedModels").get<string[]>("customProviders", []);
	const providerNameSet = new Set([
		...presets.map((preset) => preset.provider),
		...configuredCustomProviders
			.filter((provider) => typeof provider === "string")
			.map((provider) => provider.trim().toLowerCase())
			.filter(Boolean)
	]);
	if (presets.some((preset) => preset.modelSource === "vscode-lm-wrapper") || providerNameSet.has("copilot")) {
		providerNameSet.add("copilot");
	}
	const providerNames = Array.from(providerNameSet).sort((left, right) => left.localeCompare(right));
	const endpointCatalog = providerEndpointCatalogForClient();
	const providerEndpointPreferences = settings.providerEndpoints;
	const providerCustomBaseUrls = settings.providerCustomBaseUrls;
	const initialModel = presets.find((preset) => preset.runtimeId === initialSelection.modelRuntimeId)
		?? presets.find((preset) => preset.provider === initialSelection.provider);
	return /* html */ `<!DOCTYPE html>
<html lang="${language === "zh" ? "zh-CN" : "en"}">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(text.title)}</title>
	<style>
		body { font-family: var(--vscode-font-family); padding: 18px; color: var(--vscode-foreground); max-width: 1080px; }
		button, select, input, textarea { margin: 4px 8px 8px 0; }
		button {
			padding: 7px 12px;
			border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 4px;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			cursor: pointer;
			font-weight: 600;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
		button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		label { display: block; margin-top: 8px; font-weight: 600; }
		input, select, textarea { min-width: 260px; padding: 5px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; }
		textarea { width: min(100%, 780px); min-height: 92px; font-family: var(--vscode-editor-font-family); }
		input[type="checkbox"] { min-width: auto; margin-right: 6px; vertical-align: middle; }
		label.check { display: flex; align-items: center; gap: 4px; font-weight: 600; min-height: 28px; }
		pre { background: var(--vscode-textCodeBlock-background); padding: 12px; overflow: auto; }
		.card { border: 1px solid var(--vscode-panel-border); padding: 12px; margin-bottom: 14px; border-radius: 4px; }
		.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
		.row { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; }
		.muted { color: var(--vscode-descriptionForeground); }
		.small { font-size: 12px; }
		.editor-layout { display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 12px; align-items: start; }
		.editor-pane { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px; }
		.scroll-list { width: 100%; min-width: 0; max-height: 320px; overflow-y: auto; }
		.provider-list { display: flex; flex-direction: column; gap: 8px; }
		.provider-item { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; align-items: center; }
		.provider-item .providerSelect { text-align: left; }
		.provider-item .providerSelect.is-active { border-color: var(--vscode-focusBorder); }
		.providerSetKey { min-width: 40px; padding: 6px 8px; }
		.providerSetKey.key-set { color: #ffffff; border-color: #0a7f3f; background: #0a7f3f; }
		.providerSetKey.key-unset { color: #7a7a7a; border-color: #7a7a7a; background: transparent; }
		button.danger { color: var(--vscode-errorForeground, #b42318); border-color: var(--vscode-errorForeground, #b42318); background: transparent; }
		button.danger:hover { background: rgba(180, 35, 24, 0.12); }
		button.icon-btn { min-width: 36px; padding: 6px 10px; color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); background: transparent; font: inherit; line-height: 1; }
		button.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
		button.icon-btn.danger { color: var(--vscode-errorForeground, #b42318); border-color: var(--vscode-errorForeground, #b42318); }
		.model-version-picker { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 0; }
		.model-version-picker select { flex: 1 1 200px; min-width: 0; margin: 0; }
		.model-version-picker .icon-btn { margin: 0; flex: 0 0 auto; }
		.model-version-add { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
		.model-version-add input { flex: 1 1 200px; min-width: 0; margin: 0; }
		.model-version-add .icon-btn { margin: 0; flex: 0 0 auto; }
		.provider-add-item { grid-template-columns: 1fr auto; }
		.provider-endpoint-row { margin: 4px 0 8px; }
		.provider-endpoint-row select { width: 100%; margin: 4px 0 0; }
		.provider-base-url-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 8px; }
		.provider-base-url-row input { flex: 1 1 200px; min-width: 0; margin: 0; }
		.provider-base-url-row button { margin: 0; flex: 0 0 auto; }
		@media (max-width: 1200px) {
			.editor-layout { grid-template-columns: 1fr; }
		}
	</style>
</head>
<body>
	<h1>${escapeHtml(text.title)}</h1>
	<div class="card">
		<label for="language" title="${escapeHtml(text.languageTip)}">${escapeHtml(text.language)}</label>
		<select id="language" title="${escapeHtml(text.languageTip)}">
			<option value="zh" title="使用中文显示配置页面" ${language === "zh" ? "selected" : ""}>中文</option>
			<option value="en" title="Show this configuration page in English" ${language === "en" ? "selected" : ""}>English</option>
		</select>
		<label for="configWriteScope" title="${escapeHtml(text.configWriteScopeTip)}">${escapeHtml(text.configWriteScope)}</label>
		<select id="configWriteScope" title="${escapeHtml(text.configWriteScopeTip)}">
			<option value="workspace" ${settings.configWriteScope !== "global" ? "selected" : ""}>${escapeHtml(text.configWriteScopeWorkspace)}</option>
			<option value="global" ${settings.configWriteScope === "global" ? "selected" : ""}>${escapeHtml(text.configWriteScopeGlobal)}</option>
		</select>
		<p>${escapeHtml(text.intro)} <strong>${settings.includeBuiltInPresets ? escapeHtml(text.enabled) : escapeHtml(text.disabled)}</strong>.</p>
		<p class="muted">${escapeHtml(text.configuredProviders)} ${providers.length > 0 ? providers.map((provider) => `${keyedProviders.includes(provider) ? "✓ " : ""}${provider}`).join(", ") : escapeHtml(text.none)}${hasDefaultKey ? ` · ${escapeHtml(text.defaultKeySet)}` : ""}</p>
		<button id="settings" title="${escapeHtml(text.settingsTip)}">${escapeHtml(text.settings)}</button>
		<button id="export" title="${escapeHtml(text.exportTip)}">${escapeHtml(text.export)}</button>
		<button id="import" title="${escapeHtml(text.importTip)}">${escapeHtml(text.import)}</button>
		<button id="output" title="${escapeHtml(text.outputTip)}">${escapeHtml(text.output)}</button>
	</div>
	<div class="card">
		<h2>${escapeHtml(text.editor)}</h2>
		<p class="muted">${escapeHtml(text.editorHelp)}</p>
		<div class="editor-layout">
			<div class="editor-pane">
				<h3>${escapeHtml(text.providerListTitle)}</h3>
				<p class="muted small">${escapeHtml(text.providerListHelp)}</p>
				<div id="providerList" class="scroll-list provider-list">
					${providerNames.map((p) => {
						const normalizedProvider = p.trim().toLowerCase();
						const isCustom = configuredCustomProviders.map((c) => c.trim().toLowerCase()).includes(normalizedProvider);
						const hasKey = keyedProviders.includes(normalizedProvider);
						const supportsProviderKey = normalizedProvider !== "copilot";
						const providerLabel = normalizedProvider;
						return `<div class="provider-item" data-provider="${escapeHtml(normalizedProvider)}">
							<button class="providerSelect secondary" data-provider="${escapeHtml(normalizedProvider)}" title="${escapeHtml(text.providerOptionTip)}">${escapeHtml(providerLabel)}</button>
							${supportsProviderKey ? `<button class="providerSetKey ${hasKey ? "key-set" : "key-unset"}" data-provider="${escapeHtml(normalizedProvider)}" title="${escapeHtml(text.keyTip)}">🔑</button>` : ""}
							${isCustom ? `<button class="providerDelete icon-btn danger" type="button" data-provider="${escapeHtml(normalizedProvider)}" title="${escapeHtml(text.deleteProviderTip)}">×</button>` : ""}
						</div>`;
					}).join("\n")}
					<div class="provider-item provider-add-item">
						<input id="newProviderInput" placeholder="my-provider" title="${escapeHtml(text.addProviderTip)}">
						<button id="addProviderBtn" class="icon-btn" type="button" title="${escapeHtml(text.addProviderTip)}">+</button>
					</div>
				</div>
				<div id="addProviderStatus" class="muted small" aria-live="polite"></div>
			</div>
			<div class="editor-pane">
				<h3>${escapeHtml(text.providerModelListTitle)}</h3>
				<p class="muted small">${escapeHtml(text.providerModelListHelp)}</p>
				<select id="provider" title="${escapeHtml(text.providerTip)}" style="display:none">${renderProviderOptions(providerNames, keyedProviders, initialSelection.provider, text.providerOptionTip)}</select>
				<div id="providerEndpointRow" class="provider-endpoint-row" style="display:none">
					<label for="providerEndpointProfile" title="${escapeHtml(text.providerEndpointTip)}">${escapeHtml(text.providerEndpoint)}</label>
					<select id="providerEndpointProfile" title="${escapeHtml(text.providerEndpointTip)}"></select>
					<div id="providerEndpointStatus" class="muted small" aria-live="polite"></div>
				</div>
				<label for="providerBaseUrl" title="${escapeHtml(text.providerBaseUrlTip)}">${escapeHtml(text.providerBaseUrl)}</label>
				<div class="provider-base-url-row">
					<input id="providerBaseUrl" title="${escapeHtml(text.providerBaseUrlTip)}">
					<button id="saveProviderGatewayBtn" type="button" class="secondary" style="display:none" title="${escapeHtml(text.saveProviderGatewayTip)}">${escapeHtml(text.saveProviderGateway)}</button>
				</div>
				<label for="model" title="${escapeHtml(text.modelTip)}">${escapeHtml(text.model)}</label>
				<select id="model" title="${escapeHtml(text.modelTip)}" class="scroll-list" size="11"></select>
				<div class="row">
					<button id="deleteModelBtn" class="secondary" title="${escapeHtml(text.deleteModelTip)}">${escapeHtml(text.deleteModel)}</button>
				</div>
				<hr style="margin:12px 0;border-color:var(--vscode-panel-border)">
				<label for="customModelId" title="${escapeHtml(text.customModelTip)}">${escapeHtml(text.customModel)}</label>
				<input id="customModelId" title="${escapeHtml(text.customModelTip)}" placeholder="my-model">
				<label for="customDisplayName" title="${escapeHtml(text.displayNameTip)}">${escapeHtml(text.displayName)}</label>
				<input id="customDisplayName" title="${escapeHtml(text.displayNameTip)}" placeholder="My Model">
				<label for="customCategory" title="${escapeHtml(text.categoryTip)}">${escapeHtml(text.category)}</label>
				<input id="customCategory" title="${escapeHtml(text.categoryTip)}" placeholder="General">
				<button id="saveCustom" title="${escapeHtml(text.saveCustomTip)}">${escapeHtml(text.saveCustom)}</button>
				<div id="saveCustomStatus" class="muted small" aria-live="polite"></div>
			</div>
			<div class="editor-pane">
				<h3>${escapeHtml(text.modelDetailTitle)}</h3>
				<p class="muted small">${escapeHtml(text.modelDetailHelp)}</p>
				<div class="grid">
					<div>
						<label for="displayName" title="${escapeHtml(text.displayNameTip)}">${escapeHtml(text.displayName)}</label>
						<input id="displayName" title="${escapeHtml(text.displayNameTip)}">
						<div id="modelVersionRow" style="display:none">
							<label for="modelVersionId" title="${escapeHtml(text.modelVersionTip)}">${escapeHtml(text.modelVersion)}</label>
							<div class="model-version-picker">
								<select id="modelVersionId" title="${escapeHtml(text.modelVersionTip)}"></select>
								<button id="removeModelVersionBtn" type="button" class="icon-btn danger" title="${escapeHtml(text.removeModelVersionTip)}">×</button>
							</div>
							<div class="model-version-add">
								<input id="newModelVersionId" title="${escapeHtml(text.addModelVersionTip)}" placeholder="my-model-2025-01-25">
								<button id="addModelVersionBtn" type="button" class="icon-btn" title="${escapeHtml(text.addModelVersionTip)}">+</button>
							</div>
							<div id="modelVersionStatus" class="muted small" aria-live="polite"></div>
						</div>
						<label for="category" title="${escapeHtml(text.categoryTip)}">${escapeHtml(text.category)}</label>
						<input id="category" title="${escapeHtml(text.categoryTip)}" placeholder="General">
						<label for="temperature" title="${escapeHtml(text.temperatureTip)}">${escapeHtml(text.temperature)}</label>
						<input id="temperature" type="number" title="${escapeHtml(text.temperatureTip)}" step="any">
						<div id="temperatureHint" class="muted small"></div>
						<label for="topP" title="${escapeHtml(text.topPTip)}">${escapeHtml(text.topP)}</label>
						<input id="topP" type="number" title="${escapeHtml(text.topPTip)}">
						<div id="topPHint" class="muted small"></div>
					</div>
					<div>
						<label for="contextLength" title="${escapeHtml(text.contextTip)}">${escapeHtml(text.context)} <span id="contextLengthNote" class="muted small"></span></label>
						<input id="contextLength" type="number" title="${escapeHtml(text.contextTip)}">
					</div>
					<div>
						<label for="maxOutputTokens" title="${escapeHtml(text.maxOutputTip)}">${escapeHtml(text.maxOutput)}</label>
						<input id="maxOutputTokens" type="number" title="${escapeHtml(text.maxOutputTip)}">
						<div id="maxOutputTokensHint" class="muted small"></div>
					</div>
					<div>
						<label for="thinking" title="${escapeHtml(text.thinkingTip)}">${escapeHtml(text.thinking)}</label>
						<select id="thinking" title="${escapeHtml(text.thinkingTip)}"></select>
					</div>
					<div>
						<label for="reasoningEffort" title="${escapeHtml(text.reasoningTip)}">${escapeHtml(text.reasoning)}</label>
						<select id="reasoningEffort" title="${escapeHtml(text.reasoningTip)}"></select>
					</div>
					<div>
						<label class="check" title="${escapeHtml(text.visionTip)}"><input id="vision" type="checkbox" title="${escapeHtml(text.visionTip)}"> ${escapeHtml(text.vision)}</label>
						<label class="check" title="${escapeHtml(text.toolCallingTip)}"><input id="toolCalling" type="checkbox" title="${escapeHtml(text.toolCallingTip)}"> ${escapeHtml(text.toolCalling)}</label>
					</div>
					<div>
						<label for="visionProxyModelId" title="${escapeHtml(text.modelVisionProxyTip)}">${escapeHtml(text.modelVisionProxy)}</label>
						<select id="visionProxyModelId" title="${escapeHtml(text.modelVisionProxyTip)}"></select>
					</div>
				</div>
				<button id="save" title="${escapeHtml(text.saveTip)}">${escapeHtml(text.save)}</button>
				<div id="saveStatus" class="muted small" aria-live="polite"></div>
				<div id="doc" class="muted small"></div>
			</div>
		</div>
	</div>
	<div class="card">
		<h2>${escapeHtml(text.visionSettings)}</h2>
		<p class="muted">${escapeHtml(text.visionSettingsHelp)}</p>
		<h3 style="margin:12px 0 4px">${escapeHtml(text.visionProxyPromptSection)}</h3>
		<p class="muted small">${escapeHtml(text.visionProxyPromptHelp)}</p>
		<label for="visionProxyCustomPrompt" title="${escapeHtml(text.visionProxyPromptTip)}">${escapeHtml(text.visionProxyPrompt)}</label>
		<textarea id="visionProxyCustomPrompt" title="${escapeHtml(text.visionProxyPromptTip)}">${escapeHtml(settings.visionProxy.customPrompt)}</textarea>
		<button id="saveVisionProxyPrompt" title="${escapeHtml(text.saveVisionProxyPromptTip)}">${escapeHtml(text.saveVisionProxyPrompt)}</button>
		<div id="visionProxyPromptStatus" class="muted small" aria-live="polite"></div>
		<hr style="margin:16px 0;border-color:var(--vscode-panel-border)">
		<h3 style="margin:0 0 4px">${escapeHtml(text.visionProxy)}</h3>
		<p class="muted small">${escapeHtml(text.visionProxyHelp)}</p>
		<label class="check" title="${escapeHtml(text.visionProxyEnabledTip)}"><input id="visionProxyEnabled" type="checkbox" ${settings.visionProxy.enabled ? "checked" : ""}> ${escapeHtml(text.visionProxyEnabled)}</label>
		<label for="visionProxyDefault" title="${escapeHtml(text.visionProxyDefaultTip)}">${escapeHtml(text.visionProxyDefault)}</label>
		<select id="visionProxyDefault" title="${escapeHtml(text.visionProxyDefaultTip)}"></select>
		<button id="saveVisionProxyBase" title="${escapeHtml(text.saveVisionProxyBaseTip)}">${escapeHtml(text.saveVisionProxyBase)}</button>
		<div id="visionProxyStatus" class="muted small" aria-live="polite"></div>
		<hr style="margin:16px 0;border-color:var(--vscode-panel-border)">
		<h3 style="margin:0 0 4px">${escapeHtml(language === "en" ? (visionAgentSection?.title.en ?? "") : (visionAgentSection?.title.zh ?? ""))}</h3>
		<p class="muted small">${escapeHtml(language === "en" ? (visionAgentSection?.help.en ?? "") : (visionAgentSection?.help.zh ?? ""))}</p>
		<div class="grid">${(visionAgentSection?.fields ?? []).map((field) => renderPhase1Field("visionAgent", field, visionAgentValue[field.key], language)).join("")}</div>
		<button id="phase1-save-visionAgent" title="${escapeHtml(text.saveSectionTip)}">${escapeHtml(text.saveSection)}</button>
		<div id="phase1-status-visionAgent" class="muted small" aria-live="polite"></div>
		<hr style="margin:16px 0;border-color:var(--vscode-panel-border)">
		<h3 style="margin:0 0 4px">${escapeHtml(language === "en" ? (visionIntegritySection?.title.en ?? "") : (visionIntegritySection?.title.zh ?? ""))}</h3>
		<p class="muted small">${escapeHtml(language === "en" ? (visionIntegritySection?.help.en ?? "") : (visionIntegritySection?.help.zh ?? ""))}</p>
		<div class="grid">${(visionIntegritySection?.fields ?? []).map((field) => renderPhase1Field("visionIntegrity", field, visionIntegrityValue[field.key], language)).join("")}</div>
		<button id="phase1-save-visionIntegrity" title="${escapeHtml(text.saveSectionTip)}">${escapeHtml(text.saveSection)}</button>
		<div id="phase1-status-visionIntegrity" class="muted small" aria-live="polite"></div>
		<hr style="margin:16px 0;border-color:var(--vscode-panel-border)">
		<h3 style="margin:0 0 4px">${escapeHtml(language === "en" ? (visionProcessingSection?.title.en ?? "") : (visionProcessingSection?.title.zh ?? ""))}</h3>
		<p class="muted small">${escapeHtml(language === "en" ? (visionProcessingSection?.help.en ?? "") : (visionProcessingSection?.help.zh ?? ""))}</p>
		<div class="grid">${(visionProcessingSection?.fields ?? []).map((field) => renderPhase1Field("visionProcessing", field, visionProcessingValue[field.key], language)).join("")}</div>
		<button id="phase1-save-visionProcessing" title="${escapeHtml(text.saveSectionTip)}">${escapeHtml(text.saveSection)}</button>
		<div id="phase1-status-visionProcessing" class="muted small" aria-live="polite"></div>
	</div>
	<div class="card">
		<h2>${escapeHtml(text.promptPresets)}</h2>
		<p class="muted">${escapeHtml(text.promptPresetsHelp)}</p>
		<p>${escapeHtml(text.currentPromptPreset)} <strong>${escapeHtml(selectedPromptPreset?.label ?? text.none)}</strong></p>
		<p class="muted small">${escapeHtml(text.availablePromptPresets)} ${promptPresets.length}</p>
		<button id="selectPromptPreset" title="${escapeHtml(text.selectPromptPresetTip)}">${escapeHtml(text.selectPromptPreset)}</button>
		<button id="openPromptPresetFolder" class="secondary" title="${escapeHtml(text.openPromptPresetFolderTip)}">${escapeHtml(text.openPromptPresetFolder)}</button>
	</div>
	${phase1SectionCards}
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const configPanelPostCommandsRequiringWriteScope = ${writeScopePostCommandsJson};
		const qwenHostUiContract = ${qwenHostUiContractJson};
		const presets = ${JSON.stringify(presets)};
		const phase1Sections = ${JSON.stringify(phase1Sections)};
		const visionProxyCandidates = ${JSON.stringify(visionProxyCandidates)};
		const configuredVisionProxyDefault = ${JSON.stringify(settings.visionProxy.defaultModelId)};
		const configuredWriteScope = ${JSON.stringify(settings.configWriteScope)};
		const initialSelection = ${JSON.stringify(initialSelection)};
		const endpointCatalog = ${JSON.stringify(endpointCatalog)};
		const providerEndpointPreferences = ${JSON.stringify(providerEndpointPreferences)};
		let providerCustomBaseUrls = ${JSON.stringify(providerCustomBaseUrls)};
		let modelFamilyCustomVersions = ${JSON.stringify(settings.modelFamilyCustomVersions)};
		const customEndpointProfileId = ${JSON.stringify(CUSTOM_ENDPOINT_PROFILE_ID)};
		const uiLanguage = ${JSON.stringify(language)};
		const byProvider = presets.reduce((a, p) => ((a[p.provider] ||= []).push(p), a), {});
		const $ = id => document.getElementById(id);
		const restoredState = vscode.getState() || {};
		function currentProviderModels() { return byProvider[selectedProvider()] || []; }
		let endpointProfileSelectChangeDepth = 0;
		let providerBaseUrlInputDepth = 0;
		let providerEndpointSaveSeq = 0;
		function captureState(extra = {}) {
			const current = currentPreset();
			return {
				provider: selectedProvider() || initialSelection.provider,
				modelRuntimeId: current?.runtimeId || "",
				configWriteScope: $("configWriteScope")?.value || configuredWriteScope,
				scrollY: window.scrollY,
				...extra
			};
		}
		function persistState(extra = {}) {
			vscode.setState(captureState(extra));
		}
		function rememberSelection(extra = {}) {
			const selection = captureState(extra);
			vscode.setState(selection);
			vscode.postMessage({ command: "rememberEditorSelection", selection });
		}
		function post(command, payload = {}) {
			const selection = captureState();
			vscode.setState(selection);
			const commandsNeedingWriteScope = new Set(configPanelPostCommandsRequiringWriteScope);
			const merged = commandsNeedingWriteScope.has(command) && payload.configWriteScope === undefined
				? { ...payload, configWriteScope: $("configWriteScope")?.value || configuredWriteScope }
				: payload;
			vscode.postMessage({ command, selection, ...merged });
		}
		function setOptions(select, values, selected) {
			select.innerHTML = values.map(v => '<option value="' + String(v).replaceAll('"', '&quot;') + '">' + v + '</option>').join('');
			if (selected) select.value = selected;
		}
		function escapeAttr(value) { return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'); }
		function phase1FieldId(sectionKey, fieldKey) { return 'phase1-' + sectionKey + '-' + fieldKey; }
		function phase1StatusId(sectionKey) { return 'phase1-status-' + sectionKey; }
		function readPhase1FieldValue(sectionKey, field) {
			const element = $(phase1FieldId(sectionKey, field.key));
			if (!element) return undefined;
			switch (field.kind) {
				case 'boolean':
					return !!element.checked;
				case 'number':
					return element.value === '' ? undefined : Number(element.value);
				case 'select':
				case 'string':
					return element.value;
				default:
					return undefined;
			}
		}
		function readPhase1SectionPayload(section) {
			const payload = {};
			for (const field of section.fields) {
				const value = readPhase1FieldValue(section.key, field);
				if (value !== undefined) payload[field.key] = value;
			}
			return payload;
		}
		function renderVisionProxyOptions(select, selected, options = {}) {
			const selfId = options.selfId || "";
			const allowDisable = options.allowDisable !== false;
			const rows = [{ id: "", label: options.autoLabel || "${escapeJs(text.visionProxyAuto)}" }];
			if (allowDisable) rows.push({ id: "${escapeJs(MODEL_VISION_PROXY_DISABLED)}", label: "${escapeJs(text.visionProxyDisabled)}" });
			for (const candidate of visionProxyCandidates) {
				if (candidate.id !== selfId) rows.push(candidate);
			}
			if (selected && selected !== "${escapeJs(MODEL_VISION_PROXY_DISABLED)}" && !rows.some(row => row.id === selected)) {
				rows.push({ id: selected, label: selected + " (${escapeJs(text.visionProxyUnknown)})" });
			}
			select.innerHTML = rows.map(row => '<option value="' + escapeAttr(row.id) + '" title="' + escapeAttr(row.detail || row.id) + '">' + escapeAttr(row.label) + '</option>').join('');
			select.value = selected || "";
		}
		function visionProxyToFormValue(value) {
			if (value === null || value === "null" || value === "${escapeJs(MODEL_VISION_PROXY_DISABLED)}") {
				return "${escapeJs(MODEL_VISION_PROXY_DISABLED)}";
			}
			return value || "";
		}
		function formValueToVisionProxy(value) {
			if (value === "${escapeJs(MODEL_VISION_PROXY_DISABLED)}") {
				return "${escapeJs(MODEL_VISION_PROXY_DISABLED)}";
			}
			return value || undefined;
		}
		function hintText(h) { return h ? 'range ' + h.min + '-' + h.max + ', recommended ' + h.recommended : ''; }
		function selectedProvider() { return $("provider").value.replace(/^✓\\s*/, ""); }
		function currentPreset() {
			const models = currentProviderModels();
			return models.find(m => m.runtimeId === $("model").value) || models[0];
		}
		function isReadOnlyPreset(model) {
			return !!model && model.modelSource === "vscode-lm-wrapper";
		}
		function restoreLegacyModelRuntimeId(provider) {
			if (typeof restoredState.model !== "string") return "";
			const index = Number(restoredState.model);
			if (!Number.isInteger(index) || index < 0) return "";
			return (byProvider[provider] || [])[index]?.runtimeId || "";
		}
		function syncProviderSelectionUi() {
			document.querySelectorAll(".providerSelect").forEach((button) => {
				const provider = button.getAttribute("data-provider");
				const active = provider === selectedProvider();
				button.classList.toggle("is-active", active);
			});
		}
		function normalizeProviderKey(provider) {
			return String(provider || "").trim().toLowerCase();
		}
		function findEndpointCatalogEntry(provider) {
			const key = normalizeProviderKey(provider);
			return endpointCatalog.find((entry) => entry.providers.some((alias) => normalizeProviderKey(alias) === key));
		}
		function normalizeBaseUrlForCompare(url) {
			return String(url || "").trim().replace(/\\/+$/, "").toLowerCase();
		}
		function resolveStoredEndpointProfileId(provider) {
			const key = normalizeProviderKey(provider);
			const direct = providerEndpointPreferences[key];
			if (direct) {
				return direct;
			}
			const entry = findEndpointCatalogEntry(provider);
			if (!entry) {
				return undefined;
			}
			for (const alias of entry.providers) {
				const aliasKey = normalizeProviderKey(alias);
				if (providerEndpointPreferences[aliasKey]) {
					return providerEndpointPreferences[aliasKey];
				}
			}
			return undefined;
		}
		function replaceProviderEndpointPreferences(next) {
			const snapshot = next && typeof next === "object" ? next : {};
			for (const key of Object.keys(providerEndpointPreferences)) {
				delete providerEndpointPreferences[key];
			}
			Object.assign(providerEndpointPreferences, snapshot);
		}
		function catalogBaseUrlForProfile(provider, profileId) {
			const entry = findEndpointCatalogEntry(provider);
			if (!entry || !profileId || profileId === customEndpointProfileId) {
				return "";
			}
			return entry.profiles.find((candidate) => candidate.id === profileId)?.baseUrl || "";
		}
		function setProviderBaseUrlInput(url) {
			const input = $("providerBaseUrl");
			if (!input) {
				return;
			}
			providerBaseUrlInputDepth += 1;
			try {
				input.value = url;
			} finally {
				providerBaseUrlInputDepth -= 1;
			}
		}
		function updatePresetBaseUrlsForProvider(provider, baseUrl) {
			const entry = findEndpointCatalogEntry(provider);
			const aliases = entry
				? entry.providers.map((alias) => normalizeProviderKey(alias))
				: [normalizeProviderKey(provider)];
			const normalizedUrl = String(baseUrl || "").trim();
			if (!normalizedUrl) {
				return;
			}
			for (const preset of presets) {
				if (aliases.includes(normalizeProviderKey(preset.provider))) {
					preset.baseUrl = normalizedUrl;
				}
			}
		}
		function writeProviderEndpointPreference(provider, profileId) {
			const key = normalizeProviderKey(provider);
			if (!key || !profileId) {
				return;
			}
			const entry = findEndpointCatalogEntry(provider);
			if (entry) {
				for (const alias of entry.providers) {
					delete providerEndpointPreferences[normalizeProviderKey(alias)];
				}
			}
			providerEndpointPreferences[key] = profileId;
		}
		function resolveProviderBaseUrlForPreset(provider) {
			const key = normalizeProviderKey(provider);
			const custom = providerCustomBaseUrls[key];
			if (custom) {
				return custom;
			}
			const storedProfile = resolveStoredEndpointProfileId(provider);
			if (storedProfile && storedProfile !== customEndpointProfileId) {
				const fromProfile = catalogBaseUrlForProfile(provider, storedProfile);
				if (fromProfile) {
					return fromProfile;
				}
			}
			const entry = findEndpointCatalogEntry(provider);
			if (entry) {
				return catalogBaseUrlForProfile(provider, entry.defaultProfileId);
			}
			const preset = (byProvider[provider] || [])[0];
			return preset?.baseUrl || "";
		}
		function resolveEndpointProfileIdForUi(provider, baseUrl) {
			const entry = findEndpointCatalogEntry(provider);
			if (!entry) {
				return customEndpointProfileId;
			}
			const normalized = normalizeBaseUrlForCompare(baseUrl);
			const matched = entry.profiles.find((profile) => normalizeBaseUrlForCompare(profile.baseUrl) === normalized);
			if (matched) {
				return matched.id;
			}
			if (normalized) {
				return customEndpointProfileId;
			}
			const stored = resolveStoredEndpointProfileId(provider);
			if (stored && entry.profiles.some((profile) => profile.id === stored)) {
				return stored;
			}
			return entry.defaultProfileId;
		}
		function isCustomProviderGatewayProfile(provider, profileId) {
			const entry = findEndpointCatalogEntry(provider);
			if (!entry) {
				return true;
			}
			return profileId === customEndpointProfileId;
		}
		function syncEndpointProfileSelectValue(profileId) {
			const select = $("providerEndpointProfile");
			if (!select || !profileId) {
				return false;
			}
			for (let index = 0; index < select.options.length; index += 1) {
				if (select.options[index].value === profileId) {
					endpointProfileSelectChangeDepth += 1;
					try {
						select.value = profileId;
					} finally {
						endpointProfileSelectChangeDepth -= 1;
					}
					return true;
				}
			}
			return false;
		}
		function refreshEndpointProfileSelect(lockedProfileId) {
			const row = $("providerEndpointRow");
			const select = $("providerEndpointProfile");
			const provider = selectedProvider();
			const baseUrl = $("providerBaseUrl")?.value || "";
			const entry = findEndpointCatalogEntry(provider);
			if (!row || !select) {
				return customEndpointProfileId;
			}
			if (!entry) {
				row.style.display = "none";
				return customEndpointProfileId;
			}
			row.style.display = "";
			let profileId = typeof lockedProfileId === "string" && lockedProfileId
				? lockedProfileId
				: resolveEndpointProfileIdForUi(provider, baseUrl);
			if (!entry.profiles.some((profile) => profile.id === profileId) && profileId !== customEndpointProfileId) {
				profileId = resolveEndpointProfileIdForUi(provider, baseUrl);
			}
			if (syncEndpointProfileSelectValue(profileId)) {
				select.disabled = isReadOnlyPreset(currentPreset());
				return profileId;
			}
			const customLabel = "${escapeJs(text.providerEndpointCustom)}";
			endpointProfileSelectChangeDepth += 1;
			try {
				select.innerHTML = entry.profiles.map((profile) => {
					const label = uiLanguage === "en" ? profile.labels.en : profile.labels.zh;
					return '<option value="' + escapeAttr(profile.id) + '"' + (profile.id === profileId ? " selected" : "") + '>' + escapeAttr(label) + '</option>';
				}).join("") + '<option value="' + escapeAttr(customEndpointProfileId) + '"' + (profileId === customEndpointProfileId ? " selected" : "") + '>' + escapeAttr(customLabel) + '</option>';
				select.value = profileId;
			} finally {
				endpointProfileSelectChangeDepth -= 1;
			}
			select.disabled = isReadOnlyPreset(currentPreset());
			return profileId;
		}
		function syncProviderEndpointUiFromProfile(profileId) {
			const provider = selectedProvider();
			const activeProfileId = profileId || $("providerEndpointProfile")?.value || customEndpointProfileId;
			const url = catalogBaseUrlForProfile(provider, activeProfileId) || resolveProviderBaseUrlForPreset(provider);
			if (url) {
				setProviderBaseUrlInput(url);
				updatePresetBaseUrlsForProvider(provider, url);
			}
			const resolvedProfileId = refreshEndpointProfileSelect(activeProfileId);
			updateProviderGatewaySaveUi(resolvedProfileId);
			return resolvedProfileId;
		}
		function updateProviderGatewaySaveUi(profileId) {
			const provider = selectedProvider();
			const entry = findEndpointCatalogEntry(provider);
			const select = $("providerEndpointProfile");
			const baseUrlInput = $("providerBaseUrl");
			const saveBtn = $("saveProviderGatewayBtn");
			const activeProfileId = typeof profileId === "string" && profileId
				? profileId
				: (select?.value || resolveEndpointProfileIdForUi(provider, baseUrlInput?.value || ""));
			const isCustom = isCustomProviderGatewayProfile(provider, activeProfileId);
			if (saveBtn) {
				saveBtn.style.display = isCustom ? "" : "none";
			}
			if (baseUrlInput) {
				const readOnly = Boolean(entry) && !isCustom && !isReadOnlyPreset(currentPreset());
				baseUrlInput.readOnly = readOnly;
				baseUrlInput.disabled = isReadOnlyPreset(currentPreset());
			}
		}
		function applyProviderEndpointProfileSelection(profileId, options) {
			const provider = selectedProvider();
			const persist = !options || options.persist !== false;
			if (!provider || !profileId) {
				return;
			}
			writeProviderEndpointPreference(provider, profileId);
			const url = catalogBaseUrlForProfile(provider, profileId);
			if (url) {
				setProviderBaseUrlInput(url);
				updatePresetBaseUrlsForProvider(provider, url);
			}
			syncEndpointProfileSelectValue(profileId);
			updateProviderGatewaySaveUi(profileId);
			if (persist && !isCustomProviderGatewayProfile(provider, profileId)) {
				persistCatalogProviderEndpoint(profileId);
			}
		}
		function refreshModels(preferredModelRuntimeId = "") {
			const models = currentProviderModels();
			$("model").innerHTML = models.map((m) => '<option title="${escapeJs(text.modelOptionTip)}" value="' + escapeAttr(m.runtimeId) + '">' + escapeAttr((m.displayName || m.id) + (m.category ? ' · ' + m.category : '')) + '</option>').join('');
			const latestState = vscode.getState() || {};
			const persistedModelRuntimeId = typeof latestState.modelRuntimeId === "string" ? latestState.modelRuntimeId : "";
			const fallbackModelRuntimeId = models[0]?.runtimeId || "";
			const selectedModelRuntimeId = [preferredModelRuntimeId, persistedModelRuntimeId, restoreLegacyModelRuntimeId(selectedProvider()), initialSelection.modelRuntimeId, fallbackModelRuntimeId]
				.find(id => id && models.some(model => model.runtimeId === id)) || fallbackModelRuntimeId;
			if (selectedModelRuntimeId) $("model").value = selectedModelRuntimeId;
			syncProviderSelectionUi();
			refreshForm();
		}
		function refreshModelVersionSelect() {
			const row = $("modelVersionRow");
			const select = $("modelVersionId");
			const removeBtn = $("removeModelVersionBtn");
			const status = $("modelVersionStatus");
			const m = currentPreset();
			if (!row || !select || !m) {
				return;
			}
			if (isReadOnlyPreset(m) || !Array.isArray(m.versionIds) || m.versionIds.length === 0) {
				row.style.display = "none";
				if (status) status.textContent = "";
				return;
			}
			row.style.display = "";
			select.innerHTML = m.versionIds.map((versionId) => '<option value="' + escapeAttr(versionId) + '">' + escapeAttr(versionId) + '</option>').join("");
			const preferredVersion = m.versionIds.includes(m.id) ? m.id : m.versionIds[0];
			select.value = preferredVersion;
			if (m.id !== preferredVersion) {
				m.id = preferredVersion;
			}
			updateModelVersionRemoveState(m, select.value, removeBtn);
			if (status) status.textContent = "";
		}
		function isBuiltinModelVersion(model, versionId) {
			return Array.isArray(model?.builtinVersionIds) && model.builtinVersionIds.includes(versionId);
		}
		function updateModelVersionRemoveState(model, versionId, removeBtn) {
			if (!removeBtn || !model?.modelFamilyKey) {
				return;
			}
			removeBtn.disabled = !versionId || isBuiltinModelVersion(model, versionId);
		}
		function applyModelFamilyVersionsUpdated(payload) {
			if (!payload || typeof payload !== "object") {
				return;
			}
			modelFamilyCustomVersions = payload.customVersions || modelFamilyCustomVersions;
			const provider = typeof payload.provider === "string" ? payload.provider : "";
			const familyKey = typeof payload.familyKey === "string" ? payload.familyKey : "";
			const versionIds = Array.isArray(payload.versionIds) ? payload.versionIds : [];
			for (const preset of presets) {
				if (preset.provider === provider && preset.modelFamilyKey === familyKey) {
					preset.versionIds = versionIds;
				}
			}
			const m = currentPreset();
			if (m && m.provider === provider && m.modelFamilyKey === familyKey) {
				if (!versionIds.includes(m.id)) {
					m.id = versionIds[0] || m.id;
				}
			}
			refreshModelVersionSelect();
			const status = $("modelVersionStatus");
			if (status) {
				status.textContent = "${escapeJs(text.modelVersionUpdated)}";
			}
		}
		function applySelectedModelVersion(versionId) {
			const m = currentPreset();
			if (!m || !m.modelFamilyKey || !versionId) {
				return;
			}
			m.id = versionId;
			refreshModelVersionSelect();
			rememberSelection();
		}
		$("language").addEventListener("change", () => post("setLanguage", { language: $("language").value }));
		$("configWriteScope").addEventListener("change", () => {
			persistState();
			$("saveStatus").textContent = "";
			post("setConfigWriteScope", { configWriteScope: $("configWriteScope").value });
		});
		function refreshForm() {
			const m = currentPreset();
			if (!m) {
				$("providerBaseUrl").value = "";
				$("providerBaseUrl").disabled = false;
				$("save").disabled = false;
				$("displayName").value = "";
				$("category").value = "";
				$("saveStatus").textContent = "${escapeJs(text.noModelsForProvider)}";
				return;
			}
			const catalogEntry = findEndpointCatalogEntry(m.provider);
			const resolvedBaseUrl = resolveProviderBaseUrlForPreset(m.provider);
			$("providerBaseUrl").value = resolvedBaseUrl || (!catalogEntry ? (m.baseUrl || "") : "");
			$("displayName").value = m.displayName || m.id;
			$("category").value = m.category || "";
			$("temperature").value = m.temperature ?? "";
			$("topP").value = m.topP ?? "";
			$("maxOutputTokens").value = m.maxOutputTokens || 4096;
			$("contextLength").value = m.contextLength || 128000;
			$("contextLengthNote").textContent = m.builtIn ? "${escapeJs(text.contextNotRecommended)}" : "";
			const isReadOnlyModel = isReadOnlyPreset(m);
			const deleteBtn = $("deleteModelBtn");
			if (deleteBtn) { deleteBtn.style.display = isReadOnlyModel ? "none" : ""; }
			const providerBaseUrlInput = $("providerBaseUrl");
			if (providerBaseUrlInput) { providerBaseUrlInput.disabled = isReadOnlyModel; }
			const saveBtn = $("save");
			if (saveBtn) { saveBtn.disabled = isReadOnlyModel; }
			$("vision").checked = !!m.vision;
			$("toolCalling").checked = m.toolCalling !== false;
			renderVisionProxyOptions($("visionProxyModelId"), visionProxyToFormValue(m.visionProxyModelId), { selfId: m.id, autoLabel: "${escapeJs(text.modelVisionProxyAuto)}" });
			const hints = m.parameterHints || {};
			for (const [id, key] of [["temperatureHint","temperature"],["topPHint","topP"],["maxOutputTokensHint","maxOutputTokens"]]) $(id).textContent = hintText(hints[key]);
			setOptions($("thinking"), (hints.thinking && hints.thinking.options) || ["disabled", "enabled"], (m.thinking && m.thinking.type) || (hints.thinking && hints.thinking.recommended));
			setOptions($("reasoningEffort"), ["", ...((hints.reasoningEffort && hints.reasoningEffort.options) || ["low", "medium", "high", "max"])], m.reasoningEffort || "");
			$("doc").textContent = m.documentationUrl ? "Docs: " + m.documentationUrl : "";
			$("saveStatus").textContent = "";
			const profileId = refreshEndpointProfileSelect();
			updateProviderGatewaySaveUi(profileId);
			refreshModelVersionSelect();
			persistState();
		}
		const modelVersionSelect = $("modelVersionId");
		if (modelVersionSelect) {
			modelVersionSelect.addEventListener("change", () => applySelectedModelVersion(modelVersionSelect.value));
		}
		const addModelVersionBtn = $("addModelVersionBtn");
		if (addModelVersionBtn) {
			addModelVersionBtn.addEventListener("click", () => {
				const m = currentPreset();
				const versionId = String($("newModelVersionId")?.value || "").trim();
				const status = $("modelVersionStatus");
				if (!m?.modelFamilyKey || !versionId) {
					if (status) status.textContent = "${escapeJs(text.addModelVersionEmpty)}";
					return;
				}
				post("addModelFamilyVersion", { provider: m.provider, familyKey: m.modelFamilyKey, versionId });
			});
		}
		const removeModelVersionBtn = $("removeModelVersionBtn");
		if (removeModelVersionBtn) {
			removeModelVersionBtn.addEventListener("click", () => {
				const m = currentPreset();
				const versionId = String($("modelVersionId")?.value || "").trim();
				if (!m?.modelFamilyKey || !versionId) {
					return;
				}
				post("removeModelFamilyVersion", { provider: m.provider, familyKey: m.modelFamilyKey, versionId });
			});
		}
		function postProviderEndpointSettings(profileId, baseUrl) {
			const provider = selectedProvider();
			const status = $("providerEndpointStatus");
			if (!provider) {
				if (status) status.textContent = "${escapeJs(text.noModelsForProvider)}";
				return;
			}
			const endpointSaveSeq = ++providerEndpointSaveSeq;
			post("setProviderEndpoint", {
				provider,
				profileId,
				baseUrl,
				configWriteScope: $("configWriteScope")?.value,
				endpointSaveSeq
			});
			if (status) status.textContent = "${escapeJs(text.providerEndpointSaving)}";
		}
		function saveProviderGatewaySettings() {
			const profileSelect = $("providerEndpointProfile");
			const profileId = profileSelect?.value || customEndpointProfileId;
			const baseUrl = String($("providerBaseUrl")?.value || "").trim();
			postProviderEndpointSettings(profileId, baseUrl);
		}
		function persistCatalogProviderEndpoint(profileId) {
			const entry = findEndpointCatalogEntry(selectedProvider());
			if (!entry || profileId === customEndpointProfileId) {
				return;
			}
			const profile = entry.profiles.find((candidate) => candidate.id === profileId);
			if (!profile) {
				return;
			}
			postProviderEndpointSettings(profileId, profile.baseUrl);
		}
		const providerEndpointProfileSelect = $("providerEndpointProfile");
		if (providerEndpointProfileSelect) {
			providerEndpointProfileSelect.addEventListener("change", () => {
				if (endpointProfileSelectChangeDepth > 0) {
					return;
				}
				applyProviderEndpointProfileSelection(providerEndpointProfileSelect.value);
			});
		}
		const saveProviderGatewayBtn = $("saveProviderGatewayBtn");
		if (saveProviderGatewayBtn) {
			saveProviderGatewayBtn.addEventListener("click", () => saveProviderGatewaySettings());
		}
		$("providerBaseUrl").addEventListener("input", () => {
			if (providerBaseUrlInputDepth > 0) {
				return;
			}
			const profileId = refreshEndpointProfileSelect();
			updateProviderGatewaySaveUi(profileId);
		});
		$("provider").addEventListener("change", () => { refreshModels(); rememberSelection(); });
		$("model").addEventListener("change", () => { refreshForm(); rememberSelection(); });
		function buildCurrentModelPayload() {
			const m = currentPreset();
			const thinking = $("thinking").value;
			const versionRow = $("modelVersionRow");
			const versionSelect = $("modelVersionId");
			const activeVersionId = versionRow && versionRow.style.display !== "none" && versionSelect
				? String(versionSelect.value || "").trim()
				: m.id;
			return {
				...m,
				id: activeVersionId || m.id,
				modelFamilyKey: m.modelFamilyKey,
				displayName: $("displayName").value,
				category: $("category").value.trim() || undefined,
				contextLength: Number($("contextLength").value) || m.contextLength || 128000,
				temperature: $("temperature").value === "" ? undefined : Number($("temperature").value),
				topP: $("topP").value === "" ? undefined : Number($("topP").value),
				maxOutputTokens: Number($("maxOutputTokens").value),
				thinking: thinking ? { type: thinking } : undefined,
				reasoningEffort: $("reasoningEffort").value || undefined,
				vision: $("vision").checked,
				visionProxyModelId: formValueToVisionProxy($("visionProxyModelId").value),
				toolCalling: $("toolCalling").checked,
				builtIn: undefined
			};
		}
		function applyModelPayloadLocally(model) {
			const target = presets.find((preset) => preset.runtimeId === model.runtimeId)
				|| presets.find((preset) => preset.id === model.id && preset.provider === model.provider);
			if (target) {
				Object.assign(target, model);
			}
		}
		function snapshotCurrentModelState() {
			return {
				displayName: String($("displayName").value || ""),
				temperature: String($("temperature").value || "")
			};
		}
		function selectModel(runtimeId) {
			const target = presets.find((preset) => preset.runtimeId === runtimeId);
			if (!target) {
				throw new Error("Unknown runtime model id: " + runtimeId);
			}
			$("provider").value = target.provider;
			refreshModels(runtimeId);
			rememberSelection();
		}
		let nextHostUiSmokeRequestId = 1;
		const pendingHostUiSmokeSaves = new Map();
		const pendingProviderEndpointSaves = new Map();
		function saveCurrentModelForHostUiSmoke() {
			const model = buildCurrentModelPayload();
			applyModelPayloadLocally(model);
			return new Promise((resolve, reject) => {
				const requestId = nextHostUiSmokeRequestId++;
				pendingHostUiSmokeSaves.set(requestId, { resolve, reject });
				post("hostUiSmokeSaveModel", { requestId, model });
			});
		}
		function saveProviderEndpointForHostUiSmoke() {
			const provider = selectedProvider();
			const profileSelect = $("providerEndpointProfile");
			const profileId = profileSelect?.value || customEndpointProfileId;
			const baseUrl = String($("providerBaseUrl")?.value || "").trim();
			if (!provider) {
				return Promise.reject(new Error("Host UI smoke: no provider selected for endpoint save."));
			}
			return new Promise((resolve, reject) => {
				const requestId = nextHostUiSmokeRequestId++;
				pendingProviderEndpointSaves.set(requestId, { resolve, reject });
				post("setProviderEndpoint", { requestId, provider, profileId, baseUrl, hostUiSmoke: true });
			});
		}
		function waitForModelFamilyVersionsUpdated(provider, familyKey, timeoutMs = 8000) {
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("Host UI smoke: timed out waiting for modelFamilyVersionsUpdated.")), timeoutMs);
				const handler = (event) => {
					const data = event.data;
					if (!data || data.command !== "modelFamilyVersionsUpdated") {
						return;
					}
					if (data.provider !== provider || data.familyKey !== familyKey) {
						return;
					}
					clearTimeout(timer);
					window.removeEventListener("message", handler);
					applyModelFamilyVersionsUpdated(data);
					resolve(data);
				};
				window.addEventListener("message", handler);
			});
		}
		async function runModelVersionUiSmoke() {
			const qwenMax = presets.find((preset) => preset.provider === "qwen" && preset.modelFamilyKey === "qwen3-max");
			if (!qwenMax) {
				throw new Error("Host UI smoke: Qwen3-Max family preset missing from config panel.");
			}
			$("provider").value = "qwen";
			refreshModels(qwenMax.runtimeId);
			const row = $("modelVersionRow");
			const select = $("modelVersionId");
			if (!row || !select || row.style.display === "none") {
				throw new Error("Host UI smoke: model version row hidden for Qwen3-Max.");
			}
			const versionBefore = String(select.value || qwenMax.id);
			const preferredMaxVersion = qwenHostUiContract.qwen3MaxDefaultVersionId;
			const targetVersion = (qwenMax.versionIds || []).includes(preferredMaxVersion)
				? preferredMaxVersion
				: (qwenMax.versionIds || [])[1];
			if (!targetVersion) {
				throw new Error("Host UI smoke: Qwen3-Max family has no alternate version id to select.");
			}
			select.value = targetVersion;
			applySelectedModelVersion(targetVersion);
			await saveCurrentModelForHostUiSmoke();
			if (String(select.value || "") !== targetVersion) {
				throw new Error("Host UI smoke: model version id did not persist after save.");
			}
			const customVersionId = "copilot-bro-smoke-qwen-max-version";
			$("newModelVersionId").value = customVersionId;
			const addPromise = waitForModelFamilyVersionsUpdated("qwen", "qwen3-max");
			post("addModelFamilyVersion", { provider: "qwen", familyKey: "qwen3-max", versionId: customVersionId });
			await addPromise;
			if (!(qwenMax.versionIds || []).includes(customVersionId)) {
				throw new Error("Host UI smoke: custom model version id missing after add.");
			}
			select.value = customVersionId;
			applySelectedModelVersion(customVersionId);
			const removePromise = waitForModelFamilyVersionsUpdated("qwen", "qwen3-max");
			post("removeModelFamilyVersion", { provider: "qwen", familyKey: "qwen3-max", versionId: customVersionId });
			await removePromise;
			if ((qwenMax.versionIds || []).includes(customVersionId)) {
				throw new Error("Host UI smoke: custom model version id still present after remove.");
			}
			return {
				rowVisible: true,
				familyKey: qwenHostUiContract.qwen3MaxFamilyKey,
				versionBefore,
				versionAfter: targetVersion,
				customVersionId,
				customAdded: true,
				customRemoved: true
			};
		}
		async function runProviderEndpointUiSmoke() {
			const qwenModel = presets.find((preset) => preset.provider === "qwen");
			if (!qwenModel) {
				throw new Error("Host UI smoke: no built-in qwen preset for provider endpoint UI check.");
			}
			$("provider").value = "qwen";
			refreshModels(qwenModel.runtimeId);
			const row = $("providerEndpointRow");
			const select = $("providerEndpointProfile");
			if (!row || !select) {
				throw new Error("Host UI smoke: provider endpoint controls missing from config panel DOM.");
			}
			if (row.style.display === "none") {
				throw new Error("Host UI smoke: provider endpoint row hidden for qwen.");
			}
			const baseUrlBefore = String($("providerBaseUrl").value || "");
			const targetProfileId = "dashscope-cn";
			const entry = findEndpointCatalogEntry("qwen");
			const targetProfile = entry?.profiles.find((profile) => profile.id === targetProfileId);
			if (!targetProfile) {
				throw new Error("Host UI smoke: dashscope-cn profile missing from endpoint catalog.");
			}
			endpointProfileSelectChangeDepth += 1;
			try {
				select.value = targetProfileId;
			} finally {
				endpointProfileSelectChangeDepth -= 1;
			}
			writeProviderEndpointPreference("qwen", targetProfileId);
			syncProviderEndpointUiFromProfile(targetProfileId);
			const baseUrlAfter = String($("providerBaseUrl").value || "");
			if (normalizeBaseUrlForCompare(baseUrlAfter) !== normalizeBaseUrlForCompare(targetProfile.baseUrl)) {
				throw new Error("Host UI smoke: provider base URL did not update after endpoint profile selection.");
			}
			if (select.value !== targetProfileId) {
				throw new Error("Host UI smoke: endpoint profile select did not reflect chosen region label.");
			}
			const persistedProfileId = await saveProviderEndpointForHostUiSmoke();
			return {
				rowVisible: true,
				profileId: targetProfileId,
				baseUrlBefore,
				baseUrlAfter,
				persistedProfileId: typeof persistedProfileId === "string" ? persistedProfileId : undefined,
				savedViaProfileChange: true
			};
		}
		async function runQwenCatalogVisibilitySmoke() {
			const familyKey = qwenHostUiContract.vlOpenSourceFamilyKey;
			const expectedDefaultVersion = qwenHostUiContract.vlOpenSourceDefaultVersionId;
			const vlFamily = presets.find((preset) => preset.provider === "qwen" && preset.modelFamilyKey === familyKey);
			if (!vlFamily) {
				throw new Error("Host UI smoke: qwen3-vl-open-source preset missing from catalog.");
			}
			$("provider").value = "qwen";
			refreshModels(vlFamily.runtimeId);
			const modelSelect = $("model");
			if (!modelSelect) {
				throw new Error("Host UI smoke: model select missing from config panel DOM.");
			}
			const options = Array.from(modelSelect.options);
			const match = options.find((option) => option.value === vlFamily.runtimeId);
			if (!match) {
				throw new Error("Host UI smoke: qwen3-vl-open-source not listed in model picker.");
			}
			selectModel(vlFamily.runtimeId);
			const versionSelect = $("modelVersionId");
			const versionRow = $("modelVersionRow");
			if (!versionSelect || !versionRow || versionRow.style.display === "none") {
				throw new Error("Host UI smoke: model version row hidden for qwen3-vl-open-source.");
			}
			const versionIds = Array.from(versionSelect.options).map((option) => option.value);
			if (versionIds.length !== qwenHostUiContract.vlOpenSourceVersionCount) {
				throw new Error("Host UI smoke: expected " + qwenHostUiContract.vlOpenSourceVersionCount + " qwen3-vl-open-source versions, got " + versionIds.length + ".");
			}
			if (!versionIds.includes(expectedDefaultVersion)) {
				throw new Error("Host UI smoke: default VL version missing from version list: " + expectedDefaultVersion);
			}
			if (versionSelect.value !== expectedDefaultVersion) {
				throw new Error("Host UI smoke: default version must be " + expectedDefaultVersion + ", got " + versionSelect.value + ".");
			}
			return {
				familyVisible: true,
				familyKey,
				versionCount: versionIds.length,
				defaultVersionId: versionSelect.value
			};
		}
		async function runHostUiSmokeConfig(payload) {
			const result = {
				ok: false,
				initial: { displayName: "", temperature: "" },
				afterSave: { displayName: "", temperature: "" },
				proState: { displayName: "", temperature: "" },
				roundtrip: { displayName: "", temperature: "" },
				restored: { displayName: "", temperature: "" },
				providerEndpointUi: undefined,
				qwenCatalogUi: undefined
			};
			try {
				selectModel(payload.primaryModelRuntimeId);
				result.initial = snapshotCurrentModelState();
				$("temperature").value = payload.targetTemperature;
				await saveCurrentModelForHostUiSmoke();
				$("saveStatus").textContent = "${escapeJs(text.saved)}";
				selectModel(payload.primaryModelRuntimeId);
				result.afterSave = snapshotCurrentModelState();
				selectModel(payload.secondaryModelRuntimeId);
				result.proState = snapshotCurrentModelState();
				selectModel(payload.primaryModelRuntimeId);
				result.roundtrip = snapshotCurrentModelState();
				$("temperature").value = payload.originalTemperature;
				await saveCurrentModelForHostUiSmoke();
				$("saveStatus").textContent = "${escapeJs(text.saved)}";
				selectModel(payload.primaryModelRuntimeId);
				result.restored = snapshotCurrentModelState();
				result.providerEndpointUi = await runProviderEndpointUiSmoke();
				result.modelVersionUi = await runModelVersionUiSmoke();
				result.qwenCatalogUi = await runQwenCatalogVisibilitySmoke();
				result.ok = true;
			} catch (error) {
				result.error = error instanceof Error ? error.message : String(error);
			}
			vscode.postMessage({ command: "hostUiSmokeResult", result });
		}
		$("save").addEventListener("click", () => {
			const model = buildCurrentModelPayload();
			applyModelPayloadLocally(model);
			post("saveModel", { model });
		});
		$("saveCustom").addEventListener("click", () => {
			const provider = selectedProvider();
			const modelId = $("customModelId").value.trim();
			const displayName = $("customDisplayName").value.trim() || modelId;
			const category = $("customCategory").value.trim();
			if (!provider || !modelId) {
				$("saveCustomStatus").textContent = "${escapeJs(text.addModelEmpty)}";
				return;
			}
			$("saveCustomStatus").textContent = "";
			post("saveCustomModel", { model: {
				id: modelId,
				displayName: displayName,
				provider,
				providerDisplayName: provider,
				category: category || undefined,
				family: "oai-compatible",
				contextLength: 128000,
				maxOutputTokens: 4096,
				temperature: 1,
				topP: 1,
				thinking: { type: "enabled" },
				reasoningEffort: "high",
				vision: false,
				visionProxyModelId: undefined,
				toolCalling: true,
				headers: {},
				extraBody: {},
				includeReasoningInRequest: false,
				editTools: ["apply-patch", "multi-find-replace", "find-replace"],
				parameterHints: {
					temperature: { min: 0, max: 2, step: 0.1, recommended: 1 },
					topP: { min: 0, max: 1, step: 0.05, recommended: 1 },
					maxOutputTokens: { min: 1, max: 128000, step: 1024, recommended: 4096 },
					thinking: { options: ["enabled", "disabled"], recommended: "enabled" },
					reasoningEffort: { options: ["low", "medium", "high", "max"], recommended: "high" }
				}
			}});
		});
		for (const section of phase1Sections) {
			const button = $("phase1-save-" + section.key);
			if (button) {
				button.addEventListener("click", () => post("savePhase1Section", {
					sectionKey: section.key,
					value: readPhase1SectionPayload(section)
				}));
			}
		}
		window.addEventListener("message", event => {
			if (event.data && event.data.command === "saved") {
				$("saveStatus").textContent = "${escapeJs(text.saved)}";
				persistState();
			} else if (event.data && event.data.command === "savedVisionProxyPrompt") {
				$("visionProxyPromptStatus").textContent = "${escapeJs(text.savedVisionProxyPrompt)}";
				persistState();
			} else if (event.data && event.data.command === "savedVisionProxyBase") {
				$("visionProxyStatus").textContent = "${escapeJs(text.savedVisionProxy)}";
				persistState();
			} else if (event.data && event.data.command === "savedPhase1Section" && typeof event.data.sectionKey === "string") {
				const status = $(phase1StatusId(event.data.sectionKey));
				if (status) {
					status.textContent = "${escapeJs(text.savedSection)}";
				}
				persistState();
			} else if (event.data && event.data.command === "providerEndpointSaved") {
				const requestId = event.data.requestId;
				const pending = pendingProviderEndpointSaves.get(requestId);
				if (pending) {
					pendingProviderEndpointSaves.delete(requestId);
					pending.resolve(event.data.profileId);
				}
				const responseSeq = Number(event.data.endpointSaveSeq);
				if (Number.isFinite(responseSeq) && responseSeq > 0 && responseSeq < providerEndpointSaveSeq) {
					return;
				}
				if (event.data.providerEndpoints && typeof event.data.providerEndpoints === "object") {
					replaceProviderEndpointPreferences(event.data.providerEndpoints);
				}
				if (event.data.providerCustomBaseUrls && typeof event.data.providerCustomBaseUrls === "object") {
					providerCustomBaseUrls = event.data.providerCustomBaseUrls;
				}
				const uiProfileId = $("providerEndpointProfile")?.value || "";
				const savedProfileId = typeof event.data.profileId === "string" ? event.data.profileId : "";
				const profileId = uiProfileId || savedProfileId;
				if (profileId) {
					writeProviderEndpointPreference(selectedProvider(), profileId);
				}
				syncProviderEndpointUiFromProfile(profileId);
				const status = $("providerEndpointStatus");
				if (status) status.textContent = "${escapeJs(text.providerEndpointSaved)}";
			} else if (event.data && event.data.command === "panelError") {
				const message = typeof event.data.message === "string" ? event.data.message : "${escapeJs(text.operationFailed)}";
				$("saveStatus").textContent = message;
				$("visionProxyStatus").textContent = message;
				const promptStatus = $("visionProxyPromptStatus");
				if (promptStatus) {
					promptStatus.textContent = message;
				}
			} else if (event.data && event.data.command === "hostUiSmokeSaved") {
				const requestId = event.data.requestId;
				const pending = pendingHostUiSmokeSaves.get(requestId);
				if (pending) {
					pendingHostUiSmokeSaves.delete(requestId);
					const err = typeof event.data.error === "string" ? event.data.error : "";
					if (err) {
						pending.reject(new Error(err));
					} else {
						pending.resolve();
					}
				}
			} else if (event.data && event.data.command === "modelFamilyVersionsUpdated") {
				applyModelFamilyVersionsUpdated(event.data);
			} else if (event.data && event.data.command === "hostUiSmokeRun") {
				void runHostUiSmokeConfig(event.data);
			}
		});
		try {
		const restoredModel = typeof restoredState.modelRuntimeId === "string" ? presets.find((preset) => preset.runtimeId === restoredState.modelRuntimeId) : undefined;
		const preferredProvider = restoredModel?.provider || (typeof restoredState.provider === "string" && byProvider[restoredState.provider] ? restoredState.provider : "") || initialSelection.provider;
		if (preferredProvider && byProvider[preferredProvider]) $("provider").value = preferredProvider;
		const persistedWriteScope = typeof restoredState.configWriteScope === "string" ? restoredState.configWriteScope : configuredWriteScope;
		if (["auto", "workspace", "global"].includes(persistedWriteScope)) {
			$("configWriteScope").value = persistedWriteScope;
		}
		renderVisionProxyOptions($("visionProxyDefault"), configuredVisionProxyDefault, { allowDisable: false });
		refreshModels(restoredModel?.provider === selectedProvider() ? restoredModel.runtimeId : initialSelection.modelRuntimeId);
		if (typeof restoredState.scrollY === "number") setTimeout(() => window.scrollTo(0, restoredState.scrollY), 0);
		window.addEventListener("scroll", () => persistState(), { passive: true });
		} finally {
			vscode.postMessage({ command: "hostUiSmokeReady" });
		}
		document.getElementById("settings").addEventListener("click", () => post("openSettings"));
		document.getElementById("export").addEventListener("click", () => post("exportModels"));
		document.getElementById("import").addEventListener("click", () => post("importModels"));
		document.getElementById("output").addEventListener("click", () => post("showOutput"));
		document.getElementById("selectPromptPreset").addEventListener("click", () => post("selectPromptPreset"));
		document.getElementById("openPromptPresetFolder").addEventListener("click", () => post("openPromptPresetFolder"));
		document.getElementById("saveVisionProxyPrompt").addEventListener("click", () => post("saveVisionProxyPrompt", {
			prompt: $("visionProxyCustomPrompt").value
		}));
		document.getElementById("saveVisionProxyBase").addEventListener("click", () => post("saveVisionProxyBase", { visionProxy: {
			enabled: $("visionProxyEnabled").checked,
			defaultModelId: $("visionProxyDefault").value
		}}));
		document.getElementById("addProviderBtn").addEventListener("click", () => {
			const input = $("newProviderInput");
			const value = input ? input.value.trim() : "";
			if (!value) { $("addProviderStatus").textContent = "${escapeJs(text.addProviderEmpty)}"; return; }
			$("addProviderStatus").textContent = "";
			post("addProvider", { provider: value });
		});
		document.getElementById("deleteModelBtn")?.addEventListener("click", () => {
			const m = currentPreset();
			if (!m || isReadOnlyPreset(m)) return;
			post("deleteModel", { runtimeId: m.runtimeId });
		});
		document.querySelectorAll(".providerSetKey").forEach((btn) => {
			btn.addEventListener("click", () => {
				const provider = btn.getAttribute("data-provider");
				if (provider) post("setProviderKey", { provider });
			});
		});
		document.querySelectorAll(".providerSelect").forEach((btn) => {
			btn.addEventListener("click", () => {
				const provider = btn.getAttribute("data-provider");
				if (!provider) return;
				$("provider").value = provider;
				refreshModels();
				rememberSelection();
			});
		});
		document.querySelectorAll(".providerDelete").forEach((btn) => {
			btn.addEventListener("click", () => {
				const provider = btn.getAttribute("data-provider");
				if (provider) post("deleteProvider", { provider });
			});
		});
	</script>
</body>
</html>`;
}

async function getKeyedProviders(secrets: vscode.SecretStorage, providers: string[]): Promise<string[]> {
	const keyed: string[] = [];
	for (const provider of providers) {
		if (await secrets.get(providerSecretKey(provider))) {
			keyed.push(provider);
		}
	}
	return keyed;
}

async function getVisionProxyCandidates(models: readonly ModelConfig[]): Promise<Array<{ id: string; label: string; detail: string }>> {
	const out = new Map<string, { id: string; label: string; detail: string }>();
	for (const model of models) {
		if (model.vision) {
			const id = getRuntimeModelId(model);
			out.set(id, {
				id,
				label: `${model.displayName ?? model.id} (${model.providerDisplayName ?? model.provider})`,
				detail: id
			});
		}
	}
	if (process.env.COPILOT_BRO_UI_SMOKE === "1") {
		return Array.from(out.values()).sort((a, b) => a.label.localeCompare(b.label));
	}
	try {
		const lmModels = await Promise.race([
			vscode.lm.selectChatModels(),
			new Promise<readonly vscode.LanguageModelChat[]>((resolve) => setTimeout(() => resolve([]), 1500))
		]);
		for (const model of lmModels) {
			const capabilities = (model as unknown as { capabilities?: { imageInput?: boolean } }).capabilities;
			if (model.vendor !== "extendedModels") {
				out.set(model.id, {
					id: model.id,
					label: `${model.name} (${model.vendor}${capabilities?.imageInput ? " · vision" : ""})`,
					detail: model.id
				});
			}
		}
	} catch {
		// The configuration page still shows extension vision models if Copilot models are unavailable.
	}
	return Array.from(out.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function mergeRuntimeModels(primary: readonly ModelConfig[], wrapped: readonly ModelConfig[]): ModelConfig[] {
	const out = new Map<string, ModelConfig>();
	for (const model of primary) {
		out.set(getRuntimeModelId(model), model);
	}
	for (const model of wrapped) {
		out.set(getRuntimeModelId(model), model);
	}
	return Array.from(out.values());
}

function isCopilotAutoModel(id: string, vendor: string): boolean {
	const normalizedId = id.trim().toLowerCase();
	const normalizedVendor = vendor.trim().toLowerCase();
	if (!normalizedId.includes("auto")) {
		return false;
	}
	return normalizedVendor === "copilot"
		|| normalizedVendor === "copilot-cli"
		|| normalizedVendor === "github.copilot";
}

const UI_TEXT = {
	zh: {
		title: "Copilot Bro",
		language: "界面语言",
		languageTip: "选择配置页面显示语言（中文或 English），会写入 VS Code 设置。",
		intro: "在 Copilot Chat 模型选择器中使用扩展提供的模型。当前内置预设为",
		enabled: "启用",
		disabled: "禁用",
		configuredProviders: "已配置供应商：",
		defaultKeySet: "已设置默认 API Key",
		none: "无",
		settings: "打开 Settings JSON",
		settingsTip: "打开与当前默认保存范围（工作区或全局）对应的 Settings JSON 文件。",
		configWriteScope: "默认保存范围",
		configWriteScopeTip: "尚未在任何 settings.json 中配置的项，首次修改时写入此范围。默认「全局」写入用户 settings.json，避免未配置时污染项目内工作区文件；选「工作区」则首次写入工作区 settings（常为 .vscode/settings.json）。已存在的字段按合并后的有效值归属读写（工作区文件夹 > 工作区 > 用户），且只更新该字段所在层。",
		configWriteScopeWorkspace: "工作区",
		configWriteScopeGlobal: "全局（用户）",
		key: "设置供应商 API Key",
		keyTip: "把 API Key 保存到本机 SecretStorage。不会写入 settings.json 或导出文件。",
		export: "导出模型配置",
		exportTip: "导出模型配置。敏感字段和 API Key 会被过滤。",
		import: "导入模型配置",
		importTip: "从 JSON 文件导入模型配置。导入文件不应包含 API Key。",
		output: "显示诊断输出",
		outputTip: "打开 Copilot Bro 输出通道，查看已脱敏的诊断日志。",
		visionSettings: "识图设置 / Vision Settings",
		visionSettingsHelp: "统一管理识图代理基础配置、会话内调度策略、完整性校验与预处理输出策略。",
		visionProxy: "识图代理基础配置",
		visionProxyHelp: "模型可按代理配置先调用另一个支持图片输入的模型生成图片描述，再由当前模型继续回答。留空默认模型时会自动选择可用的内置 Copilot 视觉模型。",
		visionProxyEnabled: "启用识图代理",
		visionProxyEnabledTip: "仅对模型级识图代理留空的模型生效。",
		visionProxyDefault: "默认视觉模型 ID",
		visionProxyDefaultTip: "填写任意已安装且支持 imageInput 的模型 ID，留空则自动选择内置 Copilot 视觉模型。",
		visionProxyAuto: "自动选择可用视觉模型",
		visionProxyDisabled: "禁用识图代理",
		visionProxyUnknown: "当前配置，未在候选列表中",
		visionProxyPrompt: "图片描述 Prompt",
		visionProxyPromptTip: "发送给视觉代理模型的提示词，用于把图片转成当前模型可读的文本描述。",
		visionProxyPromptSection: "图片描述 Prompt",
		visionProxyPromptHelp: "该提示词会在所有识图代理请求中注入，用于稳定图片描述质量。",
		saveVisionProxyPrompt: "保存图片描述 Prompt",
		saveVisionProxyPromptTip: "单独保存图片描述 Prompt，不影响识图代理基础开关与默认模型。",
		saveVisionProxyBase: "保存识图代理基础配置",
		saveVisionProxyBaseTip: "保存启用状态与默认视觉模型。",
		savedVisionProxy: "已保存识图代理设置。",
		savedVisionProxyPrompt: "已保存图片描述 Prompt。",
		saveSection: "保存本组设置",
		saveSectionTip: "保存当前配置分组到 settings.json。",
		savedSection: "已保存当前配置分组。",
		operationFailed: "操作失败，请查看错误信息。",
		promptPresets: "预设提示词",
		promptPresetsHelp: "选择一个 *.copilot-bro.prompt.md 预设后，它会对所有 Copilot Bro 请求强制生效，并在上下文压缩后自动重注入。",
		currentPromptPreset: "当前预设：",
		availablePromptPresets: "可用预设数量：",
		selectPromptPreset: "选择预设提示词",
		selectPromptPresetTip: "从内置、全局和工作区预设中选择一个当前要使用的提示词。",
		openPromptPresetFolder: "打开全局预设文件夹",
		openPromptPresetFolderTip: "打开全局 *.copilot-bro.prompt.md 文件夹，可添加自己的 Markdown 预设。",
		editor: "供应商模型编辑器",
		editorHelp: "先在左侧选供应商（含 copilot 内置模型），中间选/增删模型，右侧编辑模型细节后保存。API Key 只保存在本机 SecretStorage。",
		providerListTitle: "供应商列表",
		providerListHelp: "每行包含：供应商 Key、设置 API Key（🔑；已配置为绿色底色，未配置为灰色）、删除按钮（仅自定义供应商）。copilot 供应商下包含可用内置模型。",
		providerModelListTitle: "供应商与模型列表",
		providerModelListHelp: "当前供应商的 Base URL 与模型滚动列表。可新增自定义模型并立即进入右侧详细配置。",
		modelDetailTitle: "模型详细配置",
				modelDetailHelp: "保持展示名称优先，支持覆盖默认参数与推荐值；模型 Base URL 统一使用供应商 Base URL，保存后立即写入 settings.json。",
		provider: "供应商",
		providerTip: "选择模型所属供应商。带 ✓ 表示该供应商已在本机保存 API Key。",
		providerOptionTip: "选择该供应商后，模型列表会显示它的官方预设和本地覆盖配置。",
		model: "模型",
		modelTip: "选择要编辑的模型。保存后会保留当前选择并应用到扩展配置。",
		modelOptionTip: "选择此模型以查看和修改它的常用参数。",
		modelVersion: "模型版本 ID",
		modelVersionTip: "同一模型族下的 API model 字段；切换版本会更新请求所用的模型 ID，族名称保持不变。",
		addModelVersionTip: "添加自定义版本 ID（写入 modelFamilyCustomVersions）。",
		removeModelVersionTip: "删除当前选中的自定义版本 ID（内置版本不可删）。",
		addModelVersionEmpty: "请先填写要添加的版本 ID。",
		modelVersionUpdated: "模型版本列表已更新。",
		providerEndpoint: "接入区域",
		providerEndpointTip: "从目录选择多区域网关；切换区域会自动保存。选择「自定义 URL」后编辑 Base URL 并点击保存。",
		providerEndpointCustom: "自定义 URL",
		saveProviderGateway: "保存",
		saveProviderGatewayTip: "保存自定义供应商 Base URL（不写入单个模型配置）。",
		saveProviderEndpoint: "保存",
		saveProviderEndpointTip: "保存接入区域与供应商 Base URL（不写入单个模型配置）。",
		providerEndpointSaving: "正在保存供应商网关…",
		providerEndpointSaved: "供应商网关已保存。",
		providerBaseUrl: "供应商 Base URL",
		providerBaseUrlTip: "当前供应商的统一 Base URL；由供应商配置持有，模型保存时不会写入。",
		displayName: "显示名称",
		displayNameTip: "模型在 VS Code / Copilot 模型选择器中的名称。",
		category: "Category",
		categoryTip: "模型分类标签，用于列表分辨与运营标注（如 Coding / Vision / Fast）。",
		temperature: "Temperature",
		temperatureTip: "采样温度。较低更稳定，较高更发散。默认偏向充分思考模型的推荐值。",
		topP: "Top P",
		topPTip: "核采样范围。通常保持供应商推荐值即可。",
		maxOutput: "最大输出 Tokens",
		maxOutputTip: "模型单次回答允许生成的最大 token 数。越大越适合长任务，但成本也可能更高。",
		thinking: "Thinking",
		thinkingTip: "控制模型是否启用思考模式。默认尽量启用，除非模型不支持。",
		reasoning: "Reasoning Effort",
		reasoningTip: "推理强度。high/max 更适合复杂编码、重构和 Agent 任务。",
		vision: "视觉输入",
		visionTip: "仅声明该模型本身是否支持原生图片输入，不决定是否使用识图代理。",
		modelVisionProxy: "模型级视觉代理",
		modelVisionProxyTip: "完全决定当前模型的识图代理行为。留空表示使用全局识图代理设置；选择“禁用识图代理”表示禁用该模型代理；填写模型 ID 表示强制使用该代理；不能填当前模型自己。",
		modelVisionProxyAuto: "使用全局默认 / 自动选择",
		toolCalling: "工具调用 / Agent",
		toolCallingTip: "声明模型是否支持 function calling。Agent 模式通常需要开启。",
		save: "保存本地模型覆盖",
		saveTip: "保存当前模型参数到 settings.json，并保留当前页面选择。API Key 不会保存。",
		saved: "已保存当前模型参数，当前页面状态已保留。",
		presets: "官方预设",
		presetsHelp: "个预设，覆盖 DeepSeek、智谱、MiniMax、Kimi 和 Qwen。",
		addNewModel: "▶ 添加新模型",
		customProvider: "供应商 Key",
		customProviderTip: "自定义供应商标识，用于分组 API Key，例如 my-provider。",
		customModel: "模型 ID",
		customModelTip: "供应商 API 使用的真实模型名，例如 my-model。",
		context: "上下文长度",
		contextTip: "模型支持的最大上下文 token 数。",
		saveCustom: "添加自定义模型",
		saveCustomTip: "保存自定义供应商和模型配置。API Key 仍需通过 Set Provider API Key 单独保存。",
		addModelEmpty: "请先选择供应商并填写模型 ID。",
		noModelsForProvider: "当前供应商下暂无模型，可先在中间区域添加模型。",
		customHelp: "保存后，请使用“设置供应商 API Key”为该 provider 保存本地密钥。密钥只保存在 SecretStorage。",
		providerManager: "供应商管理",
		providerManagerHelp: "管理所有供应商及其 API Key。内置预设供应商不可删除，仅可更新 Key。",
		setKey: "设置 Key",
		addProvider: "添加供应商",
		addProviderTip: "输入自定义供应商标识（如 my-provider），点击添加后可为其设置 API Key。",
		addProviderEmpty: "请输入供应商标识。",
		deleteProvider: "删除供应商",
		deleteProviderTip: "删除自定义供应商及其所有自定义模型。内置预设供应商不可删除。",
		deleteModel: "删除模型",
		deleteModelTip: "删除当前选中的自定义模型（仅限自定义添加的模型）。",
		contextNotRecommended: "（不建议更改 / Not recommended to change）"
	},
	en: {
		title: "Copilot Bro",
		language: "UI Language",
		languageTip: "Choose Chinese or English for this configuration page. The choice is saved to VS Code settings.",
		intro: "Use extension-provided models from the Copilot Chat model picker. Built-in presets are currently",
		enabled: "enabled",
		disabled: "disabled",
		configuredProviders: "Configured providers:",
		defaultKeySet: "default API key set",
		none: "none",
		settings: "Open Settings JSON",
		settingsTip: "Open the Settings JSON file that matches the current save scope (workspace or global).",
		configWriteScope: "Default Save Scope",
		configWriteScopeTip: "New fields save here first. Default Global writes to User settings so the repo is not touched until you choose Workspace (often .vscode/settings.json). Existing fields read/write at the layer that supplies the merged value (folder > workspace > user); only that field is updated.",
		configWriteScopeWorkspace: "Workspace",
		configWriteScopeGlobal: "Global (User)",
		key: "Set Provider API Key",
		keyTip: "Store an API key in local SecretStorage. It is never written to settings.json or exports.",
		export: "Export Models",
		exportTip: "Export model settings. Sensitive fields and API keys are filtered.",
		import: "Import Models",
		importTip: "Import model settings from JSON. Imported files should not contain API keys.",
		output: "Show Diagnostics Output",
		outputTip: "Open the Copilot Bro output channel with redacted diagnostic logs.",
		visionSettings: "Vision Settings",
		visionSettingsHelp: "Manage vision proxy, in-session orchestration behavior, integrity checks, and preprocessing/output policy in one place.",
		visionProxy: "Vision Proxy",
		visionProxyHelp: "Models can follow their proxy settings to ask another image-capable model to describe images first, then continue with the current model. An empty default auto-picks an installed Copilot vision model.",
		visionProxyEnabled: "Enable vision proxy",
		visionProxyEnabledTip: "Applies only to models whose model-level vision proxy is left empty.",
		visionProxyDefault: "Default vision model ID",
		visionProxyDefaultTip: "Use any installed image-capable model ID. Leave empty to auto-pick a built-in Copilot vision model.",
		visionProxyAuto: "Auto-pick an available vision model",
		visionProxyDisabled: "Disable vision proxy",
		visionProxyUnknown: "current setting, not in candidates",
		visionProxyPrompt: "Image description prompt",
		visionProxyPromptTip: "Prompt sent to the vision proxy model to turn images into text for the current model.",
		visionProxyPromptSection: "Image Description Prompt",
		visionProxyPromptHelp: "This prompt is injected into all vision-proxy requests to stabilize image descriptions.",
		saveVisionProxyPrompt: "Save Image Description Prompt",
		saveVisionProxyPromptTip: "Save only the image description prompt without changing proxy base settings.",
		saveVisionProxyBase: "Save Vision Proxy Base Settings",
		saveVisionProxyBaseTip: "Save proxy enablement and default vision model selection.",
		savedVisionProxy: "Vision proxy settings saved.",
		savedVisionProxyPrompt: "Image description prompt saved.",
		saveSection: "Save Section Settings",
		saveSectionTip: "Save the current settings group to settings.json.",
		savedSection: "Current settings section saved.",
		operationFailed: "Operation failed. Please check the error details.",
		promptPresets: "Prompt Presets",
		promptPresetsHelp: "Select a *.copilot-bro.prompt.md preset and Copilot Bro enforces it for all request paths, with automatic reinjection after compaction.",
		currentPromptPreset: "Current preset:",
		availablePromptPresets: "Available presets:",
		selectPromptPreset: "Select Prompt Preset",
		selectPromptPresetTip: "Choose a preset from built-in, global, or workspace Markdown files.",
		openPromptPresetFolder: "Open Global Preset Folder",
		openPromptPresetFolderTip: "Open the global folder for your own *.copilot-bro.prompt.md files.",
		editor: "Provider Model Editor",
		editorHelp: "Pick a provider (including built-in models under copilot) on the left, manage model list in the middle, and edit model details on the right. API keys stay in local SecretStorage.",
		providerListTitle: "Provider List",
		providerListHelp: "Each row includes provider key, API key action (🔑; configured keys use a green filled button, unset keys are gray), and a delete button (custom providers only). The copilot provider includes available built-in models.",
		providerModelListTitle: "Provider And Model List",
		providerModelListHelp: "Configure provider base URL, browse model list, and add/remove models from this provider.",
		modelDetailTitle: "Model Detail",
				modelDetailHelp: "Display name is prioritized in lists. Model base URLs use the provider base URL only, and save writes overrides to settings.json immediately.",
		provider: "Provider",
		providerTip: "Select the provider. A ✓ means a local API key exists for this provider.",
		providerOptionTip: "Select this provider to view official presets and local overrides.",
		model: "Model",
		modelTip: "Select the model to edit. Saving keeps the current selection and applies the extension setting immediately.",
		modelOptionTip: "Select this model to view and edit common parameters.",
		modelVersion: "Model version ID",
		modelVersionTip: "API model field within the same model family. Changing version updates the request id while the family name stays stable.",
		addModelVersionTip: "Add a custom version id (persisted to modelFamilyCustomVersions).",
		removeModelVersionTip: "Remove the selected custom version id (built-in catalog ids cannot be removed).",
		addModelVersionEmpty: "Enter a version id to add first.",
		modelVersionUpdated: "Model version list updated.",
		providerEndpoint: "Endpoint",
		saveProviderEndpoint: "Save",
		saveProviderEndpointTip: "Save endpoint region and provider base URL (provider-level only, not per model).",
		providerEndpointSaving: "Saving provider gateway…",
		providerEndpointSaved: "Provider gateway saved.",
		providerEndpointTip: "Pick a regional gateway from the catalog; region changes save automatically. For Custom URL, edit Base URL and click Save.",
		providerEndpointCustom: "Custom URL",
		saveProviderGateway: "Save",
		saveProviderGatewayTip: "Save custom provider base URL (provider-level only, not per model).",
		providerBaseUrl: "Provider Base URL",
				providerBaseUrlTip: "Unified base URL for models under the selected provider.",
		displayName: "Display Name",
		displayNameTip: "Name shown in the VS Code / Copilot model picker.",
		category: "Category",
		categoryTip: "Model category tag used for easier list recognition, for example Coding / Vision / Fast.",
		temperature: "Temperature",
		temperatureTip: "Sampling temperature. Lower is more stable, higher is more diverse. Defaults favor reasoning where supported.",
		topP: "Top P",
		topPTip: "Nucleus sampling value. Usually keep the provider recommendation.",
		maxOutput: "Max Output Tokens",
		maxOutputTip: "Maximum tokens the model may generate in one response. Larger values help long tasks but may cost more.",
		thinking: "Thinking",
		thinkingTip: "Controls whether model thinking mode is enabled. Defaults enable it where supported.",
		reasoning: "Reasoning Effort",
		reasoningTip: "Reasoning depth. high/max is better for complex coding, refactoring, and Agent tasks.",
		vision: "Vision Input",
		visionTip: "Declare only whether this model itself supports native image input. It does not decide proxy behavior.",
		modelVisionProxy: "Model Vision Proxy",
		modelVisionProxyTip: "Fully controls this model's vision proxy behavior. Empty uses global defaults, selecting Disable turns proxying off for this model, and a model ID forces that proxy. Do not set the current model itself.",
		modelVisionProxyAuto: "Use global default / auto-pick",
		toolCalling: "Tool Calling / Agent",
		toolCallingTip: "Declare whether this model supports function calling. Agent mode usually requires it.",
		save: "Save Local Model Override",
		saveTip: "Save current model parameters to settings.json while keeping the current page selection. API keys are not saved.",
		saved: "Current model parameters saved; page state was preserved.",
		presets: "Official Presets",
		presetsHelp: "presets across DeepSeek, Zhipu, MiniMax, Kimi, and Qwen.",
		addNewModel: "▶ Add New Model",
		customProvider: "Provider Key",
		customProviderTip: "Custom provider identifier used for API key grouping, for example my-provider.",
		customModel: "Model ID",
		customModelTip: "Actual model name used by the provider API, for example my-model.",
		context: "Context Length",
		contextTip: "Maximum context window supported by the model.",
		saveCustom: "Add Custom Model",
		saveCustomTip: "Save a custom provider/model. API key still needs Set Provider API Key.",
		addModelEmpty: "Select a provider and fill in model ID first.",
		noModelsForProvider: "No models under this provider yet. Add one from the middle pane first.",
		customHelp: "After saving, use Set Provider API Key for this provider. Keys stay in local SecretStorage only.",
		providerManager: "Provider Management",
		providerManagerHelp: "Manage all providers and their API keys. Built-in preset providers cannot be deleted — only their keys can be updated.",
		setKey: "Set Key",
		addProvider: "Add Provider",
		addProviderTip: "Enter a custom provider identifier (e.g. my-provider) and click Add to register it for API key management.",
		addProviderEmpty: "Please enter a provider identifier.",
		deleteProvider: "Delete Provider",
		deleteProviderTip: "Delete this custom provider and all its custom models. Built-in preset providers cannot be deleted.",
		deleteModel: "Delete Model",
		deleteModelTip: "Delete the selected custom model (only applies to custom-added models).",
		contextNotRecommended: "(not recommended to change)"
	}
};

type ConfigPanelText = typeof UI_TEXT.zh & typeof UI_TEXT.en;
type Phase1VisibleSection = ReturnType<typeof getVisiblePhase1Sections>[number];

function renderPhase1SectionCard(
	section: Phase1VisibleSection,
	value: Record<string, unknown>,
	language: "zh" | "en",
	text: ConfigPanelText
): string {
	return `<div class="card">
		<h2>${escapeHtml(language === "en" ? section.title.en : section.title.zh)}</h2>
		<p class="muted">${escapeHtml(language === "en" ? section.help.en : section.help.zh)}</p>
		<div class="grid">${section.fields.map((field) => renderPhase1Field(section.key, field, value[field.key], language)).join("")}</div>
		<button id="phase1-save-${escapeHtml(section.key)}" title="${escapeHtml(text.saveSectionTip)}">${escapeHtml(text.saveSection)}</button>
		<div id="phase1-status-${escapeHtml(section.key)}" class="muted small" aria-live="polite"></div>
	</div>`;
}

function getNonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let text = "";
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

function renderLoadingHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Copilot Bro Model Settings</title>
</head>
<body>
	<p>Loading Copilot Bro Model Settings...</p>
</body>
</html>`;
}

function renderErrorHtml(message: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Copilot Bro Model Settings</title>
</head>
<body>
	<h1>Copilot Bro Model Settings</h1>
	<p>The settings panel failed to render.</p>
	<pre>${escapeHtml(message)}</pre>
	<p>Open the Copilot Bro output channel and retry if you need more details.</p>
</body>
</html>`;
}

function escapeHtml(value: unknown): string {
	return (typeof value === "string" ? value : String(value ?? ""))
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeJs(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
