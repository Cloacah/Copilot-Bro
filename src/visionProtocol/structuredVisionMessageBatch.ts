import * as vscode from "vscode";
import { createHash } from "node:crypto";
import type { ExtensionSettings, ModelConfig } from "../types";
import {
	buildCompactStructuredSnapshot,
	STRUCTURED_PROXY_CONTRACT_VERSION
} from "../visionProxyStructuredPlan";
import {
	buildStructuredProxyProgressFromDescription,
	extractNormalizedProxySnapshotJson
} from "../visionProxyStructuredSnapshot";
import type { ProxyExecutionSummary } from "../visionStructuredPass";
import {
	enumerateVisionImageOccurrences,
	partitionRequestMessageImageParts,
	type VisionImageOccurrence,
	resolveVisionSourceKind
} from "./visionMessageScan";
import {
	resolveEffectiveVisionHandoffIntentForTurn,
	type VisionHandoffIntent
} from "./visionHandoffIntent";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import type { VisionEvidenceRoute } from "./visionEvidenceStore";
import { VisionLogEvent } from "./visionLogEvents";
import { Logger } from "../logger";
import { createVisionInputBindingSummary, errorMessages } from "../toolCooperation/outputSemantics";
import type { ProxyStructuredOutput } from "../visionProxyStructuredPlan";

export interface VisionStructuredProgress {
	stage: "cache-hit" | "executed";
	contract: string;
	elementCount: number;
	snapshotJson: string;
	sourceKind?: string;
	toolName?: string;
	reused: boolean;
}

export interface StructuredVisionBatchOptions {
	reportFailure?: boolean;
	onStructuredProgress?: (progress: VisionStructuredProgress) => void;
	onVisionUiProgress?: (line: string) => void;
}

export interface StructuredVisionBatchResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	status: "applied" | "failed";
	error?: string;
	cacheHitCount: number;
	cacheMissCount: number;
}

export interface StructuredVisionDescriptionResult {
	description: string;
	execution: ProxyExecutionSummary;
	structured?: ProxyStructuredOutput;
	/** When true, do not cache — candidate chain should try the next proxy model. */
	formatFallbackUsed?: boolean;
	/** When true, do not cache — raw text evidence is last-resort only. */
	textEvidenceUsed?: boolean;
}

type ResolveStructuredDescription = (
	imageParts: readonly vscode.LanguageModelDataPart[],
	finalPrompt: string,
	handoffIntent: VisionHandoffIntent
) => Promise<StructuredVisionDescriptionResult>;

export interface ApplyStructuredVisionMessageBatchInput {
	hydratedMessages: readonly vscode.LanguageModelChatRequestMessage[];
	fallbackMessages: readonly vscode.LanguageModelChatRequestMessage[];
	model: ModelConfig;
	visionModelId: string;
	settings: ExtensionSettings;
	logger: Logger;
	options: StructuredVisionBatchOptions;
	route: VisionEvidenceRoute;
	buildFinalPrompt: () => string;
	buildCacheKeyModelId: () => string;
	resolveDescription: ResolveStructuredDescription;
	getDescriptionFromCache: (cacheKey: string) => string | undefined;
	setDescriptionInCache: (cacheKey: string, description: string) => void;
	buildVisionCacheKey: (
		imageParts: readonly vscode.LanguageModelDataPart[],
		prompt: string,
		modelId: string
	) => string;
	persistEvidence: (
		imageParts: readonly vscode.LanguageModelDataPart[],
		description: string,
		execution: ProxyExecutionSummary | undefined,
		handoffIntent: VisionHandoffIntent
	) => Promise<{ evidenceIds: string[]; taskStackIds: string[]; artifactIds: string[] }>;
	appendDescription: (parts: vscode.LanguageModelInputPart[], description: string) => void;
	log: {
		cacheHit: string;
		cacheMiss: string;
		structured: string;
		failed: string;
		inputBoundModelField: "proxyModelId" | "visionModelId";
	};
	onCacheHit?: (input: {
		handoffIntent: VisionHandoffIntent;
		reused: boolean;
		proxyModelId?: string;
	}) => void;
	onCacheMiss?: (input: { handoffIntent: VisionHandoffIntent; proxyModelId?: string }) => void;
	onEvidencePersisted?: (input: {
		evidenceIds: string[];
		taskStackIds: string[];
		artifactIds: string[];
		handoffIntent: VisionHandoffIntent;
	}) => void;
	emitStructuredProgress: (
		logger: Logger,
		options: StructuredVisionBatchOptions,
		progress: VisionStructuredProgress
	) => void;
}

export async function applyStructuredVisionToMessageBatch(
	input: ApplyStructuredVisionMessageBatchInput
): Promise<StructuredVisionBatchResult> {
	const imageOccurrences = enumerateVisionImageOccurrences(input.hydratedMessages);
	const out: vscode.LanguageModelChatRequestMessage[] = [];
	let cacheHitCount = 0;
	let cacheMissCount = 0;

	for (let messageIndex = 0; messageIndex < input.hydratedMessages.length; messageIndex += 1) {
		const message = input.hydratedMessages[messageIndex]!;
		const partitioned = partitionRequestMessageImageParts(message);
		const imageParts = partitioned.imageParts as vscode.LanguageModelDataPart[];
		const otherParts = partitioned.otherParts as vscode.LanguageModelInputPart[];
		if (imageParts.length === 0) {
			out.push(message);
			continue;
		}

		try {
			const finalPrompt = input.buildFinalPrompt();
			const userTurnText = collectUserTurnTextFromParts(otherParts);
			const handoffIntent = resolveEffectiveVisionHandoffIntentForTurn(userTurnText, finalPrompt, {
				isRestorePipelineSuspended: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED
			});
			const cacheKey = input.buildVisionCacheKey(imageParts, finalPrompt, input.buildCacheKeyModelId());
			let description = input.getDescriptionFromCache(cacheKey);
			let executionSummary: ProxyExecutionSummary | undefined;
			const reused = Boolean(description);
			const occurrence = imageOccurrences.find((item) => item.messageIndex === messageIndex);
			const sourceKind = occurrence?.sourceKind ?? resolveVisionSourceKind(message.role, occurrence?.toolName);
			const toolName = occurrence?.toolName ?? (typeof message.name === "string" ? message.name : undefined);
			logVisionInputBindings(input, imageParts, {
				sourceKind,
				toolName,
				reused,
				occurrence
			});

			if (description) {
				cacheHitCount += 1;
				input.logger.info(input.log.cacheHit, {
					model: input.model.id,
					[input.log.inputBoundModelField]: input.visionModelId,
					imageCount: imageParts.length,
					sourceKind,
					toolName
				});
				input.onCacheHit?.({ handoffIntent, reused, proxyModelId: input.visionModelId });
				emitCachedStructuredProgress(input, description, { sourceKind, toolName });
			} else {
				cacheMissCount += 1;
				input.logger.info(input.log.cacheMiss, {
					model: input.model.id,
					[input.log.inputBoundModelField]: input.visionModelId,
					imageCount: imageParts.length
				});
				input.onCacheMiss?.({ handoffIntent, proxyModelId: input.visionModelId });
				const resolved = await input.resolveDescription(imageParts, finalPrompt, handoffIntent);
				description = resolved.description;
				executionSummary = resolved.execution;
				if (resolved.structured) {
					logStructuredSnapshot(input, resolved.structured, { sourceKind, toolName });
					emitExecutedStructuredProgress(input, resolved.structured, { sourceKind, toolName });
				}
				if (description.trim() && !resolved.formatFallbackUsed && !resolved.textEvidenceUsed) {
					input.setDescriptionInCache(cacheKey, description);
				}
			}

			const persisted = await input.persistEvidence(imageParts, description, executionSummary, handoffIntent);
			if (persisted.evidenceIds.length > 0) {
				const handoffLabel = handoffIntent === "restore-artifact" ? "restoration" : "description";
				input.logger.info("vision.evidence.persisted", {
					model: input.model.id,
					[input.log.inputBoundModelField]: input.visionModelId,
					evidenceIds: persisted.evidenceIds,
					taskStackIds: persisted.taskStackIds,
					artifactIds: persisted.artifactIds,
					handoff: handoffLabel,
					taskStatus: "completed",
					route: input.route
				});
				input.onEvidencePersisted?.({
					evidenceIds: persisted.evidenceIds,
					taskStackIds: persisted.taskStackIds,
					artifactIds: persisted.artifactIds,
					handoffIntent
				});
			}
			input.appendDescription(otherParts, description);
		} catch (error) {
			input.logger.warn(input.log.failed, {
				model: input.model.id,
				error: error instanceof Error ? error.message : String(error)
			});
			if (input.options.reportFailure) {
				return {
					messages: input.fallbackMessages,
					status: "failed",
					error: errorMessages.visionProxyFailed,
					cacheHitCount,
					cacheMissCount
				};
			}
			otherParts.push(new vscode.LanguageModelTextPart(errorMessages.visionProxyFailed));
		}

		out.push({
			role: message.role,
			content: otherParts
		} as unknown as vscode.LanguageModelChatRequestMessage);
	}

	return {
		messages: out,
		status: "applied",
		cacheHitCount,
		cacheMissCount
	};
}

function logVisionInputBindings(
	input: ApplyStructuredVisionMessageBatchInput,
	imageParts: readonly vscode.LanguageModelDataPart[],
	meta: {
		sourceKind: ReturnType<typeof resolveVisionSourceKind>;
		toolName: string | undefined;
		reused: boolean;
		occurrence: VisionImageOccurrence | undefined;
	}
): void {
	for (const imagePart of imageParts) {
		const imageHash = getImagePartHash(imagePart);
		const bindingSummary = createVisionInputBindingSummary({
			sourceKind: meta.sourceKind,
			toolName: meta.toolName,
			imageHash,
			evidenceId: imageHash ? `vision:${imageHash}` : undefined,
			route: input.route,
			proxyModelId: input.visionModelId,
			reused: meta.reused,
			rawImageForwarded: false
		});
		input.logger.info(VisionLogEvent.inputBound, {
			model: input.model.id,
			[input.log.inputBoundModelField]: input.visionModelId,
			imageHash,
			evidenceId: imageHash ? `vision:${imageHash}` : undefined,
			reused: meta.reused,
			rawImageForwarded: false,
			sourceKind: meta.sourceKind,
			toolName: meta.toolName,
			summary: bindingSummary
		});
		input.options.onVisionUiProgress?.(bindingSummary);
	}
}

function emitCachedStructuredProgress(
	input: ApplyStructuredVisionMessageBatchInput,
	description: string,
	meta: { sourceKind?: string; toolName?: string }
): void {
	const cachedProgress = buildStructuredProxyProgressFromDescription(description, { stage: "cache-hit" });
	input.emitStructuredProgress(input.logger, input.options, {
		stage: "cache-hit",
		contract: cachedProgress?.contract ?? STRUCTURED_PROXY_CONTRACT_VERSION,
		elementCount: cachedProgress?.elementCount ?? 0,
		snapshotJson: cachedProgress?.snapshotJson ?? extractNormalizedProxySnapshotJson(description),
		sourceKind: meta.sourceKind,
		toolName: meta.toolName,
		reused: true
	});
}

function logStructuredSnapshot(
	input: ApplyStructuredVisionMessageBatchInput,
	structured: ProxyStructuredOutput,
	meta: { sourceKind?: string; toolName?: string }
): void {
	const snapshot = buildCompactStructuredSnapshot(structured);
	input.logger.info(input.log.structured, {
		model: input.model.id,
		[input.log.inputBoundModelField]: input.visionModelId,
		sourceKind: meta.sourceKind,
		toolName: meta.toolName,
		contract: structured.contract,
		elementCount: structured.elements.length,
		snapshot
	});
}

function emitExecutedStructuredProgress(
	input: ApplyStructuredVisionMessageBatchInput,
	structured: ProxyStructuredOutput,
	meta: { sourceKind?: string; toolName?: string }
): void {
	const snapshotJson = JSON.stringify(buildCompactStructuredSnapshot(structured), null, 2);
	input.emitStructuredProgress(input.logger, input.options, {
		stage: "executed",
		contract: structured.contract,
		elementCount: structured.elements.length,
		snapshotJson,
		sourceKind: meta.sourceKind,
		toolName: meta.toolName,
		reused: false
	});
}

function collectUserTurnTextFromParts(parts: readonly vscode.LanguageModelInputPart[]): string {
	const chunks: string[] = [];
	for (const part of parts) {
		if (part instanceof vscode.LanguageModelTextPart) {
			const value = part.value.trim();
			if (value) {
				chunks.push(value);
			}
		}
	}
	return chunks.join("\n");
}

function toUint8Array(value: unknown): Uint8Array | undefined {
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

function getImagePartHash(part: vscode.LanguageModelDataPart): string | undefined {
	const bytes = toUint8Array(part.data);
	if (!bytes) {
		return undefined;
	}
	return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
