import * as vscode from "vscode";
import process from "node:process";
import { getProviderEnvironmentVariableName, HOST_UI_SMOKE_API_KEY_PROVIDERS } from "./e2e/hostUi/env";
import { findModelConfig, getRuntimeModelId, getSettings, listProviders } from "./config/settings";
import {
	isHostUiSmokeMode,
	registerHostUiSmokeCommands
} from "./e2e/hostUi/registerSmokeCommands";
import { hasWorkspaceFolders, normalizeDefaultSaveScope, toVsCodeConfigurationTarget } from "./config/configScope";
import {
	mergeProviderEndpointsPreference,
	normalizeProviderEndpointsConfig
} from "./config/providerEndpoints";
import { Logger } from "./logger";
import { clearApiKey, promptForApiKey, providerSecretKey, setDefaultApiKey } from "./secrets";
import { ConfigPanel } from "./ui/configPanel";
import { readMergedCustomModelsFromInspect, resolveDefaultSaveTarget } from "./ui/configPanelPersistence";
import { ExtendedModelsProvider } from "./provider";
import { listPromptPresets, openGlobalPromptPresetFolder, selectPromptPreset } from "./promptPresets";
import { getCachedWrappedLanguageModelConfigs, refreshWrappedLanguageModelConfigs } from "./vscodeLmWrapper";
import { bindExtensionSmokeLogger } from "./e2e/hostUi/extensionSmokeLogger";
import { maybeAutoRunHostUiSmokeChatSuiteAfterGithubPreflight } from "./e2e/hostUi/extensionSmokeAutoRun";
import { HOST_UI_SMOKE_MIN_PNG } from "./e2e/hostUi/chat/integration";
import {
	bindExtensionSmokeContext,
	bindExtensionSmokeWrappedRefresh,
	getHostUiSmokeModelKind,
	getHostUiSmokeModelSelector,
	getHostUiSmokePrompt,
	HOST_UI_SMOKE_PROMPT
} from "./e2e/hostUi/extensionSmokeRuntime";
import { HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE } from "./e2e/hostUi/fixtures/vision";
import { readHostUiSmokeTestButtonBytes } from "./e2e/hostUi/probes/p6P7Probe";
import {
	handleHostUiSmokeChatParticipantRequest,
	maybeAutoOpenHostUiSmokeChat,
	openHostUiSmokeChat,
	runHostUiSmokeChatSuite,
	submitHostUiSmokeChatRequest
} from "./e2e/hostUi/extensionSmokeChat";
import { delay } from "./e2e/hostUi/extensionSmokeAutoRun";
import { runHostUiSmokeP6P7RealAssetsProbe } from "./e2e/hostUi/probes/p6P7Probe";
import { HOST_UI_SMOKE_PROVIDER_PROBE_TARGETS, resolveHostUiSmokeProviderProbeRuntimeId } from "./e2e/hostUi/probes/providerProbePlan";
import {
	buildVisionEvidenceContractSnapshot,
	finalizeNativeVisionStructuredHandoff
} from "./visionProtocol/nativeVisionStructuredHandoff";
import {
	clearVisionEvidenceStoreForTests,
	createVisionEvidenceId,
	upsertVisionEvidenceRecord
} from "./visionProtocol/visionEvidenceStore";
import { createVisionTaskStack } from "./visionProtocol/visionTaskStack";
import { runVisionJsonRepairProbe } from "./visionProtocol/visionJsonRepairProbe";
import { clearLongTermMemoryForTests, upsertMemoryRecord } from "./memory/longTermMemory";
import { applyLongTermMemoryBudget } from "./memory/memoryTokenBudget";
import { estimateOpenAIMessageTokens } from "./openaiCompat/messages";
import { isVisionProxyEnabledForModel, resolveVisionProxyMessages } from "./visionProxy";
import {
	getLastHostUiSmokeVisionProgressFlush,
	resetHostUiSmokeVisionProgressCapture
} from "./toolCooperation/visionProgressReporter";

let logger: Logger | undefined;
let refreshHostUiSmokeWrappedModels: (() => Promise<void>) | undefined;

const HOST_UI_SMOKE_CHINA_ENDPOINT_PROFILES: Record<string, string> = {
	qwen: "dashscope-cn",
	dashscope: "dashscope-cn",
	kimi: "moonshot-cn",
	moonshot: "moonshot-cn",
	minimax: "minimax-cn"
};

function shouldEnableWrappedModelRefresh(): boolean {
	return !isHostUiSmokeMode() || process.env.COPILOT_BRO_UI_SMOKE_INCLUDE_WRAPPED_MODELS === "1";
}

export function activate(context: vscode.ExtensionContext): void {
	logger = new Logger();
	bindExtensionSmokeLogger(logger);
	bindExtensionSmokeContext(context);
	try {
		logger.setLevel(getSettings().logLevel);
	} catch (error) {
		logger.warn("settings.read.failed.on-activate", {
			message: error instanceof Error ? error.message : String(error)
		});
	}
	const shouldRefreshWrappedModels = shouldEnableWrappedModelRefresh();

	const provider = new ExtendedModelsProvider(context, context.secrets, logger, () => getSettings());
	const refreshWrappedModels = async (): Promise<void> => {
		await refreshWrappedLanguageModelConfigs(logger);
		provider.refreshModels();
	};
	refreshHostUiSmokeWrappedModels = refreshWrappedModels;
	bindExtensionSmokeWrappedRefresh(refreshWrappedModels);
	const subscriptions: vscode.Disposable[] = [
		logger,
		provider
	];
	try {
		subscriptions.push(vscode.lm.registerLanguageModelChatProvider("extendedModels", provider));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error("provider.register.failed", { message });
		void vscode.window.showWarningMessage("Copilot Bro: language model provider registration failed. Settings UI remains available. Check diagnostics output for details.");
	}
	context.subscriptions.push(
		...subscriptions,
		vscode.commands.registerCommand("extendedModels.manage", async () => {
			try {
				await ConfigPanel.open(context);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger?.error("config-panel.open.failed", { message });
				vscode.window.showErrorMessage(`Copilot Bro: Failed to open settings panel: ${message}`);
			}
		}),
		vscode.commands.registerCommand("extendedModels.openModelSettings", async () => {
			try {
				await ConfigPanel.open(context);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger?.error("config-panel.open.failed", { message });
				vscode.window.showErrorMessage(`Copilot Bro: Failed to open settings panel: ${message}`);
			}
		}),
		vscode.commands.registerCommand("extendedModels.openUiSettings", async () => {
			try {
				await ConfigPanel.open(context);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger?.error("config-panel.open.failed", { message });
				vscode.window.showErrorMessage(`Copilot Bro: Failed to open settings panel: ${message}`);
			}
		}),
		vscode.commands.registerCommand("extendedModels.openScopedSettingsJson", async (scope?: unknown) => {
			const preference = scope === "workspace" || scope === "global"
				? scope
				: vscode.workspace.getConfiguration("extendedModels").get<"workspace" | "global">("configWriteScope", "global");
			if (preference === "workspace" && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
				await vscode.commands.executeCommand("workbench.action.openWorkspaceSettingsFile");
				return;
			}
			await vscode.commands.executeCommand("workbench.action.openSettingsJson");
		}),
		...registerHostUiSmokeCommands(context, provider, logger, {
			openChat: () => openHostUiSmokeChat(),
			runChatSuite: () => runHostUiSmokeChatSuite(),
			probeProviders: () => runHostUiSmokeProviderProbe(context),
			visionContract: () => runHostUiSmokeVisionContract(),
			visionJsonRepair: () => runHostUiSmokeVisionJsonRepair(),
			visionProbe: () => runHostUiSmokeVisionProbe(),
			screenshotPageVision: () => runHostUiSmokeScreenshotPageVisionRoute(),
			visionChatProgress: (broProvider) => runHostUiSmokeVisionChatProgressSmoke(broProvider),
			p6P7RealAssets: (smokeLogger) => runHostUiSmokeP6P7RealAssetsProbe(smokeLogger),
			agentSmokeBudgeted: () => runHostUiSmokeAgentSmokeBudgeted(),
			runRequest: () => runHostUiSmokeRequest(),
			submitChatRequest: () => submitHostUiSmokeChatRequest()
		}),
		vscode.commands.registerCommand("extendedModels.setApiKey", () => setDefaultApiKey(context.secrets)),
		vscode.commands.registerCommand("extendedModels.setProviderApiKey", async (providerName?: unknown) => {
			const changedProvider = await setProviderApiKey(context, providerName);
			if (changedProvider) {
				provider.refreshModels();
			}
		}),
		vscode.commands.registerCommand("extendedModels.clearApiKey", async () => {
			await clearSelectedApiKey(context);
			provider.refreshModels();
		}),
		vscode.commands.registerCommand("extendedModels.showOutput", () => logger?.show()),
		vscode.commands.registerCommand("extendedModels.exportModels", () => exportModels()),
		vscode.commands.registerCommand("extendedModels.importModels", () => importModels()),
		vscode.commands.registerCommand("extendedModels.selectPromptPreset", () => selectPromptPreset(context)),
		vscode.commands.registerCommand("extendedModels.openPromptPresetFolder", () => openGlobalPromptPresetFolder(context)),
		vscode.commands.registerCommand("extendedModels.clearCaches", async () => {
			// Clear workspace storage selections
			await context.workspaceState.update("extendedModels.configPanel.selection", undefined);
			// Clear catalog state
			await context.globalState.update("extendedModels.providerModelCatalog", undefined);
			// Close and reopen config panel to refresh
			await ConfigPanel.open(context);
			vscode.window.showInformationMessage("Copilot Bro: Caches cleared and config panel refreshed.");
		}),
		...(shouldRefreshWrappedModels
			? [vscode.lm.onDidChangeChatModels(() => {
				void refreshWrappedModels().catch((error) => logger?.warn("wrapper.models.refresh.host-change.failed", {
					message: error instanceof Error ? error.message : String(error)
				}));
			})]
			: []),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("extendedModels.logLevel")) {
				try {
					logger?.setLevel(getSettings().logLevel);
				} catch (error) {
					logger?.warn("settings.read.failed.on-config-change", {
						message: error instanceof Error ? error.message : String(error)
					});
				}
			}
			if (event.affectsConfiguration("extendedModels")) {
				try {
					provider.refreshModels();
				} catch (error) {
					logger?.warn("settings.read.failed.on-config-refresh", {
						message: error instanceof Error ? error.message : String(error)
					});
				}
			}
		})
	);
	if (isHostUiSmokeMode()) {
		context.subscriptions.push(vscode.chat.createChatParticipant("bro-smoke", handleHostUiSmokeChatParticipantRequest));
	}

	const prepareHostUiSmoke = maybePrepareHostUiSmokeState(context)
		.then(() => {
			provider.refreshModels();
		})
		.then(() => maybeSeedHostUiSmokeProviderApiKeys(context));
	logger.info("extension.activated");
	if (shouldRefreshWrappedModels) {
		void refreshWrappedModels().catch((error) => logger?.warn("wrapper.models.refresh.startup.failed", {
			message: error instanceof Error ? error.message : String(error)
		}));
	} else {
		logger.info("wrapper.models.refresh.skipped", {
			reason: "host-ui-smoke"
		});
	}
	void prepareHostUiSmoke.catch((error) => logger?.warn("host-ui-smoke.prepare.failed", {
		message: error instanceof Error ? error.message : String(error)
	}));
	void prepareHostUiSmoke.then(() => maybeAutoOpenHostUiSmokeConfigPanel(context)).catch((error) => logger?.warn("host-ui-smoke.config.auto-open.failed", {
		message: error instanceof Error ? error.message : String(error)
	}));
	void prepareHostUiSmoke.then(() => maybeAutoOpenHostUiSmokeChat()).catch((error) => logger?.warn("host-ui-smoke.chat.auto-open.failed", {
		message: error instanceof Error ? error.message : String(error)
	}));
	void prepareHostUiSmoke.then(() => maybeAutoRunHostUiSmokeRequest()).catch((error) => logger?.warn("host-ui-smoke.request.auto-run.failed", {
		message: error instanceof Error ? error.message : String(error)
	}));
	void prepareHostUiSmoke.then(() => maybeAutoRunHostUiSmokeChatSuiteAfterGithubPreflight(runHostUiSmokeChatSuite)).catch((error) => logger?.warn("host-ui-smoke.chat-suite.auto-run.failed", {
		message: error instanceof Error ? error.message : String(error)
	}));
}

async function maybeSeedHostUiSmokeProviderApiKeys(context: vscode.ExtensionContext): Promise<void> {
	if (!isHostUiSmokeMode()) {
		return;
	}
	const keyed: string[] = [];
	const missing: string[] = [];
	const seededProviders: string[] = [];
	for (const provider of HOST_UI_SMOKE_API_KEY_PROVIDERS) {
		const variableName = getProviderEnvironmentVariableName(provider);
		const apiKey = variableName ? process.env[variableName]?.trim() : undefined;
		const existing = (await context.secrets.get(providerSecretKey(provider)))?.trim();
		if (apiKey) {
			if (existing !== apiKey) {
				await context.secrets.store(providerSecretKey(provider), apiKey);
				seededProviders.push(provider);
			}
			keyed.push(provider);
			continue;
		}
		if (existing) {
			keyed.push(provider);
			continue;
		}
		missing.push(provider);
	}
	logger?.info("host-ui-smoke.api-keys.status", { keyed, missing, seeded: seededProviders });
}

async function seedHostUiSmokeChinaProviderEndpoints(): Promise<void> {
	const configuration = vscode.workspace.getConfiguration("extendedModels");
	let endpoints = normalizeProviderEndpointsConfig(configuration.get("providerEndpoints"));
	for (const [providerKey, profileId] of Object.entries(HOST_UI_SMOKE_CHINA_ENDPOINT_PROFILES)) {
		endpoints = mergeProviderEndpointsPreference(endpoints, providerKey, profileId);
	}
	await configuration.update("providerEndpoints", endpoints, vscode.ConfigurationTarget.Workspace);
	logger?.info("host-ui-smoke.provider-endpoints.china", { endpoints });
}

async function maybePrepareHostUiSmokeState(context: vscode.ExtensionContext): Promise<void> {
	if (!isHostUiSmokeMode()) {
		return;
	}
	await seedHostUiSmokeChinaProviderEndpoints();
	const providers = listProviders(getSettings().models);
	if (providers.length === 0) {
		logger?.info("host-ui-smoke.catalog.reset", { providers: [] });
		return;
	}
	logger?.info("host-ui-smoke.catalog.reset", { providers });
}

async function maybeAutoOpenHostUiSmokeConfigPanel(context: vscode.ExtensionContext): Promise<void> {
	const autoOpen = vscode.workspace.getConfiguration("extendedModels").get<boolean>("hostUiSmokeAutoOpenConfigPanel", false);
	if (!autoOpen) {
		return;
	}
	logger?.info("host-ui-smoke.config.open.start");
	const configSmokeResult = await ConfigPanel.open(context);
	if (configSmokeResult) {
		logger?.info("host-ui-smoke.config.smoke.result", configSmokeResult);
		if (configSmokeResult.providerEndpointUi) {
			logger?.info("host-ui-smoke.config.endpoint.ui", configSmokeResult.providerEndpointUi);
		}
		if (configSmokeResult.modelVersionUi) {
			logger?.info("host-ui-smoke.config.model-version.ui", configSmokeResult.modelVersionUi);
		}
		if (configSmokeResult.qwenCatalogUi) {
			logger?.info("host-ui-smoke.config.qwen-catalog.ui", configSmokeResult.qwenCatalogUi);
		}
	}
	logger?.info("host-ui-smoke.config.open.end");
}

function isUnauthorizedProviderProbeError(message: string): boolean {
	return /\[401\]|unauthorized|invalid api key|invalid_api_key|authorized_error/i.test(message);
}

async function runHostUiSmokeProviderProbe(context: vscode.ExtensionContext): Promise<void> {
	if (!isHostUiSmokeMode()) {
		return;
	}
	const started = Date.now();
	logger?.info("host-ui-smoke.provider.matrix.start", {
		targets: HOST_UI_SMOKE_PROVIDER_PROBE_TARGETS.map((t) => resolveHostUiSmokeProviderProbeRuntimeId(t))
	});
	let ok = 0;
	let skip = 0;
	let fail = 0;
	for (const target of HOST_UI_SMOKE_PROVIDER_PROBE_TARGETS) {
		const envName = getProviderEnvironmentVariableName(target.provider);
		const providerSpecificKey = await context.secrets.get(providerSecretKey(target.provider));
		if (!providerSpecificKey?.trim()) {
			logger?.info("host-ui-smoke.provider.probe.skip", {
				provider: target.provider,
				modelId: target.id,
				reason: "no-provider-secret",
				env: envName ?? "none"
			});
			skip += 1;
			continue;
		}
		const runtimeModelId = resolveHostUiSmokeProviderProbeRuntimeId(target);
		const modelSelector = {
			vendor: "extendedModels" as const,
			id: runtimeModelId,
			family: "oai-compatible"
		};
		const cancellation = new vscode.CancellationTokenSource();
		const timeout = setTimeout(() => cancellation.cancel(), 28_000);
		try {
			const matches = await vscode.lm.selectChatModels(modelSelector);
			const match = matches[0];
			if (!match) {
				throw new Error("selectChatModels returned empty");
			}
			const response = await match.sendRequest(
				[
					vscode.LanguageModelChatMessage.User([
						new vscode.LanguageModelTextPart(HOST_UI_SMOKE_PROMPT)
					])
				],
				{
					justification: `Copilot Bro host UI smoke provider probe (${target.provider})`
				},
				cancellation.token
			);
			let responseText = "";
			for await (const part of response.stream) {
				if (part instanceof vscode.LanguageModelTextPart) {
					responseText += part.value;
				}
			}
			const normalizedText = responseText.trim();
			if (normalizedText !== "BRO_SMOKE_OK_20260506") {
				throw new Error(`unexpected response: ${normalizedText.slice(0, 160)}`);
			}
			logger?.info("host-ui-smoke.provider.probe.ok", {
				provider: target.provider,
				runtimeModelId,
				ms: Date.now() - started
			});
			ok += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isUnauthorizedProviderProbeError(message)) {
				logger?.info("host-ui-smoke.provider.probe.skip", {
					provider: target.provider,
					modelId: target.id,
					runtimeModelId,
					reason: "invalid-api-key",
					env: envName ?? "none"
				});
				skip += 1;
				continue;
			}
			fail += 1;
			logger?.warn("host-ui-smoke.provider.probe.fail", {
				provider: target.provider,
				runtimeModelId,
				message
			});
		} finally {
			clearTimeout(timeout);
			cancellation.dispose();
		}
	}
	logger?.info("host-ui-smoke.provider.matrix.end", {
		ok,
		skip,
		fail,
		ms: Date.now() - started
	});
	if (ok === 0 && fail === 0) {
		logger?.warn("host-ui-smoke.provider.matrix.all-skipped", { skip });
	}
	if (fail > 0) {
		logger?.warn("host-ui-smoke.provider.matrix.partial-failure", { ok, skip, fail });
	}
}

const HOST_UI_SMOKE_VISION_CONTRACT_HASH = "host-ui-smoke-vision-contract-hash";

async function runHostUiSmokeVisionProbe(): Promise<void> {
	if (!isHostUiSmokeMode() || !logger) {
		return;
	}
	const runtimeId = "deepseek-v4-flash::deepseek";
	const settings = getSettings();
	const model = findModelConfig(runtimeId, settings.models);
	if (!model) {
		logger.error("host-ui-smoke.vision.probe.end", { ok: false, message: `model-not-found:${runtimeId}` });
		return;
	}
	if (!isVisionProxyEnabledForModel(model, settings)) {
		logger.error("host-ui-smoke.vision.probe.end", { ok: false, message: "vision-proxy-disabled" });
		return;
	}
	const messages: vscode.LanguageModelChatRequestMessage[] = [
		vscode.LanguageModelChatMessage.User([
			vscode.LanguageModelDataPart.image(HOST_UI_SMOKE_MIN_PNG, "image/png"),
			new vscode.LanguageModelTextPart(
				"Host UI vision proxy probe: describe the attached small PNG; output follows internal vision-proxy contract."
			)
		])
	];
	const cancellation = new vscode.CancellationTokenSource();
	try {
		const resolution = await resolveVisionProxyMessages(messages, model, settings, logger, cancellation.token, {
			reportFailure: true
		});
		const touched =
			(resolution.cacheMissCount ?? 0) > 0 || (resolution.cacheHitCount ?? 0) > 0;
		const ok = resolution.status === "applied" && touched;
		logger.info("host-ui-smoke.vision.probe.end", {
			ok,
			status: resolution.status,
			cacheMissCount: resolution.cacheMissCount,
			cacheHitCount: resolution.cacheHitCount,
			error: resolution.error,
			primaryRuntimeId: getRuntimeModelId(model)
		});
	} catch (error) {
		logger.error("host-ui-smoke.vision.probe.end", {
			ok: false,
			message: error instanceof Error ? error.message : String(error)
		});
	} finally {
		cancellation.dispose();
	}
}

async function runHostUiSmokeVisionChatProgressSmoke(broProvider: ExtendedModelsProvider): Promise<void> {
	if (!isHostUiSmokeMode() || !logger) {
		return;
	}
	resetHostUiSmokeVisionProgressCapture();
	const runtimeId = "deepseek-v4-flash::deepseek";
	const settings = getSettings();
	const model = findModelConfig(runtimeId, settings.models);
	if (!model) {
		logger.error("host-ui-smoke.vision-chat-progress.end", { ok: false, message: `model-not-found:${runtimeId}` });
		return;
	}
	if (!isVisionProxyEnabledForModel(model, settings)) {
		logger.error("host-ui-smoke.vision-chat-progress.end", { ok: false, message: "vision-proxy-disabled" });
		return;
	}
	let screenshotBytes: Uint8Array = HOST_UI_SMOKE_MIN_PNG;
	try {
		screenshotBytes = await readHostUiSmokeTestButtonBytes(HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE);
	} catch {
		// min png fallback
	}
	const messages: vscode.LanguageModelChatRequestMessage[] = [
		vscode.LanguageModelChatMessage.Assistant([
			new vscode.LanguageModelToolCallPart("call-screenshot", "screenshot_page", {})
		]),
		vscode.LanguageModelChatMessage.User([
			new vscode.LanguageModelToolResultPart("call-screenshot", [
				vscode.LanguageModelDataPart.image(screenshotBytes, "image/png")
			]),
			new vscode.LanguageModelTextPart(
				"[host-ui-smoke] screenshot_page vision: describe UI briefly; internal vision progress must stay in thinking block."
			)
		])
	];
	const cancellation = new vscode.CancellationTokenSource();
	const thinkingParts: Array<{ value: string; id?: string }> = [];
	const textParts: string[] = [];
	try {
		const modelInfos = await broProvider.provideLanguageModelChatInformation({ silent: true }, cancellation.token);
		const modelInfo = modelInfos.find((entry) => entry.id === getRuntimeModelId(model) || entry.id === model.id);
		if (!modelInfo) {
			logger.error("host-ui-smoke.vision-chat-progress.end", { ok: false, message: "lm-info-not-found" });
			return;
		}
		await broProvider.provideLanguageModelChatResponse(
			modelInfo,
			messages,
			{} as vscode.ProvideLanguageModelChatResponseOptions,
			{
				report(part) {
					const partName = part.constructor?.name?.toLowerCase() ?? "";
					if (partName.includes("thinking")) {
						const record = part as { value: string; id?: string };
						thinkingParts.push({ value: record.value, id: record.id });
						return;
					}
					if (part instanceof vscode.LanguageModelTextPart) {
						textParts.push(part.value);
					}
				}
			},
			cancellation.token
		);
		const flushMeta = getLastHostUiSmokeVisionProgressFlush();
		const visionThinking = thinkingParts.find((entry) => entry.id === "vision-status");
		const ok =
			flushMeta !== undefined
			&& flushMeta.chunkCount >= 1
			&& flushMeta.containsVisionPrefix === true
			&& (
				flushMeta.usedThinkingPart === true
				|| flushMeta.hasVisionDetailsMarker === true
				|| Boolean(visionThinking?.value.includes("[Vision]"))
			);
		logger.info("host-ui-smoke.vision-chat-progress.end", {
			ok,
			flushMeta,
			visionThinkingId: visionThinking?.id,
			visionThinkingBytes: visionThinking?.value.length ?? 0,
			textPartCount: textParts.length,
			toolName: "screenshot_page"
		});
	} catch (error) {
		const flushMeta = getLastHostUiSmokeVisionProgressFlush();
		logger.error("host-ui-smoke.vision-chat-progress.end", {
			ok: false,
			message: error instanceof Error ? error.message : String(error),
			flushMeta
		});
	} finally {
		cancellation.dispose();
	}
}

async function runHostUiSmokeScreenshotPageVisionRoute(): Promise<void> {
	if (!isHostUiSmokeMode() || !logger) {
		return;
	}
	const runtimeId = "deepseek-v4-flash::deepseek";
	const settings = getSettings();
	const model = findModelConfig(runtimeId, settings.models);
	if (!model) {
		logger.error("host-ui-smoke.screenshot-page.vision.end", { ok: false, message: `model-not-found:${runtimeId}` });
		return;
	}
	if (!isVisionProxyEnabledForModel(model, settings)) {
		logger.error("host-ui-smoke.screenshot-page.vision.end", { ok: false, message: "vision-proxy-disabled" });
		return;
	}
	let screenshotBytes: Uint8Array = HOST_UI_SMOKE_MIN_PNG;
	let screenshotAsset = "min-png";
	try {
		screenshotBytes = await readHostUiSmokeTestButtonBytes(HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE);
		screenshotAsset = HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE;
	} catch (error) {
		logger.warn("host-ui-smoke.screenshot-page.asset-fallback", {
			message: error instanceof Error ? error.message : String(error)
		});
	}
	const messages: vscode.LanguageModelChatRequestMessage[] = [
		vscode.LanguageModelChatMessage.Assistant([
			new vscode.LanguageModelToolCallPart("call-screenshot", "screenshot_page", {})
		]),
		vscode.LanguageModelChatMessage.User([
			new vscode.LanguageModelToolResultPart("call-screenshot", [
				vscode.LanguageModelDataPart.image(screenshotBytes, "image/png")
			])
		])
	];
	const cancellation = new vscode.CancellationTokenSource();
	try {
		logger.info("host-ui-smoke.screenshot-page.asset", { screenshotAsset, byteLength: screenshotBytes.byteLength });
		const resolution = await resolveVisionProxyMessages(messages, model, settings, logger, cancellation.token, {
			reportFailure: true,
			onStructuredProgress: (structured) => {
				logger!.info("host-ui-smoke.screenshot-page.structured", {
					stage: structured.stage,
					contract: structured.contract,
					elementCount: structured.elementCount,
					reused: structured.reused,
					sourceKind: structured.sourceKind,
					toolName: structured.toolName,
					snapshotBytes: structured.snapshotJson.length
				});
			}
		});
		const touched = (resolution.cacheMissCount ?? 0) > 0 || (resolution.cacheHitCount ?? 0) > 0;
		const ok = resolution.status === "applied" && touched;
		logger.info("host-ui-smoke.screenshot-page.vision.end", {
			ok,
			status: resolution.status,
			cacheMissCount: resolution.cacheMissCount,
			cacheHitCount: resolution.cacheHitCount,
			error: resolution.error,
			toolName: "screenshot_page",
			sourceKind: "tool-screenshot"
		});
	} catch (error) {
		logger.error("host-ui-smoke.screenshot-page.vision.end", {
			ok: false,
			message: error instanceof Error ? error.message : String(error)
		});
	} finally {
		cancellation.dispose();
	}
}

async function runHostUiSmokeAgentSmokeBudgeted(): Promise<void> {
	if (!isHostUiSmokeMode() || !logger) {
		return;
	}
	clearLongTermMemoryForTests();
	const workspaceId = "host-ui-smoke";
	upsertMemoryRecord({
		workspaceId,
		category: "project-fact",
		key: "smoke-budget",
		content: "Host UI agent smoke validates greedy-prefix memory budgeting.",
		estimatedTokens: 24
	});
	upsertMemoryRecord({
		workspaceId,
		category: "vision-evidence",
		key: "probe",
		content: "vision.input.bound and vision.proxy.cache must appear in vision-probe logs.",
		estimatedTokens: 28
	});
	const runtimeId = "deepseek-v4-flash::deepseek";
	const model = findModelConfig(runtimeId, getSettings().models);
	if (!model) {
		logger.error("host-ui-smoke.agent.smoke.budgeted.end", {
			ok: false,
			message: `model-not-found:${runtimeId}`
		});
		return;
	}
	try {
		const { messages, selection } = applyLongTermMemoryBudget(
			[{ role: "user", content: "Host UI memory budget smoke." }],
			model,
			workspaceId,
			200
		);
		const estimatedPromptTokens = estimateOpenAIMessageTokens(messages);
		logger.info("host-ui-smoke.agent.smoke.budgeted.end", {
			ok: selection.retained.length > 0 && selection.injectionText.length > 0,
			budgeterKind: "greedy-prefix",
			retainedCount: selection.retained.length,
			droppedCount: selection.dropped.length,
			memoryBudgetCeiling: selection.memoryTokenBudget,
			retainedUnits: selection.totalRetainedTokens,
			promptEstimateUnits: estimatedPromptTokens
		});
	} catch (error) {
		logger.error("host-ui-smoke.agent.smoke.budgeted.end", {
			ok: false,
			message: error instanceof Error ? error.message : String(error)
		});
	}
}

async function runHostUiSmokeVisionContract(): Promise<void> {
	if (!isHostUiSmokeMode()) {
		return;
	}
	clearVisionEvidenceStoreForTests();
	const imageHash = HOST_UI_SMOKE_VISION_CONTRACT_HASH;
	const evidenceId = createVisionEvidenceId(imageHash);
	upsertVisionEvidenceRecord({
		id: evidenceId,
		imageHash,
		route: "native",
		handoff: "description",
		taskStatus: "pending",
		modelId: "host-ui-smoke-vision-contract",
		description: "pending native structured handoff"
	});
	createVisionTaskStack(evidenceId, ["describe", "complete"]);
	const fixture = {
		batchId: "host-ui-smoke-vision-contract",
		sessionId: "host-ui-smoke",
		results: [
			{
				imageRef: "contract-image",
				imageHash,
				objects: [
					{
						id: "obj-contract",
						label: "smoke-marker",
						geometry: {
							version: "v1",
							bbox: { x: 0, y: 0, w: 10, h: 10 },
							rationale: "contract fixture"
						}
					}
				],
				processingMs: 1
			}
		],
		totalMs: 1,
		failedRefs: [] as string[]
	};
	const finalized = finalizeNativeVisionStructuredHandoff({
		assistantText: JSON.stringify(fixture),
		modelId: "host-ui-smoke-vision-contract",
		imageHashes: [imageHash],
		logger
	});
	const contract = buildVisionEvidenceContractSnapshot();
	logger?.info("host-ui-smoke.vision.contract.end", {
		ok: finalized.parsed && finalized.completedEvidenceIds.length === 1,
		...contract,
		completedEvidenceIds: finalized.completedEvidenceIds,
		regionCount: finalized.regionCount
	});
}

async function runHostUiSmokeVisionJsonRepair(): Promise<void> {
	if (!isHostUiSmokeMode()) {
		return;
	}
	const probe = runVisionJsonRepairProbe();
	for (const sample of probe.results) {
		logger?.info("host-ui-smoke.vision.json.repair.sample", sample);
	}
	logger?.info("host-ui-smoke.vision.json.repair.end", {
		ok: probe.ok,
		sampleCount: probe.results.length,
		repairedCount: probe.results.filter((result) => result.repaired).length
	});
}

async function runHostUiSmokeRequest(): Promise<void> {
	const smokePrompt = getHostUiSmokePrompt();
	logger?.info("host-ui-smoke.request.run.start", {
		modelKind: getHostUiSmokeModelKind(),
		requestPath: "lm-api"
	});
	const maxAttempts = getHostUiSmokeModelKind() === "wrapped" ? 120 : 20;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const modelSelector = await getHostUiSmokeModelSelector();
		if (!modelSelector) {
			logger?.info("host-ui-smoke.request.awaiting-model", { modelKind: getHostUiSmokeModelKind(), attempt, reason: "no-wrapped-models-yet" });
			await delay(1_000);
			continue;
		}
		const matches = await vscode.lm.selectChatModels(modelSelector);
		const match = matches[0];
		if (!match) {
			logger?.info("host-ui-smoke.request.awaiting-model", { modelSelector, attempt, reason: "selector-not-available-yet" });
			await delay(1_000);
			continue;
		}

		const cancellation = new vscode.CancellationTokenSource();
		try {
			const response = await match.sendRequest([
				vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(smokePrompt)])
			], {
				justification: "Copilot Bro host UI smoke request validation"
			}, cancellation.token);

			let responseText = "";
			for await (const part of response.stream) {
				if (part instanceof vscode.LanguageModelTextPart) {
					responseText += part.value;
				}
			}

			const normalizedText = responseText.trim();
			if (normalizedText !== "BRO_SMOKE_OK_20260506") {
				throw new Error(`Unexpected host UI smoke response: ${normalizedText || "<empty>"}`);
			}

			logger?.info("host-ui-smoke.request.run.end", {
				modelSelector,
				attempt,
				requestPath: "lm-api",
				responseText: normalizedText
			});
			return;
		} catch (error) {
			logger?.warn("host-ui-smoke.request.run.failed", {
				modelSelector,
				attempt,
				message: error instanceof Error ? error.message : String(error)
			});
			throw error;
		} finally {
			cancellation.dispose();
		}
	}

	throw new Error(`No chat models found for host UI smoke ${getHostUiSmokeModelKind()} target.`);
}

async function maybeAutoRunHostUiSmokeRequest(): Promise<void> {
	const autoRun = vscode.workspace.getConfiguration("extendedModels").get<boolean>("hostUiSmokeAutoRunRequest", false);
	const autoRunFromEnv = process.env.COPILOT_BRO_UI_SMOKE_AUTO_RUN_REQUEST === "1";
	if (!autoRun && !autoRunFromEnv) {
		return;
	}
	await runHostUiSmokeRequest();
}


async function exportModels(): Promise<void> {
	const uri = await vscode.window.showSaveDialog({
		title: "Export Copilot Bro Model Configuration",
		defaultUri: vscode.Uri.file("copilot-bro-models.json"),
		filters: {
			"JSON": [
				"json"
			]
		}
	});
	if (!uri) {
		return;
	}

	const config = vscode.workspace.getConfiguration("extendedModels");
	const models = readMergedCustomModelsFromInspect(config.inspect("models"));
	const content = JSON.stringify({ models: models.map((model) => removeSensitiveFields(model)) }, null, 2);
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
	vscode.window.showInformationMessage("Copilot Bro configuration exported.");
}

async function importModels(): Promise<void> {
	const uris = await vscode.window.showOpenDialog({
		title: "Import Copilot Bro Model Configuration",
		canSelectMany: false,
		filters: {
			"JSON": [
				"json"
			]
		}
	});
	const uri = uris?.[0];
	if (!uri) {
		return;
	}

	const bytes = await vscode.workspace.fs.readFile(uri);
	const text = new TextDecoder().decode(bytes);
	const parsed = JSON.parse(text) as unknown;
	const models = Array.isArray(parsed) ? parsed : (parsed as { models?: unknown }).models;
	if (!Array.isArray(models)) {
		throw new Error("Imported file must be a JSON array or an object with a models array.");
	}

	const config = vscode.workspace.getConfiguration("extendedModels");
	const preference = normalizeDefaultSaveScope(config.get("configWriteScope", "global"));
	const target = resolveDefaultSaveTarget(preference, hasWorkspaceFolders());
	await config.update("models", models, toVsCodeConfigurationTarget(target));
	vscode.window.showInformationMessage("Copilot Bro configuration imported.");
}

function removeSensitiveFields(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => removeSensitiveFields(item));
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (!isSensitiveKey(key)) {
			out[key] = removeSensitiveFields(item);
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

export function deactivate(): void {
	bindExtensionSmokeContext(undefined);
	logger?.dispose();
	logger = undefined;
	bindExtensionSmokeLogger(undefined);
}

async function setProviderApiKey(context: vscode.ExtensionContext, preferredProvider?: unknown): Promise<string | undefined> {
	const normalizedPreferredProvider = typeof preferredProvider === "string" ? preferredProvider.trim().toLowerCase() : "";
	let provider = normalizedPreferredProvider;
	if (!provider) {
		const providers = getProviderChoices();
		const selected = await vscode.window.showQuickPick(providers, {
			title: "Copilot Bro: Select Provider",
			placeHolder: "Choose the provider whose API key should be updated"
		});
		provider = selected ?? "";
	}
	if (!provider) {
		return undefined;
	}

	const existing = await context.secrets.get(providerSecretKey(provider));
	const saved = await promptForApiKey(context.secrets, provider, existing);
	if (saved === "") {
		vscode.window.showInformationMessage(`Copilot Bro API key for ${provider} cleared.`);
	} else if (saved) {
		vscode.window.showInformationMessage(`Copilot Bro API key for ${provider} saved.`);
	}
	return saved === undefined ? undefined : provider;
}

async function clearSelectedApiKey(context: vscode.ExtensionContext): Promise<void> {
	const choices = [
		"Default",
		...getProviderChoices()
	];
	const selected = await vscode.window.showQuickPick(choices, {
		title: "Copilot Bro: Clear API Key"
	});
	if (!selected) {
		return;
	}
	await clearApiKey(context.secrets, selected === "Default" ? undefined : selected);
	vscode.window.showInformationMessage(`Copilot Bro API key for ${selected} cleared.`);
}

function getProviderChoices(): string[] {
	const settings = getSettings();
	const configuredCustomProviders = vscode.workspace.getConfiguration("extendedModels").get<string[]>("customProviders", []);
	const providers = Array.from(new Set([
		...listProviders(settings.models),
		...configuredCustomProviders
			.filter((provider) => typeof provider === "string")
			.map((provider) => provider.trim().toLowerCase())
			.filter(Boolean)
	])).sort((left, right) => left.localeCompare(right));
	if (providers.length > 0) {
		return providers;
	}
	return [
		"deepseek",
		"zhipu",
		"minimax",
		"kimi",
		"qwen"
	];
}
