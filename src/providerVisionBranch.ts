import * as vscode from "vscode";
import { createHash } from "node:crypto";
import type {
	CancellationToken,
	LanguageModelChatRequestMessage,
	LanguageModelResponsePart,
	Progress
} from "vscode";
import { deduplicateRefs, isolateFailedBatch, splitIntoBatches } from "./agentSession/batchPlanner";
import { completeBatch, createSessionIfEnabled, failBatch, markSessionReady, startBatch } from "./agentSession/sessionManager";
import { Logger } from "./logger";
import { collectImageRefs, createRequestTrace, formatVisionStatus, type RequestTraceContext } from "./providerOrchestration";
import { applyVisionProcessingAndIntegrityPipeline } from "./providerVisionPipeline";
import type { ExtensionSettings, ModelConfig, OpenAIMessage } from "./types";
import { buildDisabledVisionMessage, buildFallbackPlan, buildTextFallback } from "./toolCooperation/fallbackPlanner";
import { getImageAnalyzeAdapter } from "./toolCooperation/adapters/registry";
import type { ImageAnalyzeAdapter } from "./toolCooperation/adapters/types";
import {
	createChatDebugDetailsText,
	createVisionInputBindingSummary,
	formatVisionStructuredThinkingBlock
} from "./toolCooperation/outputSemantics";
import { selectTool, type ModelCapabilities, type ToolSelection } from "./toolCooperation/toolSelector";
import {
	resolveNativeVisionStructuredMessages,
	resolveVisionProxyMessages,
	type VisionProxyStructuredProgress
} from "./visionProxy";
import { finalizeNativeVisionStructuredHandoff } from "./visionProtocol/nativeVisionStructuredHandoff";
import { createVisionEvidenceId, upsertVisionEvidenceRecord } from "./visionProtocol/visionEvidenceStore";
import { createVisionTaskStack } from "./visionProtocol/visionTaskStack";
import { collectImageRefsFromRequestMessages } from "./visionProtocol/visionMessageScan";
import { evaluateRoiGateWithTimeout } from "./visionProtocol/roiRuntimeGuard";
import { VisionLogEvent } from "./visionProtocol/visionLogEvents";

export type VisionResponseProgress = Progress<LanguageModelResponsePart>;

export interface VisionRouteReporter {
	appendProgress(text: string): void;
	flushProgress(): void;
	reportChatDebug(text: string): void;
}

export interface VisionPreRouteInput {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	detectionMessages: readonly OpenAIMessage[];
	model: ModelConfig;
	settings: ExtensionSettings;
	logger: Logger;
	analyzer: ImageAnalyzeAdapter;
	reporter: VisionRouteReporter;
}

export interface VisionPreRouteResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	shouldStop: boolean;
}

export interface VisionStrategyBranchInput {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	detectionMessages: readonly OpenAIMessage[];
	resolvedMessages: readonly vscode.LanguageModelChatRequestMessage[];
	model: ModelConfig;
	settings: ExtensionSettings;
	logger: Logger;
	token: CancellationToken;
	modelCapabilities: ModelCapabilities;
	apiKey: string | undefined;
	wrappedTarget: vscode.LanguageModelChat | undefined;
	trace: RequestTraceContext;
	analyzer: ImageAnalyzeAdapter;
	reporter: VisionRouteReporter;
}

export interface VisionStrategyBranchResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	trace: RequestTraceContext;
	strategySelection: ToolSelection;
	visionStatusStarted: boolean;
	plannedBatchCount: number;
	activeBatchId?: string;
	nativeVisionImageHashes: string[];
	shouldStop: boolean;
}

export function reportVisionRouteChatDebug(progress: VisionResponseProgress, text: string, visible: boolean): void {
	if (!visible) {
		return;
	}
	const detailsText = createChatDebugDetailsText(text);
	if (!detailsText) {
		return;
	}
	const thinkingPart = (vscode as unknown as {
		LanguageModelThinkingPart?: new (value: string, id?: string) => LanguageModelResponsePart;
	}).LanguageModelThinkingPart;
	if (thinkingPart) {
		progress.report(new thinkingPart(detailsText, "vision-debug"));
		return;
	}
	progress.report(new vscode.LanguageModelTextPart(renderChatDebugDetails(detailsText)));
}

export async function runVisionPreRoute(input: VisionPreRouteInput): Promise<VisionPreRouteResult> {
	let messages = input.messages;
	const preprocessed = await applyVisionProcessingAndIntegrityPipeline(messages, input.settings, input.logger);
	messages = preprocessed.messages;
	if (preprocessed.summary) {
		input.reporter.appendProgress(preprocessed.summary);
	}
	if (preprocessed.blocked) {
		const fallback = buildFallbackPlan(
			preprocessed.blockReason ?? "Vision integrity strict mode blocked downstream processing.",
			[...input.detectionMessages]
		);
		input.reporter.reportChatDebug(String(fallback.content ?? ""));
		input.reporter.flushProgress();
		return { messages, shouldStop: true };
	}
	const initialRoiGate = await evaluateRoiGateWithTimeout(
		input.logger,
		{
			messages,
			certaintyThreshold: input.settings.visionIntegrity.certaintyThreshold,
			analyzer: input.analyzer
		},
		"pre-route",
		input.model.id
	);
	if (initialRoiGate.blocked) {
		input.logger.info(VisionLogEvent.roiConfidenceBlocked, {
			model: input.model.id,
			stage: "pre-route",
			threshold: initialRoiGate.threshold,
			max_confidence: initialRoiGate.maxConfidence,
			roi_count: initialRoiGate.roiCount,
			confidence_count: initialRoiGate.confidenceCount,
			image_bounds: initialRoiGate.imageBounds
		});
		const fallback = buildFallbackPlan(
			initialRoiGate.reason ?? "ROI confidence gate blocked destructive operations.",
			[...input.detectionMessages]
		);
		input.reporter.reportChatDebug(String(fallback.content ?? ""));
		input.reporter.flushProgress();
		return { messages, shouldStop: true };
	}
	return { messages, shouldStop: false };
}

export async function runVisionStrategyBranch(input: VisionStrategyBranchInput): Promise<VisionStrategyBranchResult> {
	const strategySelection = selectTool(true, input.modelCapabilities, input.settings.visionAgent);
	const imageRefs = deduplicateRefs(
		[...collectImageRefs([...input.detectionMessages]), ...collectImageRefsFromRequestMessages(input.messages)],
		input.settings.visionAgent
	);
	const plannedBatches = splitIntoBatches(imageRefs, input.settings.visionAgent.maxBatchSize);
	const plannedBatchCount = plannedBatches.length;
	const createdSession = imageRefs.length > 0 ? createSessionIfEnabled(input.settings.visionAgent) : undefined;
	const activeSession = createdSession ? (markSessionReady(createdSession.sessionId) ?? createdSession) : undefined;
	const activeBatch = activeSession && plannedBatches.length > 0
		? startBatch(activeSession.sessionId, plannedBatches[0], 0, 1)
		: undefined;
	const activeBatchId = activeBatch?.batchId;
	let trace = createRequestTrace(input.settings.requestAttribution, {
		requestId: input.trace.requestId,
		sessionId: activeSession?.sessionId,
		batchId: activeBatch?.batchId,
		batchIndex: activeBatch?.batchIndex
	});
	input.logger.info(VisionLogEvent.routeSelected, {
		model: input.model.id,
		...trace,
		plannedBatchCount,
		strategy: strategySelection.strategy,
		reason: strategySelection.reason
	});

	let resolvedMessages = input.resolvedMessages;
	let visionStatusStarted = false;
	let nativeVisionImageHashes: string[] = [];
	let shouldStop = false;

	const reportStructuredProgress = (structured: VisionProxyStructuredProgress): void => {
		const snapshotJson = structured.snapshotJson.trim() || "{}";
		input.reporter.appendProgress(
			formatVisionStructuredThinkingBlock(snapshotJson, {
				contract: structured.contract,
				elementCount: structured.elementCount,
				reused: structured.reused,
				sourceKind: structured.sourceKind,
				toolName: structured.toolName
			})
		);
	};

	switch (strategySelection.strategy) {
		case "proxy":
		case "wrapper-proxy": {
			input.reporter.appendProgress(
				formatVisionStatus("start", strategySelection, trace, input.settings.requestAttribution)
			);
			visionStatusStarted = true;
			const proxyResolution = await resolveVisionProxyMessages(
				resolvedMessages,
				input.model,
				input.settings,
				input.logger,
				input.token,
				{
					reportFailure: true,
					onStructuredProgress: reportStructuredProgress,
					onVisionUiProgress: input.reporter.appendProgress
				}
			);
			if (proxyResolution.status === "not-needed") {
				input.logger.info("vision.proxy.skipped", {
					model: input.model.id,
					...trace,
					plannedBatchCount,
					reason: "Proxy route selected but no image payload detected in current request messages."
				});
				resolvedMessages = proxyResolution.messages;
				input.reporter.flushProgress();
				break;
			}
			if (proxyResolution.status === "unavailable" || proxyResolution.status === "failed") {
				if (activeBatchId) {
					failBatch(activeBatchId);
					isolateFailedBatch(activeBatchId, new Error(proxyResolution.error ?? strategySelection.reason));
				}
				const fallbackReason = proxyResolution.error ?? strategySelection.reason;
				shouldStop = await handleVisionStrategyFallback(
					strategySelection,
					fallbackReason,
					input.detectionMessages,
					input.reporter
				);
				break;
			}
			resolvedMessages = proxyResolution.messages;
			const proxyRoiGate = await evaluateRoiGateWithTimeout(
				input.logger,
				{
					messages: resolvedMessages,
					certaintyThreshold: input.settings.visionIntegrity.certaintyThreshold,
					analyzer: input.analyzer
				},
				"proxy-route",
				input.model.id
			);
			if (proxyRoiGate.blocked) {
				if (activeBatchId) {
					completeBatch(activeBatchId);
				}
				input.logger.info(VisionLogEvent.roiConfidenceBlocked, {
					model: input.model.id,
					stage: "proxy-route",
					threshold: proxyRoiGate.threshold,
					max_confidence: proxyRoiGate.maxConfidence,
					roi_count: proxyRoiGate.roiCount,
					confidence_count: proxyRoiGate.confidenceCount,
					image_bounds: proxyRoiGate.imageBounds
				});
				const fallback = buildFallbackPlan(
					proxyRoiGate.reason ?? "ROI confidence gate blocked destructive operations.",
					[...input.detectionMessages]
				);
				input.reporter.reportChatDebug(String(fallback.content ?? ""));
				input.reporter.flushProgress();
				shouldStop = true;
				break;
			}
			if (activeBatchId) {
				completeBatch(activeBatchId);
			}
			input.reporter.appendProgress(
				formatVisionStatus("end", strategySelection, trace, input.settings.requestAttribution)
			);
			input.reporter.flushProgress();
			break;
		}
		case "plan-only": {
			const fallback = buildFallbackPlan(strategySelection.reason, [...input.detectionMessages]);
			input.reporter.reportChatDebug(String(fallback.content ?? ""));
			input.reporter.flushProgress();
			shouldStop = true;
			break;
		}
		case "text-fallback": {
			const fallback = buildTextFallback(strategySelection.reason);
			input.reporter.reportChatDebug(String(fallback.content ?? ""));
			input.reporter.flushProgress();
			shouldStop = true;
			break;
		}
		case "disabled": {
			const fallback = buildDisabledVisionMessage(strategySelection.reason);
			input.reporter.reportChatDebug(String(fallback.content ?? ""));
			input.reporter.flushProgress();
			shouldStop = true;
			break;
		}
		case "native": {
			input.reporter.appendProgress(
				formatVisionStatus("start", strategySelection, trace, input.settings.requestAttribution)
			);
			visionStatusStarted = true;
			if (!input.wrappedTarget && input.apiKey) {
				const nativeStructured = await resolveNativeVisionStructuredMessages(
					resolvedMessages,
					input.model,
					input.apiKey,
					input.settings,
					input.logger,
					input.token,
					{
						onStructuredProgress: reportStructuredProgress,
						onVisionUiProgress: input.reporter.appendProgress
					}
				);
				if (nativeStructured.status === "applied") {
					resolvedMessages = nativeStructured.messages;
					input.logger.info("vision.native.structured.pass", {
						model: input.model.id,
						...trace,
						cacheHitCount: nativeStructured.cacheHitCount,
						cacheMissCount: nativeStructured.cacheMissCount
					});
				} else {
					nativeVisionImageHashes = persistNativeVisionInputEvidence(resolvedMessages, input.model, input.logger);
				}
			} else {
				nativeVisionImageHashes = persistNativeVisionInputEvidence(resolvedMessages, input.model, input.logger);
			}
			break;
		}
	}

	return {
		messages: resolvedMessages,
		trace,
		strategySelection,
		visionStatusStarted,
		plannedBatchCount,
		activeBatchId,
		nativeVisionImageHashes,
		shouldStop
	};
}

export function applyVisionResidualImageGuard(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	model: ModelConfig,
	logger: Logger,
	strategy: ToolSelection["strategy"] | "unknown",
	trace: RequestTraceContext,
	reporter: VisionRouteReporter
): readonly vscode.LanguageModelChatRequestMessage[] {
	const residualImages = countImagePartsInMessages(messages);
	if (model.vision || residualImages === 0) {
		return messages;
	}
	logger.error(VisionLogEvent.guardResidualImages, {
		model: model.id,
		...trace,
		residualImagePartCount: residualImages,
		strategy
	});
	reporter.appendProgress(
		"[Vision] safety guard activated: stripped residual raw image payload from a non-vision model request."
	);
	reporter.flushProgress();
	return stripImagePartsFromMessages(
		messages,
		"[Image omitted by safety guard: raw image payload was blocked for a non-vision model.]"
	);
}

export async function appendNativeVisionPostCompletionProgress(input: {
	strategySelection: ToolSelection | undefined;
	visionStatusStarted: boolean;
	nativeVisionImageHashes: string[];
	assistantText: string;
	model: ModelConfig;
	trace: RequestTraceContext;
	settings: ExtensionSettings;
	logger: Logger;
	reporter: VisionRouteReporter;
}): Promise<void> {
	if (input.strategySelection?.strategy !== "native" || input.nativeVisionImageHashes.length === 0) {
		return;
	}
	const nativeFinalize = finalizeNativeVisionStructuredHandoff({
		assistantText: input.assistantText,
		modelId: input.model.id,
		imageHashes: input.nativeVisionImageHashes,
		logger: input.logger
	});
	if (!nativeFinalize.parsed) {
		return;
	}
	input.logger.info(VisionLogEvent.evidenceNativeCompleted, {
		model: input.model.id,
		...input.trace,
		evidenceIds: nativeFinalize.completedEvidenceIds,
		regionCount: nativeFinalize.regionCount
	});
	if (nativeFinalize.structuredSnapshotJson && nativeFinalize.structured) {
		input.reporter.appendProgress(
			formatVisionStructuredThinkingBlock(nativeFinalize.structuredSnapshotJson, {
				contract: nativeFinalize.structured.contract,
				elementCount: nativeFinalize.structured.elements.length,
				sourceKind: "message-image",
				route: "native"
			})
		);
		if (input.visionStatusStarted && input.strategySelection) {
			input.reporter.appendProgress(
				formatVisionStatus("end", input.strategySelection, input.trace, input.settings.requestAttribution)
			);
		}
		input.reporter.flushProgress();
	}
}

export function countImagePartsInMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): number {
	let count = 0;
	for (const message of messages) {
		for (const part of message.content ?? []) {
			if (isRequestImagePart(part)) {
				count += 1;
			}
		}
	}
	return count;
}

async function handleVisionStrategyFallback(
	selection: ToolSelection,
	fallbackReason: string,
	detectionMessages: readonly OpenAIMessage[],
	reporter: VisionRouteReporter
): Promise<boolean> {
	const detectionCopy = [...detectionMessages];
	switch (selection.fallbackStrategy ?? "text-fallback") {
		case "plan-only": {
			const fallback = buildFallbackPlan(fallbackReason, detectionCopy);
			reporter.reportChatDebug(String(fallback.content ?? ""));
			reporter.flushProgress();
			return true;
		}
		case "disabled": {
			const fallback = buildDisabledVisionMessage(fallbackReason);
			reporter.reportChatDebug(String(fallback.content ?? ""));
			reporter.flushProgress();
			return true;
		}
		case "text-fallback":
		default: {
			const fallback = buildTextFallback(fallbackReason);
			reporter.reportChatDebug(String(fallback.content ?? ""));
			reporter.flushProgress();
			return true;
		}
	}
}

function persistNativeVisionInputEvidence(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	model: ModelConfig,
	logger: Logger
): string[] {
	const evidenceIds: string[] = [];
	const taskStackIds: string[] = [];
	const imageHashes: string[] = [];
	for (const message of messages) {
		for (const part of message.content ?? []) {
			const imageHash = getRequestImagePartHash(part);
			if (!imageHash) {
				continue;
			}
			const id = createVisionEvidenceId(imageHash);
			upsertVisionEvidenceRecord({
				id,
				imageHash,
				route: "native",
				handoff: "description",
				taskStatus: "pending",
				modelId: model.id,
				description: "Native vision request forwarded with raw image payload for model-side description."
			});
			const stack = createVisionTaskStack(id, ["describe", "complete"]);
			evidenceIds.push(id);
			imageHashes.push(imageHash);
			taskStackIds.push(stack.id);
			logger.info(VisionLogEvent.inputBound, {
				model: model.id,
				imageHash,
				evidenceId: id,
				rawImageForwarded: true,
				summary: createVisionInputBindingSummary({
					sourceKind: "message-image",
					toolName: message.name,
					imageHash,
					evidenceId: id,
					route: "native",
					rawImageForwarded: true,
					reused: false
				})
			});
		}
	}
	if (evidenceIds.length > 0) {
		logger.info(VisionLogEvent.evidencePersisted, {
			model: model.id,
			evidenceIds,
			taskStackIds,
			handoff: "description",
			taskStatus: "pending",
			route: "native"
		});
	}
	return imageHashes;
}

function getRequestImagePartHash(part: unknown): string | undefined {
	if (!isRequestImagePart(part)) {
		return undefined;
	}
	const bytes = toRequestUint8Array(part.data);
	return bytes ? createHash("sha256").update(bytes).digest("hex") : undefined;
}

function stripImagePartsFromMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	notice: string
): readonly vscode.LanguageModelChatRequestMessage[] {
	return messages.map((message) => {
		let removed = false;
		const keptParts: vscode.LanguageModelInputPart[] = [];
		for (const part of message.content ?? []) {
			if (isRequestImagePart(part)) {
				removed = true;
				continue;
			}
			keptParts.push(part as vscode.LanguageModelInputPart);
		}
		if (!removed) {
			return message;
		}
		return {
			...message,
			content: [...keptParts, new vscode.LanguageModelTextPart(notice)],
			name: message.name
		} as vscode.LanguageModelChatRequestMessage;
	});
}

function isRequestImagePart(part: unknown): part is { mimeType: string; data: unknown } {
	if (!part || typeof part !== "object") {
		return false;
	}
	const record = part as Record<string, unknown>;
	if (typeof record.mimeType !== "string" || !record.mimeType.startsWith("image/")) {
		return false;
	}
	return toRequestUint8Array(record.data) !== undefined;
}

function toRequestUint8Array(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
		return new Uint8Array(value);
	}
	return undefined;
}

function renderChatDebugDetails(text: string): string {
	return `\`\`\`[Vision Debug]\n${text}\n\`\`\``;
}
