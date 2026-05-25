import { parseRoiRecordsFromVisionDescription } from "./roiParser";
import type { ROIRecord } from "./types";

const DESTRUCTIVE_INTENT_PATTERN = /\b(delete|remove|erase|cut\s?out|replace|warp|deform|blend|cleanup|segment|mask|inpaint)\b|删除|擦除|抠图|替换|形变|融合|去污|修复边缘/i;

export interface RoiConfidenceGateInput {
	messages: readonly unknown[];
	roiRecords: readonly ROIRecord[];
	certaintyThreshold: number;
}

export interface RoiConfidenceGateResult {
	blocked: boolean;
	reason?: string;
	maxConfidence?: number;
	threshold: number;
	destructiveIntent: boolean;
	roiCount: number;
	confidenceCount: number;
}

export function extractRoiRecordsFromMessages(messages: readonly unknown[]): ROIRecord[] {
	const records: ROIRecord[] = [];
	for (const message of messages) {
		records.push(...parseRoiRecordsFromVisionDescription(message));
		for (const text of extractTextFragments(message)) {
			records.push(...parseRoiRecordsFromVisionDescription(text));
		}
	}
	const deduped = new Map<string, ROIRecord>();
	for (const record of records) {
		const key = [
			record.bbox.x,
			record.bbox.y,
			record.bbox.w,
			record.bbox.h,
			record.rotationDeg ?? "",
			record.confidence ?? "",
			record.targetLabel ?? "",
			record.rationale
		].join("|");
		deduped.set(key, record);
	}
	return Array.from(deduped.values());
}

export function evaluateRoiConfidenceGate(input: RoiConfidenceGateInput): RoiConfidenceGateResult {
	const threshold = clampThreshold(input.certaintyThreshold);
	const confidenceValues = input.roiRecords
		.map((record) => record.confidence)
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
	const maxConfidence = confidenceValues.length > 0 ? Math.max(...confidenceValues) : undefined;
	const destructiveIntent = hasDestructiveIntent(input.messages);
	const blocked = destructiveIntent
		&& typeof maxConfidence === "number"
		&& maxConfidence < threshold;
	const reason = blocked
		? `ROI confidence gate blocked destructive operations (max_confidence=${maxConfidence.toFixed(3)} < certainty_threshold=${threshold.toFixed(3)}).`
		: undefined;
	return {
		blocked,
		reason,
		maxConfidence,
		threshold,
		destructiveIntent,
		roiCount: input.roiRecords.length,
		confidenceCount: confidenceValues.length
	};
}

function hasDestructiveIntent(messages: readonly unknown[]): boolean {
	const corpus = messages.flatMap((message) => extractTextFragments(message)).join("\n");
	if (!corpus.trim()) {
		return false;
	}
	return DESTRUCTIVE_INTENT_PATTERN.test(corpus);
}

function extractTextFragments(value: unknown): string[] {
	if (!value) {
		return [];
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : [];
	}
	if (Array.isArray(value)) {
		return value.flatMap((item) => extractTextFragments(item));
	}
	if (typeof value !== "object") {
		return [];
	}
	const record = value as Record<string, unknown>;
	const fragments: string[] = [];
	for (const key of ["text", "value", "description", "output", "content", "rationale"]) {
		const candidate = record[key];
		if (typeof candidate === "string") {
			const trimmed = candidate.trim();
			if (trimmed) {
				fragments.push(trimmed);
			}
		}
	}
	if (record.content && Array.isArray(record.content)) {
		fragments.push(...extractTextFragments(record.content));
	}
	return fragments;
}

function clampThreshold(value: number): number {
	if (!Number.isFinite(value)) {
		return 0.7;
	}
	return Math.min(1, Math.max(0, value));
}
