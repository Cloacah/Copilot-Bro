import type { ImageAnalyzeAdapter } from "../toolCooperation/adapters/types";
import { Logger } from "../logger";
import { evaluateRoiConfidenceGate, type RoiConfidenceGateResult, extractRoiRecordsFromMessages } from "./roiGate";
import { VisionLogEvent } from "./visionLogEvents";
import { normalizeRoiRecordsToImageBounds, type ImageBounds } from "./roiNormalizer";
import type { ROIRecord } from "./types";

interface BinaryImagePart {
	mimeType: string;
	data: Uint8Array | ArrayLike<number>;
}

export interface EvaluateRoiGateForMessagesInput {
	messages: readonly unknown[];
	certaintyThreshold: number;
	analyzer: Pick<ImageAnalyzeAdapter, "getMetadata">;
}

export interface RoiRuntimeGuardResult extends RoiConfidenceGateResult {
	imageBounds?: ImageBounds;
	normalizedRoiRecords: ROIRecord[];
}

export const ROI_GATE_TIMEOUT_MS = 5000;

export async function evaluateRoiGateWithTimeout(
	logger: Logger,
	gateInput: EvaluateRoiGateForMessagesInput,
	stage: "pre-route" | "proxy-route",
	modelId: string
): Promise<RoiRuntimeGuardResult> {
	try {
		return await Promise.race([
			evaluateRoiGateForMessages(gateInput),
			new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error(`roi gate timeout (${ROI_GATE_TIMEOUT_MS}ms)`)), ROI_GATE_TIMEOUT_MS);
			})
		]);
	} catch (error) {
		logger.warn(VisionLogEvent.roiTimeout, {
			model: modelId,
			stage,
			timeoutMs: ROI_GATE_TIMEOUT_MS,
			error: error instanceof Error ? error.message : String(error)
		});
		return {
			blocked: false,
			reason: `ROI gate timed out after ${ROI_GATE_TIMEOUT_MS}ms; continue with guarded flow.`,
			threshold: gateInput.certaintyThreshold,
			maxConfidence: 0,
			destructiveIntent: false,
			roiCount: 0,
			confidenceCount: 0,
			normalizedRoiRecords: []
		};
	}
}

export async function evaluateRoiGateForMessages(
	input: EvaluateRoiGateForMessagesInput
): Promise<RoiRuntimeGuardResult> {
	const roiRecords = extractRoiRecordsFromMessages(input.messages);
	const imageBounds = await resolveImageBoundsFromMessages(input.messages, input.analyzer);
	const normalizedRoiRecords = normalizeRoiRecordsToImageBounds(roiRecords, imageBounds);
	const gate = evaluateRoiConfidenceGate({
		messages: input.messages,
		roiRecords: normalizedRoiRecords,
		certaintyThreshold: input.certaintyThreshold
	});
	return {
		...gate,
		imageBounds,
		normalizedRoiRecords
	};
}

async function resolveImageBoundsFromMessages(
	messages: readonly unknown[],
	analyzer: Pick<ImageAnalyzeAdapter, "getMetadata">
): Promise<ImageBounds | undefined> {
	for (const message of messages) {
		const imageBuffers = extractImageBuffersFromMessage(message);
		for (const buffer of imageBuffers) {
			const metadata = await safeReadMetadata(analyzer, buffer);
			if (metadata && metadata.width > 0 && metadata.height > 0) {
				return metadata;
			}
		}
	}
	return undefined;
}

async function safeReadMetadata(
	analyzer: Pick<ImageAnalyzeAdapter, "getMetadata">,
	input: Buffer
): Promise<ImageBounds | undefined> {
	try {
		const metadata = await analyzer.getMetadata(input);
		return {
			width: metadata.width,
			height: metadata.height
		};
	} catch {
		return undefined;
	}
}

function extractImageBuffersFromMessage(message: unknown): Buffer[] {
	if (!message || typeof message !== "object") {
		return [];
	}
	const record = message as { content?: unknown };
	if (!Array.isArray(record.content)) {
		return [];
	}
	const buffers: Buffer[] = [];
	for (const part of record.content) {
		if (!isBinaryImagePart(part)) {
			continue;
		}
		const buffer = toBuffer(part.data);
		if (buffer) {
			buffers.push(buffer);
		}
	}
	return buffers;
}

function isBinaryImagePart(value: unknown): value is BinaryImagePart {
	if (!value || typeof value !== "object") {
		return false;
	}
	const part = value as { mimeType?: unknown; data?: unknown };
	return typeof part.mimeType === "string"
		&& part.mimeType.startsWith("image/")
		&& isBinaryArrayLike(part.data);
}

function isBinaryArrayLike(value: unknown): value is Uint8Array | ArrayLike<number> {
	if (!value) {
		return false;
	}
	if (value instanceof Uint8Array) {
		return true;
	}
	if (typeof value !== "object") {
		return false;
	}
	const candidate = value as { length?: unknown };
	return typeof candidate.length === "number";
}

function toBuffer(value: Uint8Array | ArrayLike<number>): Buffer | undefined {
	try {
		return Buffer.from(value as ArrayLike<number>);
	} catch {
		return undefined;
	}
}
