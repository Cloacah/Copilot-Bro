import { normalizeBatchResult } from "./normalizer";
import type { VisionBatchResult } from "./types";
import { validateBatchResult } from "./validator";
import { extractJsonObjectFromVisionText } from "./visionJsonExtract";
import {
	buildProxyStructuredSnapshotJson,
	convertVisionBatchToProxyStructuredOutput
} from "./visionBatchToProxyStructured";
import type { ProxyStructuredOutput } from "../visionProxyStructuredPlan";
import {
	createVisionEvidenceId,
	getVisionEvidenceRecord,
	upsertVisionEvidenceRecord,
	type VisionEvidenceHandoff
} from "./visionEvidenceStore";
import { getVisionTaskStack, updateVisionTaskStatus } from "./visionTaskStack";

export interface NativeVisionFinalizeResult {
	parsed: boolean;
	completedEvidenceIds: string[];
	regionCount: number;
	/** Proxy-contract v3 snapshot (same shape as vision proxy `normalizedProxySnapshot`). */
	structured?: ProxyStructuredOutput;
	structuredSnapshotJson?: string;
}

export interface NativeVisionFinalizeLogger {
	info(event: string, payload?: Record<string, unknown>): void;
}

export function isDescribeOnlyHandoff(handoff: VisionEvidenceHandoff): boolean {
	return handoff === "description";
}

export function extractVisionBatchFromAssistantText(text: string): VisionBatchResult | undefined {
	const extracted = extractJsonObjectFromVisionText(text);
	if (!extracted) {
		return undefined;
	}
	try {
		const parsed = normalizeBatchResult(extracted.value);
		if (validateBatchResult(parsed).length === 0 && parsed.results.length > 0) {
			return parsed;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export function buildEvidenceDescriptionFromVisionBatch(batch: VisionBatchResult): string {
	const summary = batch.results.map((result) => ({
		imageHash: result.imageHash,
		imageRef: result.imageRef,
		objectCount: result.objects.length,
		labels: result.objects.map((object) => object.label)
	}));
	return JSON.stringify({ batchId: batch.batchId, results: summary });
}

export function finalizeNativeVisionStructuredHandoff(options: {
	assistantText: string;
	modelId: string;
	imageHashes: readonly string[];
	pendingHandoff?: VisionEvidenceHandoff;
	logger?: NativeVisionFinalizeLogger;
}): NativeVisionFinalizeResult {
	const batch = extractVisionBatchFromAssistantText(options.assistantText);
	if (!batch) {
		return { parsed: false, completedEvidenceIds: [], regionCount: 0 };
	}
	const handoff = options.pendingHandoff ?? "description";
	const completedEvidenceIds: string[] = [];
	let regionCount = 0;
	const hashSet = new Set(options.imageHashes.map((hash) => hash.trim()).filter(Boolean));
	for (const result of batch.results) {
		if (!hashSet.has(result.imageHash)) {
			continue;
		}
		regionCount += result.objects.length;
		const evidenceId = createVisionEvidenceId(result.imageHash);
		const existing = getVisionEvidenceRecord(evidenceId);
		if (!existing || existing.route !== "native") {
			continue;
		}
		upsertVisionEvidenceRecord({
			id: evidenceId,
			imageHash: result.imageHash,
			route: "native",
			handoff,
			taskStatus: "completed",
			modelId: options.modelId,
			description: buildEvidenceDescriptionFromVisionBatch({
				...batch,
				results: [result]
			})
		});
		completeNativeDescribeTaskStack(evidenceId);
		completedEvidenceIds.push(evidenceId);
	}
	const structured = convertVisionBatchToProxyStructuredOutput(batch);
	const structuredSnapshotJson = buildProxyStructuredSnapshotJson(structured);
	if (completedEvidenceIds.length > 0) {
		options.logger?.info("vision.native.structured.completed", {
			modelId: options.modelId,
			evidenceIds: completedEvidenceIds,
			regionCount,
			handoff,
			batchId: batch.batchId,
			describeOnly: isDescribeOnlyHandoff(handoff),
			contract: structured.contract,
			elementCount: structured.elements.length
		});
		options.logger?.info("vision.native.structured.snapshot", {
			modelId: options.modelId,
			contract: structured.contract,
			elementCount: structured.elements.length,
			route: "native"
		});
	}
	return {
		parsed: true,
		completedEvidenceIds,
		regionCount,
		structured,
		structuredSnapshotJson
	};
}

function completeNativeDescribeTaskStack(evidenceId: string): void {
	const stackId = `${evidenceId.trim()}:stack`;
	const stack = getVisionTaskStack(stackId);
	if (!stack) {
		return;
	}
	for (const task of stack.tasks) {
		if (task.status === "pending" || task.status === "running") {
			updateVisionTaskStatus(stackId, task.id, "completed");
		}
	}
}

/** Host UI / diagnostics: verify proxy and native share evidence field contract. */
export function buildVisionEvidenceContractSnapshot(): {
	sharedLogFields: readonly string[];
	proxyRoute: "proxy";
	nativeRoute: "native";
	handoffs: readonly VisionEvidenceHandoff[];
} {
	return {
		sharedLogFields: ["evidenceId", "imageHash", "route", "handoff", "taskStatus", "regionCount"],
		proxyRoute: "proxy",
		nativeRoute: "native",
		handoffs: ["description", "restoration"]
	};
}
