/**
 * Host UI smoke extension activation (loaded only when COPILOT_BRO_UI_SMOKE=1).
 * @see ../extension.ts dynamic import
 */
import * as vscode from "vscode";
import process from "node:process";
import { getProviderEnvironmentVariableName, HOST_UI_SMOKE_API_KEY_PROVIDERS } from "./env";
import { findModelConfig, getRuntimeModelId, getSettings, listProviders } from "../../config/settings";
import { isHostUiSmokeMode } from "../../smokeModeGate";
import { registerHostUiSmokeCommands } from "./registerSmokeCommands";
import {
	mergeProviderEndpointsPreference,
	normalizeProviderEndpointsConfig
} from "../../config/providerEndpoints";
import type { Logger } from "../../logger";
import { providerSecretKey } from "../../secrets";
import { ConfigPanel } from "../../ui/configPanel";
import type { ExtendedModelsProvider } from "../../provider";
import { bindExtensionSmokeLogger } from "./extensionSmokeLogger";
import { maybeAutoRunHostUiSmokeChatSuiteAfterGithubPreflight } from "./extensionSmokeAutoRun";
import { HOST_UI_SMOKE_MIN_PNG } from "./chat/integration";
import {
	bindExtensionSmokeContext,
	bindExtensionSmokeWrappedRefresh,
	getHostUiSmokeModelKind,
	getHostUiSmokeModelSelector,
	getHostUiSmokePrompt,
	HOST_UI_SMOKE_PROMPT
} from "./extensionSmokeRuntime";
import { HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE } from "./fixtures/vision";
import { readHostUiSmokeTestButtonBytes } from "./probes/p6P7Probe";
import {
	handleHostUiSmokeChatParticipantRequest,
	maybeAutoOpenHostUiSmokeChat,
	openHostUiSmokeChat,
	runHostUiSmokeChatSuite,
	submitHostUiSmokeChatRequest
} from "./extensionSmokeChat";
import { delay } from "./extensionSmokeAutoRun";
import { runHostUiSmokeP6P7RealAssetsProbe } from "./probes/p6P7Probe";
import { HOST_UI_SMOKE_PROVIDER_PROBE_TARGETS, resolveHostUiSmokeProviderProbeRuntimeId } from "./probes/providerProbePlan";
import {
	buildVisionEvidenceContractSnapshot,
	finalizeNativeVisionStructuredHandoff
} from "../../visionProtocol/nativeVisionStructuredHandoff";
import {
	clearVisionEvidenceStoreForTests,
	createVisionEvidenceId,
	upsertVisionEvidenceRecord
} from "../../visionProtocol/visionEvidenceStore";
import { createVisionTaskStack } from "../../visionProtocol/visionTaskStack";
import { runVisionJsonRepairProbe } from "../../visionProtocol/visionJsonRepairProbe";
import { clearLongTermMemoryForTests, upsertMemoryRecord } from "../../memory/longTermMemory";
import { applyLongTermMemoryBudget } from "../../memory/memoryTokenBudget";
import { estimateOpenAIMessageTokens } from "../../openaiCompat/messages";
import { isVisionProxyEnabledForModel, resolveVisionProxyMessages } from "../../visionProxy";
import {
	getLastHostUiSmokeVisionProgressFlush,
	resetHostUiSmokeVisionProgressCapture
} from "../../toolCooperation/visionProgressReporter";

let logger: Logger | undefined;

const HOST_UI_SMOKE_CHINA_ENDPOINT_PROFILES: Record<string, string> = {
	qwen: "dashscope-cn",
	dashscope: "dashscope-cn",
	kimi: "moonshot-cn",
	moonshot: "moonshot-cn",
	minimax: "minimax-cn"
};

export interface HostUiSmokeActivationDeps {
	readonly logger: Logger;
	readonly provider: ExtendedModelsProvider;
	readonly refreshWrappedModels: () => Promise<void>;
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
export async function activateHostUiSmoke(
	context: vscode.ExtensionContext,
	deps: HostUiSmokeActivationDeps
): Promise<void> {
	logger = deps.logger;
	bindExtensionSmokeLogger(deps.logger);
	bindExtensionSmokeContext(context);
	bindExtensionSmokeWrappedRefresh(deps.refreshWrappedModels);

	context.subscriptions.push(
		...registerHostUiSmokeCommands(context, deps.provider, deps.logger, {
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
		vscode.chat.createChatParticipant("bro-smoke", handleHostUiSmokeChatParticipantRequest)
	);

	const prepareHostUiSmoke = maybePrepareHostUiSmokeState(context)
		.then(() => deps.provider.refreshModels())
		.then(() => maybeSeedHostUiSmokeProviderApiKeys(context));

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

export function deactivateHostUiSmokeExtension(): void {
	bindExtensionSmokeContext(undefined);
	bindExtensionSmokeLogger(undefined);
	bindExtensionSmokeWrappedRefresh(undefined);
	logger = undefined;
}
