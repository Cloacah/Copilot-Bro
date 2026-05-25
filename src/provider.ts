import * as vscode from "vscode";
import type {
	CancellationToken,
	LanguageModelChatInformation,
	LanguageModelChatRequestOptions,
	LanguageModelChatProvider,
	LanguageModelChatRequestMessage,
	LanguageModelResponsePart,
	Progress,
	ProvideLanguageModelChatResponseOptions
} from "vscode";
import { findModelConfig, getRuntimeModelId, getSettings, isWrappedLanguageModelConfig, validateModelConfig } from "./config/settings";
import { writeScopedModelEntry } from "./config/configScope";
import { isolateFailedBatch } from "./agentSession/batchPlanner";
import { failBatch } from "./agentSession/sessionManager";
import { ProviderError, normalizeUnknownError } from "./errors";
import { Logger } from "./logger";
import { getDeclaredImageInputCapability } from "./modelCapabilities";
import { buildAttributionHeaders, buildModelCapabilities, collectImageRefs, createRequestTrace, formatVisionStatus } from "./providerOrchestration";
import { ensureApiKey } from "./secrets";
import type { ChatCompletionUsage, ExtensionSettings, ModelConfig, OpenAIMessage, OpenAIToolCall, StreamEvent } from "./types";
import { convertMessages, encodeReasoningMarker, estimateOpenAIMessageTokens, estimateTokens, normalizeToolCallId, repairReasoningToolHistory } from "./openaiCompat/messages";
import { applyLongTermMemoryBudget } from "./memory/memoryTokenBudget";
import { logPromptBudgetPressure } from "./tokenBudget";
import { buildHeaders, buildRequestBody } from "./openaiCompat/request";
import { sendChatCompletion } from "./openaiCompat/client";
import { fingerprintAssistantTurn, readReasoningCache, ReasoningCache, writeReasoningCache } from "./reasoningCache";
import { prependSelectedPromptPreset } from "./promptPresets";
import { needsVision } from "./toolCooperation/needVisionDetector";
import { needsVisionFromRequestMessages } from "./visionProtocol/visionMessageScan";
import { HostUiSmokeLogEvent } from "./visionProtocol/hostUiSmokeLogEvents";
import { createVisionDetailsText } from "./toolCooperation/outputSemantics";
import { createVisionProgressReporter } from "./toolCooperation/visionProgressReporter";
import type { ToolSelection } from "./toolCooperation/toolSelector";
import { prependVisionPromptContract, buildVisionPromptContract } from "./toolCooperation/visionPromptContract";
import { getImageAnalyzeAdapter } from "./toolCooperation/adapters/registry";
import {
	appendNativeVisionPostCompletionProgress,
	applyVisionResidualImageGuard,
	reportVisionRouteChatDebug,
	runVisionPreRoute,
	runVisionStrategyBranch,
	type VisionRouteReporter
} from "./providerVisionBranch";
import { buildWrappedLanguageModelRequest, getCachedWrappedLanguageModelConfigs, resolveWrappedLanguageModel } from "./vscodeLmWrapper";
import { isVisionProxyEnabledForModel } from "./visionProxy";
import { isVisionOrchestrationSuppressed } from "./visionOrchestrationContext";
import {
	buildThinkingOnlyFallbackText,
	hasSubstantiveChatResponse,
	usageIndicatesLengthStop,
	type ChatResponseReplaySnapshot
} from "./responseCompletion";

type ResponseProgress = Progress<LanguageModelResponsePart>;

interface ResponseReplayState extends ChatResponseReplaySnapshot {
	toolCallIds: string[];
	toolCalls: OpenAIToolCall[];
	displayedThinkingLength: number;
	usage?: ChatCompletionUsage;
}

type ModelPickerOptions = ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Record<string, unknown>;
	readonly modelOptions?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

type ModelPickerChatInformation = LanguageModelChatInformation & {
	readonly isUserSelectable?: boolean;
	readonly statusIcon?: vscode.ThemeIcon;
	readonly configurationSchema?: unknown;
};

export class ExtendedModelsProvider implements LanguageModelChatProvider {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
	private readonly reasoningByToolCallId = new Map<string, string>();
	private readonly assistantMessageByToolCallId = new Map<string, OpenAIMessage>();
	private readonly reasoningCache: ReasoningCache;
	private readonly statusBar: vscode.StatusBarItem;
	readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly secrets: vscode.SecretStorage,
		private readonly logger: Logger,
		private readonly getSettingsForProvider = getSettings
	) {
		this.reasoningCache = readReasoningCache(context);
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
		this.statusBar.name = "Copilot Bro Token Usage";
		this.statusBar.command = "extendedModels.showOutput";
		this.statusBar.tooltip = "Estimated token usage for Copilot Bro. Copilot's built-in context widget may show 0% for third-party providers due to a VS Code/Copilot limitation.";
		context.subscriptions.push(this.statusBar);
	}

	refreshModels(): void {
		this.onDidChangeEmitter.fire();
	}

	dispose(): void {
		this.onDidChangeEmitter.dispose();
		this.statusBar.dispose();
	}

	async provideLanguageModelChatInformation(
		_options: { readonly silent: boolean },
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		const settings = this.getSettingsForProvider();
		this.logger.setLevel(settings.logLevel);
		const models = listRuntimeModels(settings.models);

		return models.map((model) => toLanguageModelInfo(model, settings));
	}

	async provideTokenCount(
		_model: LanguageModelChatInformation,
		text: string | LanguageModelChatRequestMessage,
		_token: CancellationToken
	): Promise<number> {
		return estimateTokens(text);
	}

	async provideLanguageModelChatResponse(
		modelInfo: LanguageModelChatInformation,
		messages: readonly LanguageModelChatRequestMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: ResponseProgress,
		token: CancellationToken
	): Promise<void> {
		const settings = this.getSettingsForProvider();
		this.logger.setLevel(settings.logLevel);
		const runtimeModels = listRuntimeModels(settings.models);

		const configuredModel = findModelConfig(modelInfo.id, runtimeModels);
		if (!configuredModel) {
			throw new ProviderError(`Model configuration not found: ${modelInfo.id}`, { code: "CONFIG", retryable: false });
		}
		const model = applyPickerConfiguration(configuredModel, options as ModelPickerOptions);
		await persistPickerConfiguration(configuredModel, model, this.logger);

		const validationError = validateModelConfig(model);
		if (validationError) {
			throw new ProviderError(validationError, { code: "CONFIG", retryable: false });
		}

		const wrappedTarget = isWrappedLanguageModelConfig(model)
			? await resolveWrappedLanguageModel(model, this.logger)
			: undefined;
		if (isWrappedLanguageModelConfig(model) && !wrappedTarget) {
			throw new ProviderError(`Wrapped VS Code model is unavailable: ${model.wrappedLanguageModelId}.`, { code: "CONFIG", retryable: false });
		}

		const apiKey = isWrappedLanguageModelConfig(model)
			? undefined
			: await ensureApiKey(this.secrets, model);
		if (!wrappedTarget && !apiKey) {
			throw new ProviderError(`Missing API key for provider ${model.provider}.`, { code: "AUTH", retryable: false });
		}

		const roleIds = {
			user: vscode.LanguageModelChatMessageRole.User,
			assistant: vscode.LanguageModelChatMessageRole.Assistant
		};
		let trace = createRequestTrace(settings.requestAttribution);
		const detectionMessages = convertMessages(messages, { ...model, vision: true }, roleIds);
		const modelCapabilities = buildModelCapabilities(model, settings);
		const visionNeeded = !isVisionOrchestrationSuppressed()
			&& (needsVisionFromRequestMessages(messages, modelCapabilities, settings.visionProcessing)
				|| needsVision(detectionMessages, modelCapabilities, settings.visionProcessing));
		let strategySelection: ToolSelection | undefined;
		let resolvedMessages = messages;
		let visionStatusStarted = false;
		let plannedBatchCount = 0;
		let activeBatchId: string | undefined;
		let nativeVisionImageHashes: string[] = [];
		const analyzer = getImageAnalyzeAdapter();
		const visionProgressReporter = createVisionProgressReporter();
		const chatDebugVisible = settings.visionProcessing.chatDebugVisibility;
		const visionReporter: VisionRouteReporter = {
			appendProgress: (text) => {
				visionProgressReporter.append(text);
			},
			flushProgress: () => {
				const meta = visionProgressReporter.flush(progress, chatDebugVisible);
				if (meta && process.env.COPILOT_BRO_UI_SMOKE === "1") {
					this.logger.info(HostUiSmokeLogEvent.visionProgressFlush, meta);
				}
			},
			reportChatDebug: (text) => {
				reportVisionRouteChatDebug(progress, text, chatDebugVisible);
			}
		};

		if (visionNeeded) {
			const preRoute = await runVisionPreRoute({
				messages: resolvedMessages,
				detectionMessages,
				model,
				settings,
				logger: this.logger,
				analyzer,
				reporter: visionReporter
			});
			resolvedMessages = preRoute.messages;
			if (preRoute.shouldStop) {
				return;
			}

			const branch = await runVisionStrategyBranch({
				messages,
				detectionMessages,
				resolvedMessages,
				model,
				settings,
				logger: this.logger,
				token,
				modelCapabilities,
				apiKey,
				wrappedTarget,
				trace,
				analyzer,
				reporter: visionReporter
			});
			resolvedMessages = branch.messages;
			trace = branch.trace;
			strategySelection = branch.strategySelection;
			visionStatusStarted = branch.visionStatusStarted;
			plannedBatchCount = branch.plannedBatchCount;
			activeBatchId = branch.activeBatchId;
			nativeVisionImageHashes = branch.nativeVisionImageHashes;
			if (branch.shouldStop) {
				return;
			}
		} else {
			resolvedMessages = messages;
		}

		resolvedMessages = applyVisionResidualImageGuard(
			resolvedMessages,
			model,
			this.logger,
			strategySelection?.strategy ?? "unknown",
			trace,
			visionReporter
		);

		if (wrappedTarget) {
			const wrappedVisionContract = visionNeeded
				? buildVisionPromptContract(settings.visionProcessing.spatialSchemaVersion)
				: undefined;
			const wrappedRequest = await buildWrappedLanguageModelRequest(this.context, settings, resolvedMessages, wrappedVisionContract);
			const replayState: ResponseReplayState = {
				reasoningParts: [],
				textParts: [],
				toolCallIds: [],
				toolCalls: [],
				displayedThinkingLength: 0
			};

			this.updateStatusBar(model, wrappedRequest.estimatedPromptTokens);
			this.logger.info("request.start", {
				model: model.id,
				runtimeModelId: getRuntimeModelId(model),
				displayName: model.displayName ?? model.id,
				configId: model.configId,
				provider: model.provider,
				wrappedLanguageModelId: model.wrappedLanguageModelId,
				transport: "vscode-lm-wrapper",
				messageCount: wrappedRequest.messages.length,
				...trace,
				visionNeeded,
				plannedBatchCount,
				strategy: strategySelection?.strategy ?? "native"
			});

			try {
				await forwardWrappedLanguageModelRequest(wrappedTarget, wrappedRequest.messages, options, progress, token, replayState);
				ensureSubstantiveChatResponse(progress, replayState);
				this.updateStatusBar(model, wrappedRequest.estimatedPromptTokens, replayState);
				this.logger.info("request.end", {
					model: model.id,
					runtimeModelId: getRuntimeModelId(model),
					displayName: model.displayName ?? model.id,
					configId: model.configId,
					provider: model.provider,
					wrappedLanguageModelId: model.wrappedLanguageModelId,
					transport: "vscode-lm-wrapper",
					...trace
				});
				return;
			} catch (error) {
				const normalized = normalizeUnknownError(error);
				if (activeBatchId) {
					failBatch(activeBatchId);
					isolateFailedBatch(activeBatchId, normalized);
				}
				if (visionStatusStarted && strategySelection) {
					reportVisionProgress(progress, formatVisionStatus("failed", strategySelection, trace, settings.requestAttribution), settings.visionProcessing.chatDebugVisibility);
				}
				this.logger.error("request.failed", {
					model: model.id,
					runtimeModelId: getRuntimeModelId(model),
					displayName: model.displayName ?? model.id,
					configId: model.configId,
					provider: model.provider,
					wrappedLanguageModelId: model.wrappedLanguageModelId,
					transport: "vscode-lm-wrapper",
					...trace,
					status: normalized.status,
					code: normalized.code,
					message: normalized.message,
					url: normalized.url,
					body: normalized.body
				});
				throw normalized;
			}
		}

		let openAiMessages = convertMessages(resolvedMessages, model, roleIds);
		openAiMessages = prependVisionPromptContract(openAiMessages, settings.visionProcessing, visionNeeded);
		openAiMessages = await prependSelectedPromptPreset(this.context, settings, openAiMessages, { logger: this.logger });
		openAiMessages = repairReasoningToolHistory(openAiMessages, model, {
			getReasoning: (callId) => this.reasoningByToolCallId.get(callId),
			getAssistantMessage: (callId) => this.assistantMessageByToolCallId.get(callId),
			getReasoningForAssistant: (message) => this.reasoningCache.get(fingerprintAssistantTurn(message))
		});
		const workspaceMemoryId = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "global";
		const memoryBudget = applyLongTermMemoryBudget(openAiMessages, model, workspaceMemoryId, 0);
		openAiMessages = memoryBudget.messages;
		if (memoryBudget.selection.retained.length > 0) {
			this.logger.info("memory.budget.applied", {
				model: model.id,
				workspaceId: workspaceMemoryId,
				retainedCount: memoryBudget.selection.retained.length,
				droppedCount: memoryBudget.selection.dropped.length,
				memoryBudgetCeiling: memoryBudget.selection.memoryTokenBudget,
				retainedUnits: memoryBudget.selection.totalRetainedTokens
			});
		}
		const toolChoice = getToolChoice(options);
		const body = buildRequestBody(model, openAiMessages, options, toolChoice);
		const headers = buildHeaders(apiKey ?? "", model, buildAttributionHeaders(settings.requestAttribution, trace));
		const estimatedPromptTokens = estimateOpenAIMessageTokens(openAiMessages);
		logPromptBudgetPressure(this.logger, model, estimatedPromptTokens);
		this.updateStatusBar(model, estimatedPromptTokens);
		const replayState: ResponseReplayState = {
			reasoningParts: [],
			textParts: [],
			toolCallIds: [],
			toolCalls: [],
			displayedThinkingLength: 0
		};

		this.logger.info("request.start", {
			model: model.id,
			runtimeModelId: getRuntimeModelId(model),
			displayName: model.displayName ?? model.id,
			configId: model.configId,
			provider: model.provider,
			baseUrl: model.baseUrl,
			messageCount: messages.length,
			...trace,
			visionNeeded,
			plannedBatchCount,
			strategy: strategySelection?.strategy ?? "legacy-proxy"
		});
		this.logger.info("request.messages.summary", {
			model: model.id,
			...trace,
			summary: summarizeOpenAIMessages(body.messages)
		});
		this.logger.debug("request.body", {
			...trace,
			...body,
			messages: `[${body.messages.length} messages]`
		});

		try {
			await sendChatCompletion({
				apiKey: apiKey ?? "",
				model,
				body,
				headers,
				retry: settings.retry,
				timeoutMs: settings.requestTimeoutMs,
				cancellation: token,
				onEvent: (event) => {
					trackReplayState(replayState, event);
					reportStreamEvent(progress, event, replayState);
				},
				onRetry: (attempt, delayMs, error) => {
					this.logger.warn("request.retry", {
						model: model.id,
							...trace,
						attempt,
						delayMs,
						status: error.status,
						code: error.code,
						message: error.message
					});
				}
			});
			flushThinkingDisplay(progress, replayState, true);
			ensureSubstantiveChatResponse(progress, replayState);
			await this.rememberReasoning(replayState);
			await appendNativeVisionPostCompletionProgress({
				strategySelection,
				visionStatusStarted,
				nativeVisionImageHashes,
				assistantText: replayState.textParts.join(""),
				model,
				trace,
				settings,
				logger: this.logger,
				reporter: visionReporter
			});
			this.updateStatusBar(model, estimatedPromptTokens, replayState);
			this.logger.info("request.end", {
				model: model.id,
				runtimeModelId: getRuntimeModelId(model),
				displayName: model.displayName ?? model.id,
				configId: model.configId,
				...trace
			});
		} catch (error) {
			const normalized = normalizeUnknownError(error);
			if (activeBatchId) {
				failBatch(activeBatchId);
				isolateFailedBatch(activeBatchId, normalized);
			}
			if (visionStatusStarted && strategySelection) {
				reportVisionProgress(progress, formatVisionStatus("failed", strategySelection, trace, settings.requestAttribution), settings.visionProcessing.chatDebugVisibility);
			}
			this.logger.error("request.failed", {
				model: model.id,
				runtimeModelId: getRuntimeModelId(model),
				displayName: model.displayName ?? model.id,
				configId: model.configId,
				provider: model.provider,
				...trace,
				status: normalized.status,
				code: normalized.code,
				message: normalized.message,
				url: normalized.url,
				body: normalized.body
			});
			throw normalized;
		}
	}
	private async rememberReasoning(state: ResponseReplayState): Promise<void> {
		const reasoning = state.reasoningParts.join("").trim();
		if (!reasoning) {
			return;
		}
		const assistantMessage: OpenAIMessage = {
			role: "assistant",
			content: state.textParts.join("") || "",
			reasoning_content: reasoning,
			tool_calls: state.toolCalls.length > 0 ? state.toolCalls : undefined
		};
		const fingerprint = fingerprintAssistantTurn(assistantMessage);
		if (fingerprint) {
			this.reasoningCache.set(fingerprint, reasoning);
			await writeReasoningCache(this.context, this.reasoningCache);
		}
		for (const toolCallId of state.toolCallIds) {
			const normalizedId = normalizeToolCallId(toolCallId);
			this.reasoningByToolCallId.set(normalizedId, reasoning);
			this.assistantMessageByToolCallId.set(normalizedId, assistantMessage);
		}
		trimMap(this.reasoningByToolCallId, 200);
		trimMap(this.assistantMessageByToolCallId, 200);
	}

	private updateStatusBar(model: ModelConfig, promptTokens: number, state?: ResponseReplayState): void {
		const maxOutput = getEffectiveMaxOutputTokens(model);
		const maxInput = getEffectiveMaxInputTokens(model);
		const completionTokens = normalizeTokenNumber(state?.usage?.completion_tokens)
			?? estimateTokens(state?.textParts.join("") ?? "");
		const actualPromptTokens = normalizeTokenNumber(state?.usage?.prompt_tokens) ?? promptTokens;
		const totalTokens = normalizeTokenNumber(state?.usage?.total_tokens) ?? actualPromptTokens + completionTokens;
		const percent = Math.min(999, Math.max(0, Math.round((actualPromptTokens / Math.max(1, maxInput)) * 100)));
		const modelName = model.displayName ?? model.id;
		this.statusBar.text = `$(pulse) Bro ${formatCompactTokens(actualPromptTokens)}/${formatCompactTokens(maxInput)} (${percent}%)`;
		this.statusBar.tooltip = [
			`${modelName}`,
			`Prompt: ${actualPromptTokens.toLocaleString()} / ${maxInput.toLocaleString()} input tokens`,
			`Completion: ${completionTokens.toLocaleString()} / ${maxOutput.toLocaleString()} output tokens`,
			`Total: ${totalTokens.toLocaleString()} tokens`,
			"Note: Copilot's built-in context window can show 0% for third-party providers; this status item uses the provider's own estimate/usage."
		].join("\n");
		this.statusBar.show();
	}
}

function toLanguageModelInfo(model: ModelConfig, settings?: ExtensionSettings): LanguageModelChatInformation {
	const maxOutput = getEffectiveMaxOutputTokens(model);
	const maxInput = getEffectiveMaxInputTokens(model);
	const detailParts = [
		model.providerDisplayName ?? model.provider,
		isWrappedLanguageModelConfig(model) ? "wrapped" : undefined,
		model.vision ? "vision" : undefined
	].filter(Boolean);

	const canUseVisionProxy = supportsVisionProxy(model, settings);
	const info: ModelPickerChatInformation = {
		id: getRuntimeModelId(model),
		name: model.displayName || model.id,
		family: model.family || "oai-compatible",
		version: "1.0.0",
		maxInputTokens: maxInput,
		maxOutputTokens: maxOutput,
		tooltip: createModelTooltip(model, maxInput, maxOutput, settings),
		detail: detailParts.join(" · "),
		isUserSelectable: true,
		configurationSchema: createModelConfigurationSchema(model),
		capabilities: {
			imageInput: getDeclaredImageInputCapability(model, { proxyAvailable: canUseVisionProxy }),
			toolCalling: model.toolCalling
		}
	};
	return info;
}

function supportsVisionProxy(model: ModelConfig, settings?: ExtensionSettings): boolean {
	if (!settings) {
		return model.vision ? Boolean(model.visionProxyModelId?.trim()) : model.visionProxyModelId !== null;
	}
	return isVisionProxyEnabledForModel(model, settings);
}

function describeVisionMode(model: ModelConfig, settings?: ExtensionSettings): string {
	if (model.vision) {
		return supportsVisionProxy(model, settings) ? "native + proxy" : "native";
	}
	if (typeof model.visionProxyModelId === "string" && model.visionProxyModelId.trim()) {
		return "proxy (model)";
	}
	if (model.visionProxyModelId === null) {
		return "no";
	}
	return settings?.visionProxy.enabled ? "proxy (global)" : "no";
}

function summarizeOpenAIMessages(messages: readonly OpenAIMessage[]): Record<string, unknown> {
	const roleCounts: Record<string, number> = {
		system: 0,
		user: 0,
		assistant: 0,
		tool: 0
	};

	let stringContentMessages = 0;
	let arrayContentMessages = 0;
	let nullOrEmptyContentMessages = 0;
	let textPartCount = 0;
	let imagePartCount = 0;
	let toolCallCount = 0;
	let toolResultCount = 0;
	let reasoningMessageCount = 0;

	for (const message of messages) {
		roleCounts[message.role] = (roleCounts[message.role] ?? 0) + 1;

		if (typeof message.content === "string") {
			stringContentMessages += 1;
			if (!message.content.trim()) {
				nullOrEmptyContentMessages += 1;
			}
		} else if (Array.isArray(message.content)) {
			arrayContentMessages += 1;
			if (message.content.length === 0) {
				nullOrEmptyContentMessages += 1;
			}
			for (const part of message.content) {
				if (part.type === "text") {
					textPartCount += 1;
				} else if (part.type === "image_url") {
					imagePartCount += 1;
				}
			}
		} else {
			nullOrEmptyContentMessages += 1;
		}

		if (message.tool_calls?.length) {
			toolCallCount += message.tool_calls.length;
		}
		if (message.tool_call_id) {
			toolResultCount += 1;
		}
		if (message.reasoning_content?.trim()) {
			reasoningMessageCount += 1;
		}
	}

	return {
		totalMessages: messages.length,
		roleCounts,
		stringContentMessages,
		arrayContentMessages,
		nullOrEmptyContentMessages,
		textPartCount,
		imagePartCount,
		hasImageParts: imagePartCount > 0,
		toolCallCount,
		toolResultCount,
		reasoningMessageCount
	};
}

function createModelTooltip(model: ModelConfig, maxInput: number, maxOutput: number, settings?: ExtensionSettings): string {
	const hints = model.parameterHints ?? {};
	const connectionLine = isWrappedLanguageModelConfig(model)
		? `Wrapped target: ${(model.wrappedLanguageModelVendor ?? model.provider)} / ${model.wrappedLanguageModelId}`
		: `Base URL: ${model.baseUrl ?? "default"}`;
	return [
		`${model.displayName ?? model.id} (${model.id})`,
		`Provider: ${model.providerDisplayName ?? model.provider}`,
		connectionLine,
		`Context: ${formatCompactTokens(maxInput)} input + ${formatCompactTokens(maxOutput)} output`,
		`Vision: ${describeVisionMode(model, settings)}; Tools: ${model.toolCalling ? "yes" : "no"}; Thinking: ${model.thinking?.type ?? "not set"}`,
		`Temperature: ${model.temperature ?? hints.temperature?.recommended ?? "not set"}`,
		"Use Copilot Bro: Open Model Settings for the full editor. Newer Copilot hosts may also show quick controls here."
	].join("\n");
}

function createModelConfigurationSchema(model: ModelConfig): unknown {
	if (isWrappedLanguageModelConfig(model)) {
		return undefined;
	}
	const properties: Record<string, unknown> = {};
	const hints = model.parameterHints ?? {};
	if (hints.temperature) {
		properties.temperature = {
			type: "number",
			title: "Temperature",
			minimum: hints.temperature.min,
			maximum: hints.temperature.max,
			default: model.temperature ?? hints.temperature.recommended,
			group: "navigation"
		};
	}
	return Object.keys(properties).length > 0 ? { properties } : undefined;
}

function applyPickerConfiguration(model: ModelConfig, options: ModelPickerOptions): ModelConfig {
	const configuration = mergePickerConfigurations(options.modelConfiguration, options.modelOptions, options.configuration);
	const next: ModelConfig = { ...model };
	const reasoningEffort = getConfiguredReasoningEffort(model, configuration);
	if (reasoningEffort) {
		next.reasoningEffort = reasoningEffort;
	}
	const temperature = getConfigurationNumber(configuration, ["temperature"]);
	if (temperature !== undefined) {
		const hint = model.parameterHints?.temperature;
		const min = hint?.min ?? 0;
		const max = hint?.max ?? 2;
		next.temperature = Math.min(max, Math.max(min, temperature));
	}
	return next;
}

function mergePickerConfigurations(...sources: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const source of sources) {
		if (!source || typeof source !== "object") {
			continue;
		}
		Object.assign(out, source);
	}
	return out;
}

function getConfiguredReasoningEffort(model: ModelConfig, configuration: Record<string, unknown>): string | undefined {
	const raw = getConfigurationValue(configuration, ["reasoningEffort", "reasoning_effort", "thinkingEffort", "thinking_effort", "thinkingLevel", "thinking_level"]);
	const value = typeof raw === "string" ? raw.trim() : undefined;
	if (!value) {
		return undefined;
	}
	const options = model.parameterHints?.reasoningEffort?.options;
	if (!options?.length) {
		return value;
	}
	const normalized = value.toLowerCase();
	const matched = options.find((option) => option.toLowerCase() === normalized);
	return matched;
}

async function persistPickerConfiguration(base: ModelConfig, configured: ModelConfig, logger: Logger): Promise<void> {
	if (isWrappedLanguageModelConfig(base) || isWrappedLanguageModelConfig(configured)) {
		return;
	}
	if (base.reasoningEffort === configured.reasoningEffort && base.temperature === configured.temperature) {
		return;
	}
	const config = vscode.workspace.getConfiguration("extendedModels");
	const override: ModelConfig = { ...configured, builtIn: undefined };
	await writeScopedModelEntry(config, override, getSettings().configWriteScope);
	logger.info("modelPicker.configuration.persisted", {
		model: configured.id,
		reasoningEffort: configured.reasoningEffort,
		temperature: configured.temperature
	});
}

function getConfigurationString(configuration: Record<string, unknown>, keys: string[]): string | undefined {
	const value = getConfigurationValue(configuration, keys);
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getConfigurationNumber(configuration: Record<string, unknown>, keys: string[]): number | undefined {
	const value = getConfigurationValue(configuration, keys);
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
		return Number(value);
	}
	return undefined;
}

function getConfigurationValue(configuration: unknown, keys: string[]): unknown {
	if (!configuration || typeof configuration !== "object") {
		return undefined;
	}
	const normalizedKeys = new Set(keys.map(normalizeConfigKey));
	for (const [key, value] of Object.entries(configuration as Record<string, unknown>)) {
		if (normalizedKeys.has(normalizeConfigKey(key))) {
			return value;
		}
	}
	for (const value of Object.values(configuration as Record<string, unknown>)) {
		const nested = getConfigurationValue(value, keys);
		if (nested !== undefined) {
			return nested;
		}
	}
	return undefined;
}

function normalizeConfigKey(key: string): string {
	return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isAllowedReasoningEffort(model: ModelConfig, value: string): boolean {
	const options = model.parameterHints?.reasoningEffort?.options;
	return !options?.length || options.includes(value);
}

function getToolChoice(options: ProvideLanguageModelChatResponseOptions): "required" | string | undefined {
	const tools = options.tools ?? [];
	const toolMode = (vscode as unknown as { LanguageModelChatToolMode?: { Required?: unknown } }).LanguageModelChatToolMode;
	const required = toolMode?.Required !== undefined && options.toolMode === toolMode.Required;
	if (!required) {
		return undefined;
	}
	return tools.length === 1 ? tools[0].name : "required";
}

async function forwardWrappedLanguageModelRequest(
	target: vscode.LanguageModelChat,
	messages: readonly vscode.LanguageModelChatMessage[],
	options: ProvideLanguageModelChatResponseOptions,
	progress: ResponseProgress,
	token: CancellationToken,
	state: ResponseReplayState
): Promise<void> {
	const requestOptions: LanguageModelChatRequestOptions = {
		justification: "Copilot Bro wrapper profile forwarding"
	};
	if (options.tools?.length) {
		requestOptions.tools = [...options.tools];
	}
	if (options.toolMode !== undefined) {
		requestOptions.toolMode = options.toolMode;
	}
	const pickerOptions = options as ModelPickerOptions;
	if (pickerOptions.modelOptions && typeof pickerOptions.modelOptions === "object") {
		requestOptions.modelOptions = { ...pickerOptions.modelOptions };
	}

	const response = await target.sendRequest([...messages], requestOptions, token);
	for await (const part of response.stream) {
		if (part instanceof vscode.LanguageModelTextPart) {
			state.textParts.push(part.value);
		}
		progress.report(part as LanguageModelResponsePart);
	}
}

function listRuntimeModels(models: readonly ModelConfig[]): ModelConfig[] {
	const wrapped = getCachedWrappedLanguageModelConfigs();
	if (wrapped.length === 0) {
		return [...models];
	}
	const out = new Map<string, ModelConfig>();
	for (const model of models) {
		out.set(getRuntimeModelId(model), model);
	}
	for (const model of wrapped) {
		out.set(getRuntimeModelId(model), model);
	}
	return Array.from(out.values());
}

function reportStreamEvent(progress: ResponseProgress, event: StreamEvent, state: ResponseReplayState): void {
	if (event.type === "thinking") {
		reportThinking(progress, event.text, event.id, state, false);
		return;
	}
	flushThinkingDisplay(progress, state, true);
	if (event.type === "text") {
		progress.report(new vscode.LanguageModelTextPart(event.text));
		return;
	}
	if (event.type === "tool_call") {
		progress.report(new vscode.LanguageModelToolCallPart(event.id, event.name, event.input));
		return;
	}
}

function trackReplayState(state: ResponseReplayState, event: StreamEvent): void {
	if (event.type === "thinking") {
		state.reasoningParts.push(event.text);
	} else if (event.type === "text") {
		state.textParts.push(event.text);
	} else if (event.type === "tool_call") {
		state.toolCallIds.push(event.id);
		state.toolCalls.push({
			id: event.id,
			type: "function",
			function: {
				name: event.name,
				arguments: JSON.stringify(event.input)
			}
		});
	} else if (event.type === "finish") {
		state.finishReason = event.reason;
	} else if (event.type === "usage") {
		state.usage = event.usage;
		if (!state.finishReason && usageIndicatesLengthStop(event.usage)) {
			state.finishReason = "length";
		}
	}
}

function ensureSubstantiveChatResponse(progress: ResponseProgress, state: ResponseReplayState): void {
	if (hasSubstantiveChatResponse(state)) {
		return;
	}
	const fallback = buildThinkingOnlyFallbackText(state);
	progress.report(new vscode.LanguageModelTextPart(fallback));
	state.textParts.push(fallback);
}

function getEffectiveMaxOutputTokens(model: ModelConfig): number {
	const configured = model.maxCompletionTokens ?? model.maxOutputTokens;
	return Math.max(1, Math.min(configured, Math.max(1, model.contextLength - 1)));
}

function getEffectiveMaxInputTokens(model: ModelConfig): number {
	return Math.max(1, model.contextLength - getEffectiveMaxOutputTokens(model));
}

function normalizeTokenNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function formatCompactTokens(value: number): string {
	if (value >= 1000000) {
		return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
	}
	if (value >= 1000) {
		return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
	}
	return String(value);
}

function reportThinking(
	progress: ResponseProgress,
	text: string,
	id: string | undefined,
	state: ResponseReplayState,
	force: boolean
): void {
	const thinkingPart = (vscode as unknown as {
		LanguageModelThinkingPart?: new (value: string, id?: string) => LanguageModelResponsePart;
	}).LanguageModelThinkingPart;
	if (thinkingPart) {
		progress.report(new thinkingPart(text, id));
		state.displayedThinkingLength += text.length;
		return;
	}

	const allReasoning = state.reasoningParts.join("");
	if (!force && allReasoning.length - state.displayedThinkingLength < 800) {
		return;
	}
	flushThinkingDisplay(progress, state, force);
}

/** @deprecated Prefer {@link createVisionProgressReporter} batching; kept for direct one-shot reports. */
function reportVisionProgress(progress: ResponseProgress, text: string, visible: boolean): void {
	const reporter = createVisionProgressReporter();
	reporter.append(text);
	reporter.flush(progress, visible);
}

function flushThinkingDisplay(progress: ResponseProgress, state: ResponseReplayState, force: boolean): void {
	const allReasoning = state.reasoningParts.join("");
	const chunk = allReasoning.slice(state.displayedThinkingLength);
	if (!chunk || (!force && chunk.length < 800)) {
		return;
	}
	state.displayedThinkingLength = allReasoning.length;
	progress.report(new vscode.LanguageModelTextPart(renderThinkingDetails(chunk)));
}

function renderThinkingDetails(text: string): string {
	const trimmed = text.trim();
	const summary = createThinkingSummary(trimmed);
	return [
		encodeReasoningMarker(text),
		`<details data-extended-models-reasoning="true">`,
		`<summary>思考过程 · ${summary}</summary>`,
		"",
		trimmed || text,
		"</details>",
		""
	].join("\n");
}

function createThinkingSummary(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "正在思考";
	}
	const tail = normalized.slice(-96);
	return escapeHtml(tail);
}

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function trimMap<TKey, TValue>(map: Map<TKey, TValue>, maxSize: number): void {
	while (map.size > maxSize) {
		const first = map.keys().next();
		if (first.done) {
			return;
		}
		map.delete(first.value);
	}
}
