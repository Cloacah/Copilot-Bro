import * as vscode from "vscode";
import { findModelConfig, getRuntimeModelId, getSettings } from "../../config/settings";
import { validateHostUiSmokeChatIntegrationConsistency } from "./chat/consistency";
import {
	buildHostUiSmokeSuiteChatQuery,
	normalizeHostUiSmokeScenarioResponse,
	resolveHostUiSmokeChatScenarios,
	shouldRunHostUiSmokeChatSuite,
	type HostUiSmokeChatScenario
} from "./chat/scenarios";
import {
	HOST_UI_SMOKE_ALT_MIN_PNG,
	HOST_UI_SMOKE_MIN_PNG,
	resolveHostUiSmokeChatIntegrationScenarios,
	resolveHostUiSmokeIntegrationSkip,
	scenarioRequiresVisionApi,
	shouldRunHostUiSmokeChatIntegrationSuite,
	type HostUiSmokeChatIntegrationScenario,
	type HostUiSmokeChatIntegrationTurn
} from "./chat/integration";
import { applySmokeCustomModelOverlay } from "./modelOverlay";
import {
	evaluateSelfReferProxyPolicy,
	P4_SELF_REFER_PROXY_MODEL_ID,
	P4_SELF_REFER_RUNTIME_ID
} from "./chat/p4Route";
import {
	clearHostUiSmokeLogEvidence,
	findMissingLogMarkers,
	snapshotHostUiSmokeLogEvidence
} from "./logEvidence";
import { extensionSmokeLogger } from "./extensionSmokeLogger";
import { readHostUiSmokeAutomationLogText } from "./smokeLogIo";
import { evaluateCapturedHostUiSmokeBenchmarkPageSsim } from "./benchmark/pageSsim";
import {
	expandHostUiSmokeIntegrationPrompt,
	HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE,
	readHostUiSmokeChatScreenshotBenchmarkBytes
} from "./fixtures/vision";
import { readHostUiSmokeTestButtonBytes } from "./probes/p6P7Probe";
import { isVisionProxyEnabledForModel } from "../../visionProxy";
import { ProviderLogEvent, VisionLogEvent } from "../../visionProtocol/visionLogEvents";
import { delay } from "./extensionSmokeAutoRun";
import {
	getExtensionSmokeContext,
	getHostUiSmokeModelKind,
	getHostUiSmokeModelSelector,
	getHostUiSmokePrompt,
	getHostUiSmokeRuntimeModelId
} from "./extensionSmokeRuntime";
import { persistSelectedPromptPreset } from "../../promptPresets";
import { HOST_UI_DEFAULT_TEXT_PROFILE, resolveHostUiModelProfile, resolveIntegrationTurnCandidates } from "./chat/hostUiModelProfiles";
import { resolveHostUiTestRetryOptions } from "./chat/modelCandidates";
import { runHostUiIntegrationTurnWithModelFallback } from "./chat/integrationRetry";

function resolveHostUiSmokeChatOpenMode(): "ask" | "agent" {
	const raw = process.env.COPILOT_BRO_UI_SMOKE_CHAT_MODE?.trim().toLowerCase();
	return raw === "agent" ? "agent" : "ask";
}

export async function runHostUiSmokeChatSuite(): Promise<void> {
	await openHostUiSmokeChat({ scheduleAutoSubmit: false });
	await submitHostUiSmokeChatRequest();
}

export async function openHostUiSmokeChat(options?: { scheduleAutoSubmit?: boolean }): Promise<void> {
	const scheduleAutoSubmit = options?.scheduleAutoSubmit
		?? process.env.COPILOT_BRO_UI_SMOKE_AUTO_SUBMIT_AFTER_OPEN === "1";
	const chatMode = resolveHostUiSmokeChatOpenMode();
	extensionSmokeLogger()?.info("host-ui-smoke.chat.open.start", { modelKind: getHostUiSmokeModelKind(), chatMode });
	const maxAttempts = getHostUiSmokeModelKind() === "wrapped" ? 120 : 20;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const modelSelector = await getHostUiSmokeModelSelector();
		if (!modelSelector) {
			extensionSmokeLogger()?.info("host-ui-smoke.chat.awaiting-model", { modelKind: getHostUiSmokeModelKind(), attempt, reason: "no-wrapped-models-yet" });
			await delay(1_000);
			continue;
		}
		const matches = await vscode.lm.selectChatModels(modelSelector);
		if (matches.length > 0) {
			// Ask mode routes @-mentions to extension chat participants; default Agent mode
			// targets the Copilot default agent and never dispatches @bro-smoke.
			await vscode.commands.executeCommand("workbench.action.chat.open", {
				mode: chatMode,
				modelSelector
			});
			extensionSmokeLogger()?.info("host-ui-smoke.chat.mode", { mode: chatMode });
			extensionSmokeLogger()?.info("host-ui-smoke.chat.open.end", { modelSelector, attempt, chatMode });
			if (scheduleAutoSubmit) {
				extensionSmokeLogger()?.info("host-ui-smoke.chat.open.auto-submit.scheduled");
				void submitHostUiSmokeChatRequest().catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					extensionSmokeLogger()?.warn("host-ui-smoke.chat.open.auto-submit.failed", { message });
				});
			}
			return;
		}
		extensionSmokeLogger()?.info("host-ui-smoke.chat.awaiting-model", { modelSelector, attempt, reason: "selector-not-available-yet" });
		await delay(1_000);
	}
	throw new Error(`No chat models found for host UI smoke ${getHostUiSmokeModelKind()} target.`);
}

export async function maybeAutoOpenHostUiSmokeChat(): Promise<void> {
	const autoOpen = vscode.workspace.getConfiguration("extendedModels").get<boolean>("hostUiSmokeAutoOpenChat", false);
	if (!autoOpen) {
		return;
	}
	await openHostUiSmokeChat();
}

function logHostUiSmokeChatOutput(meta: {
	kind: string;
	preview: string;
	scenarioId?: string;
	turnIndex?: number;
	ok?: boolean;
}): void {
	const preview = meta.preview.length > 320 ? `${meta.preview.slice(0, 320)}…` : meta.preview;
	extensionSmokeLogger()?.info("host-ui-smoke.chat.output", { ...meta, preview, length: meta.preview.length });
}

function logHostUiSmokeChatParticipantFinished(meta: {
	ok: boolean;
	modelSelector?: vscode.LanguageModelChatSelector;
	responseText?: string;
	reason?: string;
	message?: string;
	suite?: boolean;
	integrationSuite?: boolean;
}): void {
	extensionSmokeLogger()?.info("host-ui-smoke.chat.participant.end", meta);
	extensionSmokeLogger()?.info("host-ui-smoke.chat.participant.finished", meta);
	if (!meta.ok && meta.message) {
		logHostUiSmokeChatOutput({ kind: "participant-error", preview: meta.message, ok: false });
	}
}

export async function submitHostUiSmokeChatRequest(): Promise<void> {
	const participantPrompt = buildHostUiSmokeSuiteChatQuery();
	extensionSmokeLogger()?.info("host-ui-smoke.chat.submit.start", { modelKind: getHostUiSmokeModelKind(), query: participantPrompt });
	const maxAttempts = getHostUiSmokeModelKind() === "wrapped" ? 120 : 20;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const modelSelector = await getHostUiSmokeModelSelector();
		if (!modelSelector) {
			extensionSmokeLogger()?.info("host-ui-smoke.chat.submit.awaiting-model", { modelKind: getHostUiSmokeModelKind(), attempt, reason: "no-wrapped-models-yet" });
			await delay(1_000);
			continue;
		}
		const matches = await vscode.lm.selectChatModels(modelSelector);
		if (matches.length === 0) {
			extensionSmokeLogger()?.info("host-ui-smoke.chat.submit.awaiting-model", { modelSelector, attempt, reason: "selector-not-available-yet" });
			await delay(1_000);
			continue;
		}
		try {
			// Bind the smoke LM in the same Chat invocation as the suite query so Copilot Chat
			// resolves the extendedModels model; Ask mode is required so @bro-smoke is dispatched
			// to this extension instead of the default Copilot agent.
			const chatMode = resolveHostUiSmokeChatOpenMode();
			await vscode.commands.executeCommand("workbench.action.chat.open", {
				mode: chatMode,
				query: participantPrompt,
				modelSelector,
				isPartialQuery: false
			});
			extensionSmokeLogger()?.info("host-ui-smoke.chat.mode", { mode: chatMode });
			extensionSmokeLogger()?.info("host-ui-smoke.chat.submit.end", {
				modelSelector,
				attempt,
				requestPath: "chat-ui"
			});
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			extensionSmokeLogger()?.warn("host-ui-smoke.chat.submit.failed", {
				modelSelector,
				attempt,
				message
			});
			logHostUiSmokeChatOutput({ kind: "submit-error", preview: message, ok: false });
			throw error;
		}
	}
	const message = `No chat models found for host UI smoke ${getHostUiSmokeModelKind()} target.`;
	extensionSmokeLogger()?.warn("host-ui-smoke.chat.submit.failed", { message });
	logHostUiSmokeChatOutput({ kind: "submit-error", preview: message, ok: false });
	throw new Error(message);
}

export async function handleHostUiSmokeChatParticipantRequest(
	request: vscode.ChatRequest,
	_context: vscode.ChatContext,
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
	extensionSmokeLogger()?.info("host-ui-smoke.chat.participant.request", {
		prompt: request.prompt,
		modelKind: getHostUiSmokeModelKind()
	});
	const modelSelector = await getHostUiSmokeModelSelector();
	if (!modelSelector) {
		const message = `No host UI smoke model selector is available for ${getHostUiSmokeModelKind()}.`;
		extensionSmokeLogger()?.warn("host-ui-smoke.chat.participant.failed", { message });
		logHostUiSmokeChatParticipantFinished({ ok: false, reason: "no-model-selector", message });
		response.markdown(message);
		return { errorDetails: { message } };
	}
	const match = (await vscode.lm.selectChatModels(modelSelector))[0];
	if (!match) {
		const message = `No host UI smoke model matched ${JSON.stringify(modelSelector)}.`;
		extensionSmokeLogger()?.warn("host-ui-smoke.chat.participant.failed", { message });
		logHostUiSmokeChatParticipantFinished({ ok: false, reason: "no-model-match", message });
		response.markdown(message);
		return { errorDetails: { message } };
	}
	let lastResponseText = "";
	if (shouldRunHostUiSmokeChatSuite(request.prompt)) {
		const scenarios = resolveHostUiSmokeChatScenarios(process.env);
		if (scenarios.length === 0) {
			extensionSmokeLogger()?.info("host-ui-smoke.chat.suite.summary", {
				modelSelector,
				scenarioIds: [],
				ok: true,
				skipped: true,
				reason: "empty-scenario-list"
			});
		}
		const suiteOutcome = scenarios.length === 0
			? { ok: true as const, last: { expectedTrimmed: "" } }
			: await runHostUiSmokeChatScenarioLoop(match, scenarios, response, token);
		if (!suiteOutcome.ok) {
			logHostUiSmokeChatParticipantFinished({
				ok: false,
				reason: "suite-failed",
				modelSelector,
				message: "Host UI smoke chat scenario suite failed."
			});
			return suiteOutcome.result;
		}
		lastResponseText = suiteOutcome.last.expectedTrimmed;
		extensionSmokeLogger()?.info("host-ui-smoke.chat.suite.summary", {
			modelSelector,
			scenarioIds: scenarios.map((scenario) => scenario.id),
			ok: true
		});
	}
	if (shouldRunHostUiSmokeChatIntegrationSuite(request.prompt)) {
		const integrationScenarios = resolveHostUiSmokeChatIntegrationScenarios(process.env);
		const integrationOutcome = await runHostUiSmokeChatIntegrationLoop(
			match,
			integrationScenarios,
			response,
			token
		);
		if (!integrationOutcome.ok) {
			extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.suite.summary", {
				modelSelector,
				scenarioIds: integrationScenarios.map((scenario) => scenario.id),
				ok: false,
				count: integrationScenarios.length
			});
			logHostUiSmokeChatParticipantFinished({
				ok: false,
				reason: "integration-suite-failed",
				modelSelector,
				message: "Host UI smoke chat integration suite failed."
			});
			return integrationOutcome.result;
		}
		lastResponseText = integrationOutcome.lastResponseText || lastResponseText;
	}
	if (shouldRunHostUiSmokeChatSuite(request.prompt) || shouldRunHostUiSmokeChatIntegrationSuite(request.prompt)) {
		logHostUiSmokeChatOutput({
			kind: "participant-suite",
			preview: lastResponseText || "<empty suite response>",
			ok: true
		});
		logHostUiSmokeChatParticipantFinished({
			ok: true,
			modelSelector,
			responseText: lastResponseText,
			suite: shouldRunHostUiSmokeChatSuite(request.prompt),
			integrationSuite: shouldRunHostUiSmokeChatIntegrationSuite(request.prompt)
		});
		return {
			metadata: {
				requestPath: "chat-ui",
				modelSelector,
				responseText: lastResponseText,
				hostUiSmokeSuite: shouldRunHostUiSmokeChatSuite(request.prompt)
					? { scenarioIds: resolveHostUiSmokeChatScenarios(process.env).map((scenario) => scenario.id) }
					: undefined,
				hostUiSmokeIntegrationSuite: shouldRunHostUiSmokeChatIntegrationSuite(request.prompt)
					? { scenarioIds: resolveHostUiSmokeChatIntegrationScenarios(process.env).map((scenario) => scenario.id) }
					: undefined
			}
		};
	}
	const lmResponse = await match.sendRequest([
		vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(getHostUiSmokePrompt())])
	], {
		justification: "Copilot Bro host UI smoke participant validation"
	}, token);
	let responseText = "";
	for await (const part of lmResponse.stream) {
		if (part instanceof vscode.LanguageModelTextPart) {
			responseText += part.value;
			response.markdown(part.value);
		}
	}
	const normalizedText = responseText.trim();
	if (normalizedText !== "BRO_SMOKE_OK_20260506") {
		const message = `Unexpected host UI smoke participant response: ${normalizedText || "<empty>"}`;
		extensionSmokeLogger()?.warn("host-ui-smoke.chat.participant.failed", { message });
		logHostUiSmokeChatParticipantFinished({ ok: false, reason: "unexpected-single-response", message, modelSelector });
		return { errorDetails: { message } };
	}
	logHostUiSmokeChatOutput({ kind: "participant-single", preview: normalizedText, ok: true });
	logHostUiSmokeChatParticipantFinished({
		ok: true,
		modelSelector,
		responseText: normalizedText
	});
	return {
		metadata: {
			requestPath: "chat-ui",
			modelSelector,
			responseText: normalizedText
		}
	};
}

async function runHostUiSmokeChatScenarioLoop(
	defaultMatch: vscode.LanguageModelChat,
	scenarios: readonly HostUiSmokeChatScenario[],
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<{ ok: true; last: HostUiSmokeChatScenario } | { ok: false; result: vscode.ChatResult }> {
	const candidates = resolveHostUiModelProfile(HOST_UI_DEFAULT_TEXT_PROFILE);
	let last = scenarios[0];
	for (const scenario of scenarios) {
		last = scenario;
		extensionSmokeLogger()?.info("host-ui-smoke.chat.scenario.start", { scenarioId: scenario.id });
		const turnOutcome = await runHostUiIntegrationTurnWithModelFallback(
			(runtimeModelId) => resolveHostUiSmokeIntegrationChatModel(defaultMatch, runtimeModelId),
			candidates,
			async (turnMatch, _meta) => {
				try {
					const lmResponse = await turnMatch.sendRequest([
						vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(scenario.userPrompt)])
					], {
						justification: `Copilot Bro host UI smoke scenario ${scenario.id}`
					}, token);
					let responseText = "";
					for await (const part of lmResponse.stream) {
						if (part instanceof vscode.LanguageModelTextPart) {
							responseText += part.value;
							response.markdown(part.value);
						}
					}
					const normalizedText = normalizeHostUiSmokeScenarioResponse(responseText, scenario.id);
					if (normalizedText !== scenario.expectedTrimmed) {
						return {
							ok: false as const,
							message: `Unexpected host UI smoke scenario ${scenario.id} response: ${normalizedText || "<empty>"}`
						};
					}
					return { ok: true as const, responseText: normalizedText };
				} catch (error) {
					return {
						ok: false as const,
						message: error instanceof Error ? error.message : String(error)
					};
				}
			},
			resolveHostUiTestRetryOptions(process.env)
		);
		if (!turnOutcome.ok) {
			const message = turnOutcome.message;
			logHostUiSmokeChatOutput({ kind: "scenario", preview: message, scenarioId: scenario.id, ok: false });
			extensionSmokeLogger()?.info("host-ui-smoke.chat.scenario.end", {
				scenarioId: scenario.id,
				ok: false,
				runtimeModelId: turnOutcome.runtimeModelId,
				attempts: turnOutcome.attempts
			});
			extensionSmokeLogger()?.warn("host-ui-smoke.chat.participant.failed", { message });
			return {
				ok: false,
				result: { errorDetails: { message } }
			};
		}
		logHostUiSmokeChatOutput({ kind: "scenario", preview: turnOutcome.responseText, scenarioId: scenario.id, ok: true });
		extensionSmokeLogger()?.info("host-ui-smoke.chat.scenario.end", {
			scenarioId: scenario.id,
			ok: true,
			responseText: turnOutcome.responseText,
			runtimeModelId: turnOutcome.runtimeModelId,
			attempts: turnOutcome.attempts
		});
	}
	return { ok: true, last };
}

async function resolveHostUiSmokeIntegrationChatModel(
	defaultMatch: vscode.LanguageModelChat,
	runtimeModelId: string | undefined
): Promise<vscode.LanguageModelChat> {
	if (!runtimeModelId?.trim()) {
		return defaultMatch;
	}
	const trimmed = runtimeModelId.trim();
	const settings = getSettings();
	const catalogModel = findModelConfig(trimmed, settings.models);
	const lmId = catalogModel ? getRuntimeModelId(catalogModel) : trimmed;
	const selector = {
		vendor: "extendedModels" as const,
		id: lmId,
		family: "oai-compatible" as const
	};
	const match = (await vscode.lm.selectChatModels(selector))[0];
	if (!match) {
		throw new Error(
			`No host UI smoke integration model matched ${JSON.stringify(selector)} (requested=${trimmed}, catalog=${catalogModel ? lmId : "none"}).`
		);
	}
	return match;
}

async function buildHostUiSmokeIntegrationMessageParts(
	turn: Pick<
		HostUiSmokeChatIntegrationTurn,
		| "userPrompt"
		| "attachMinPng"
		| "attachAltMinPng"
		| "attachTestButtonAsset"
		| "attachTestButtonFile"
		| "attachChatScreenshotBenchmark"
	>
): Promise<(vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[]> {
	const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
	if (turn.attachChatScreenshotBenchmark) {
		const bytes = await readHostUiSmokeChatScreenshotBenchmarkBytes();
		parts.push(vscode.LanguageModelDataPart.image(bytes, "image/png"));
	} else if (turn.attachTestButtonAsset) {
		const bytes = await readHostUiSmokeTestButtonBytes(
			turn.attachTestButtonFile?.trim() || HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE
		);
		parts.push(vscode.LanguageModelDataPart.image(bytes, "image/png"));
	} else if (turn.attachAltMinPng) {
		parts.push(vscode.LanguageModelDataPart.image(HOST_UI_SMOKE_ALT_MIN_PNG, "image/png"));
	} else if (turn.attachMinPng) {
		parts.push(vscode.LanguageModelDataPart.image(HOST_UI_SMOKE_MIN_PNG, "image/png"));
	}
	parts.push(new vscode.LanguageModelTextPart(expandHostUiSmokeIntegrationPrompt(turn.userPrompt)));
	return parts;
}

function shouldSkipHostUiSmokeIntegrationScenario(
	scenario: HostUiSmokeChatIntegrationScenario
): { skip: true; reason: string } | { skip: false } {
	const keySkip = resolveHostUiSmokeIntegrationSkip(scenario, process.env);
	if (keySkip.skip) {
		return keySkip;
	}
	if (!scenarioRequiresVisionApi(scenario)) {
		return { skip: false };
	}
	const runtimeId = resolveIntegrationTurnCandidates(scenario, undefined)[0]
		|| getHostUiSmokeRuntimeModelId()
		|| "deepseek-v4-flash::deepseek";
	const settings = getSettings();
	const model = findModelConfig(runtimeId, settings.models);
	if (!model) {
		return { skip: true, reason: `model-not-found:${runtimeId}` };
	}
	if (
		scenario.kind !== "p4-self-refer"
		&& scenario.kind !== "native-vision"
		&& !isVisionProxyEnabledForModel(model, settings)
	) {
		return { skip: true, reason: "vision-proxy-disabled" };
	}
	return { skip: false };
}

async function runHostUiSmokeIntegrationTurn(
	match: vscode.LanguageModelChat,
	turn: HostUiSmokeChatIntegrationTurn,
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	options: {
		turnTimeoutMs?: number;
		runtimeModelId?: string;
		attempt?: number;
		modelProfile?: string;
	} = {}
): Promise<{ ok: true; responseText: string } | { ok: false; message: string }> {
	const turnToken = new vscode.CancellationTokenSource();
	const linked = token.onCancellationRequested(() => turnToken.cancel());
	let turnTimer: ReturnType<typeof setTimeout> | undefined;
	if (options.turnTimeoutMs && options.turnTimeoutMs > 0) {
		turnTimer = setTimeout(() => turnToken.cancel(), options.turnTimeoutMs);
	}
	let lmResponse: vscode.LanguageModelChatResponse;
	try {
		lmResponse = await match.sendRequest([
			vscode.LanguageModelChatMessage.User(await buildHostUiSmokeIntegrationMessageParts(turn))
		], {
			justification: "Copilot Bro host UI smoke chat integration turn"
		}, turnToken.token);
	} catch (error) {
		if (turnToken.token.isCancellationRequested) {
			const evidence = snapshotHostUiSmokeLogEvidence();
			const hasPolicy = evidence.some((line) => line.includes("host-ui-smoke.p4.self-refer.policy"));
			const hasGuard = evidence.some((line) => line.includes(VisionLogEvent.guardResidualImages));
			if (hasPolicy && hasGuard) {
				extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.turn.cancelled-with-p4-evidence", {
					evidenceLines: evidence.length
				});
				return { ok: true, responseText: "" };
			}
		}
		const message = error instanceof Error ? error.message : String(error);
		extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.turn.attempt-failed", {
			message,
			runtimeModelId: options.runtimeModelId,
			modelProfile: options.modelProfile,
			attempt: options.attempt
		});
		return { ok: false, message };
	} finally {
		if (turnTimer) {
			clearTimeout(turnTimer);
		}
		linked.dispose();
		turnToken.dispose();
	}
	let responseText = "";
	for await (const part of lmResponse.stream) {
		if (part instanceof vscode.LanguageModelTextPart) {
			responseText += part.value;
			response.markdown(part.value);
		}
	}
	const normalizedText = turn.expectedTrimmed
		? normalizeHostUiSmokeScenarioResponse(responseText, "baseline")
		: responseText.trim();
	if (turn.expectedTrimmed && normalizedText !== turn.expectedTrimmed) {
		const message = `Unexpected integration turn response: ${normalizedText || "<empty>"}`;
		logHostUiSmokeChatOutput({ kind: "integration-turn", preview: normalizedText || "<empty>", ok: false });
		return { ok: false, message };
	}
	logHostUiSmokeChatOutput({
		kind: "integration-turn",
		preview: normalizedText || "<empty>",
		ok: true
	});
	if (!turn.expectedTrimmed && normalizedText.length === 0) {
		const evidence = snapshotHostUiSmokeLogEvidence();
		const visionEvidenceOk = evidence.some((line) => line.includes(VisionLogEvent.inputBound))
			&& evidence.some((line) => line.includes(ProviderLogEvent.requestEnd));
		if (!visionEvidenceOk) {
			return { ok: false, message: "Integration vision turn returned empty response without vision/request evidence." };
		}
		extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.turn.empty-response-allowed", {
			evidenceLines: evidence.length
		});
	}
	return { ok: true, responseText: normalizedText };
}

async function runHostUiSmokeChatIntegrationLoop(
	defaultMatch: vscode.LanguageModelChat,
	scenarios: readonly HostUiSmokeChatIntegrationScenario[],
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<
	| { ok: true; lastResponseText: string }
	| { ok: false; result: vscode.ChatResult }
> {
	let lastResponseText = "";
	let suiteOk = true;
	let firstFailureMessage: string | undefined;
	for (const scenario of scenarios) {
		const started = Date.now();
		extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.scenario.start", {
			scenarioId: scenario.id,
			kind: scenario.kind
		});
		if (scenario.id === "prompt-preset-applied") {
			const smokeContext = getExtensionSmokeContext();
			if (!smokeContext) {
				throw new Error("Host UI smoke extension context is not bound; cannot apply prompt preset.");
			}
			await persistSelectedPromptPreset(smokeContext, "built-in:senior-engineer");
			extensionSmokeLogger()?.info("host-ui-smoke.prompt.preset.seeded", {
				presetId: "built-in:senior-engineer"
			});
		}
		const skip = shouldSkipHostUiSmokeIntegrationScenario(scenario);
		if (skip.skip) {
			extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.scenario.end", {
				scenarioId: scenario.id,
				ok: true,
				skipped: true,
				skipReason: skip.reason,
				ms: Date.now() - started
			});
			continue;
		}
		let restoreOverlay: (() => Promise<void>) | undefined;
		let turnCount = 1;
		try {
			try {
			if (scenario.kind === "p4-self-refer") {
				restoreOverlay = await applySmokeCustomModelOverlay(P4_SELF_REFER_RUNTIME_ID, {
					visionProxyModelId: P4_SELF_REFER_PROXY_MODEL_ID
				});
			}
			let match: vscode.LanguageModelChat;
			if (scenario.kind === "p4-wrapped") {
				const selector = await getHostUiSmokeModelSelector();
				if (!selector) {
					throw new Error("No wrapped host UI smoke model selector is available.");
				}
				const wrappedMatch = (await vscode.lm.selectChatModels(selector))[0];
				if (!wrappedMatch) {
					throw new Error(`No wrapped model matched ${JSON.stringify(selector)}.`);
				}
				match = wrappedMatch;
			} else {
				const scenarioCandidates = resolveIntegrationTurnCandidates(scenario, scenario.turns?.[0]);
				const primaryRuntimeId = scenarioCandidates[0];
				if (!primaryRuntimeId) {
					throw new Error(`Integration scenario ${scenario.id} has no resolvable model profile candidates.`);
				}
				match = await resolveHostUiSmokeIntegrationChatModel(defaultMatch, primaryRuntimeId);
			}
			clearHostUiSmokeLogEvidence();
			if (scenario.kind === "p4-self-refer") {
				const settings = getSettings();
				const model = findModelConfig(P4_SELF_REFER_RUNTIME_ID, settings.models);
				if (model) {
					const evaluated = evaluateSelfReferProxyPolicy(model, settings);
					extensionSmokeLogger()?.info("host-ui-smoke.p4.self-refer.policy", {
						ok: evaluated.ok,
						enabled: evaluated.policy.enabled,
						reason: evaluated.policy.reason,
						requestedModelId: evaluated.policy.requestedModelId
					});
				}
			}
			const turns: HostUiSmokeChatIntegrationTurn[] = scenario.turns?.length
				? [...scenario.turns]
				: [{
					userPrompt: scenario.userPrompt,
					attachMinPng: scenario.attachMinPng,
					attachAltMinPng: scenario.attachAltMinPng,
					attachTestButtonAsset: scenario.attachTestButtonAsset,
					attachTestButtonFile: scenario.attachTestButtonFile,
					attachChatScreenshotBenchmark: scenario.attachChatScreenshotBenchmark,
					expectedTrimmed: scenario.expectedTrimmed
				}];
			turnCount = turns.length;
			let turnIndex = 0;
			for (const turn of turns) {
				turnIndex += 1;
				const turnCandidates = resolveIntegrationTurnCandidates(scenario, turn);
				if (turnCandidates.length === 0) {
					throw new Error(
						`Integration scenario ${scenario.id} turn ${turnIndex} has no model candidates (set modelProfile).`
					);
				}
				const turnOutcome = await runHostUiIntegrationTurnWithModelFallback(
					(runtimeModelId) => resolveHostUiSmokeIntegrationChatModel(defaultMatch, runtimeModelId),
					turnCandidates,
					(turnMatch, meta) =>
						runHostUiSmokeIntegrationTurn(turnMatch, turn, response, token, {
							turnTimeoutMs: scenario.integrationTurnTimeoutMs
								?? (scenario.kind === "p4-self-refer" ? 60_000 : undefined),
							runtimeModelId: meta.runtimeModelId,
							attempt: meta.attempt,
							modelProfile: turn.modelProfile ?? scenario.modelProfile
						}),
					resolveHostUiTestRetryOptions(process.env)
				).then((outcome) =>
					outcome.ok
						? { ok: true as const, responseText: outcome.responseText }
						: { ok: false as const, message: outcome.message }
				);
				if (!turnOutcome.ok) {
					const evidence = snapshotHostUiSmokeLogEvidence();
					logHostUiSmokeChatOutput({
						kind: "integration-turn",
						preview: turnOutcome.message,
						scenarioId: scenario.id,
						turnIndex,
						ok: false
					});
					extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.scenario.end", {
						scenarioId: scenario.id,
						ok: false,
						turnIndex,
						message: turnOutcome.message,
						evidenceLines: evidence.length,
						ms: Date.now() - started
					});
					extensionSmokeLogger()?.warn("host-ui-smoke.chat.participant.failed", { message: turnOutcome.message });
					return { ok: false, result: { errorDetails: { message: turnOutcome.message } } };
				}
				lastResponseText = turnOutcome.responseText;
			}
			} finally {
				if (restoreOverlay) {
					await restoreOverlay().catch(() => undefined);
				}
			}
		let evidenceLines = snapshotHostUiSmokeLogEvidence();
		if (scenario.id === "p7-chat-benchmark-web-restore") {
			const skipSsim = process.env.COPILOT_BRO_UI_SMOKE_BENCHMARK_PAGE_SSIM?.trim() === "0";
			const gate = await evaluateCapturedHostUiSmokeBenchmarkPageSsim(extensionSmokeLogger(), { skip: skipSsim });
			if (!gate.passed) {
				const message = `Integration scenario ${scenario.id} benchmark page SSIM <99% or restore replay failed: ${gate.failure ?? "unknown"}`;
				suiteOk = false;
				firstFailureMessage ??= message;
				extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.scenario.end", {
					scenarioId: scenario.id,
					ok: false,
					reason: "benchmark-page-ssim",
					ssim: gate.ssim,
					failure: gate.failure,
					ms: Date.now() - started
				});
				extensionSmokeLogger()?.warn("host-ui-smoke.chat.integration.scenario.failed", { message });
				continue;
			}
			evidenceLines = snapshotHostUiSmokeLogEvidence();
		}
		const { missing, forbiddenHit } = findMissingLogMarkers(
			evidenceLines,
			scenario.requiredLogMarkers,
			scenario.forbiddenLogMarkers ?? []
		);
		if (missing.length > 0 || forbiddenHit.length > 0) {
			const message = `Integration scenario ${scenario.id} log evidence incomplete: missing=[${missing.join(", ")}] forbidden=[${forbiddenHit.join(", ")}]`;
			suiteOk = false;
			firstFailureMessage ??= message;
			extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.scenario.end", {
				scenarioId: scenario.id,
				ok: false,
				missing,
				forbiddenHit,
				evidenceSample: evidenceLines.slice(-8),
				ms: Date.now() - started
			});
			extensionSmokeLogger()?.warn("host-ui-smoke.chat.integration.scenario.failed", { message });
			continue;
		}
		logHostUiSmokeChatOutput({
			kind: "integration-scenario",
			preview: lastResponseText || "<empty>",
			scenarioId: scenario.id,
			ok: true
		});
		extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.scenario.end", {
			scenarioId: scenario.id,
			ok: true,
			turnCount,
			evidenceMarkers: scenario.requiredLogMarkers,
			responseLength: lastResponseText.length,
			ms: Date.now() - started
		});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			extensionSmokeLogger()?.error("host-ui-smoke.chat.lm.error", { scenarioId: scenario.id, message });
			logHostUiSmokeChatOutput({ kind: "integration-scenario", preview: message, scenarioId: scenario.id, ok: false });
			extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.scenario.end", {
				scenarioId: scenario.id,
				ok: false,
				message,
				ms: Date.now() - started
			});
			extensionSmokeLogger()?.warn("host-ui-smoke.chat.participant.failed", { message });
			return { ok: false, result: { errorDetails: { message } } };
		}
	}
	const scenarioIds = scenarios.map((scenario) => scenario.id);
	const consistency = validateHostUiSmokeChatIntegrationConsistency(
		await readHostUiSmokeAutomationLogText(),
		scenarioIds
	);
	extensionSmokeLogger()?.info("host-ui-smoke.chat.consistency.end", {
		ok: consistency.ok,
		checks: consistency.checks
	});
	const integrationOk = consistency.ok && suiteOk;
	extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.suite.summary", {
		scenarioIds,
		ok: integrationOk,
		count: scenarios.length,
		suiteOk,
		consistencyOk: consistency.ok
	});
	if (!consistency.ok) {
		const message = `Host UI smoke chat integration consistency failed: ${consistency.checks.filter((c) => !c.ok).map((c) => c.id).join(", ")}`;
		extensionSmokeLogger()?.warn("host-ui-smoke.chat.participant.failed", { message });
		return { ok: false, result: { errorDetails: { message } } };
	}
	if (!suiteOk) {
		const message = firstFailureMessage ?? "Host UI smoke chat integration suite failed.";
		extensionSmokeLogger()?.warn("host-ui-smoke.chat.participant.failed", { message });
		return { ok: false, result: { errorDetails: { message } } };
	}
	return { ok: true, lastResponseText };
}

