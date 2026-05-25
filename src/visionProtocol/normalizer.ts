import type {
	BoundingBoxProtocol,
	GeometryProtocol,
	TextSpanProtocol,
	VisionBatchResult,
	VisionObject,
	VisionResult
} from "./types";

export function normalizeGeometry(value: unknown): GeometryProtocol {
	const record = asRecord(value);
	const bboxRecord = asRecord(record.bbox);
	const bbox = normalizeBoundingBox({
		x: bboxRecord.x ?? record.x,
		y: bboxRecord.y ?? record.y,
		w: bboxRecord.w ?? record.w,
		h: bboxRecord.h ?? record.h
	});
	const textSpan = normalizeTextSpan(record.textSpan);
	return {
		version: asString(record.version) || "v1",
		bbox,
		rotationDeg: asOptionalNumber(record.rotationDeg),
		zIndex: asOptionalNumber(record.zIndex),
		confidence: asOptionalNonNegativeNumber(record.confidence),
		occlusion: asOptionalNonNegativeNumber(record.occlusion),
		textSpan,
		rationale: asString(record.rationale) || "auto"
	};
}

export function normalizeBatchResult(raw: unknown): VisionBatchResult {
	const record = asRecord(raw);
	const results = Array.isArray(record.results) ? record.results.map(normalizeVisionResult) : [];
	return {
		batchId: asString(record.batchId),
		sessionId: asString(record.sessionId),
		results,
		totalMs: asNonNegativeNumber(record.totalMs),
		failedRefs: normalizeStringArray(record.failedRefs)
	};
}

function normalizeVisionResult(value: unknown): VisionResult {
	const record = asRecord(value);
	const objects = Array.isArray(record.objects) ? record.objects.map(normalizeVisionObject) : [];
	const warnings = normalizeStringArray(record.warnings);
	return {
		imageRef: asString(record.imageRef),
		imageHash: asString(record.imageHash),
		objects,
		processingMs: asNonNegativeNumber(record.processingMs),
		warnings: warnings.length > 0 ? warnings : undefined
	};
}

function normalizeVisionObject(value: unknown): VisionObject {
	const record = asRecord(value);
	const geometry = normalizeGeometry(record.geometry ?? record);
	return {
		id: asString(record.id),
		label: asString(record.label),
		geometry,
		rationale: asString(record.rationale) || geometry.rationale,
		attributes: normalizeAttributes(record.attributes)
	};
}

function normalizeBoundingBox(value: unknown): BoundingBoxProtocol {
	const record = asRecord(value);
	return {
		x: asNonNegativeNumber(record.x),
		y: asNonNegativeNumber(record.y),
		w: asNonNegativeNumber(record.w),
		h: asNonNegativeNumber(record.h)
	};
}

function normalizeTextSpan(value: unknown): TextSpanProtocol | undefined {
	const record = asRecord(value);
	const start = asNonNegativeNumber(record.start);
	const end = asNonNegativeNumber(record.end);
	if (end < start) {
		return undefined;
	}
	if (!record.start && !record.end && start === 0 && end === 0) {
		return undefined;
	}
	return {
		start,
		end
	};
}

function normalizeAttributes(value: unknown): Record<string, unknown> | undefined {
	const record = asRecord(value);
	return Object.keys(record).length > 0 ? record : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asOptionalNonNegativeNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asNonNegativeNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}