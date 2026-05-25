import type { GeometryProtocol, VisionBatchResult, VisionObject, VisionResult } from "./types";

export function validateGeometry(geometry: GeometryProtocol): boolean {
	if (!geometry.version.trim() || !geometry.rationale.trim()) {
		return false;
	}
	const { bbox } = geometry;
	if (!isNonNegativeNumber(bbox.x) || !isNonNegativeNumber(bbox.y) || !isNonNegativeNumber(bbox.w) || !isNonNegativeNumber(bbox.h)) {
		return false;
	}
	if (geometry.rotationDeg !== undefined && !Number.isFinite(geometry.rotationDeg)) {
		return false;
	}
	if (geometry.zIndex !== undefined && !Number.isFinite(geometry.zIndex)) {
		return false;
	}
	if (geometry.confidence !== undefined && !isNonNegativeNumber(geometry.confidence)) {
		return false;
	}
	if (geometry.occlusion !== undefined && !isNonNegativeNumber(geometry.occlusion)) {
		return false;
	}
	if (geometry.textSpan && (!isNonNegativeNumber(geometry.textSpan.start) || !isNonNegativeNumber(geometry.textSpan.end) || geometry.textSpan.end < geometry.textSpan.start)) {
		return false;
	}
	return true;
}

export function validateVisionResult(result: VisionResult): string[] {
	const errors: string[] = [];
	if (!result.imageRef.trim()) {
		errors.push("imageRef is required");
	}
	if (!result.imageHash.trim()) {
		errors.push("imageHash is required");
	}
	if (!isNonNegativeNumber(result.processingMs)) {
		errors.push("processingMs must be a non-negative number");
	}
	for (const [index, object] of result.objects.entries()) {
		const objectErrors = validateVisionObject(object);
		for (const error of objectErrors) {
			errors.push(`objects[${index}].${error}`);
		}
	}
	if (result.warnings && result.warnings.some((warning) => !warning.trim())) {
		errors.push("warnings must contain only non-empty strings");
	}
	return errors;
}

export function validateBatchResult(batchResult: VisionBatchResult): string[] {
	const errors: string[] = [];
	if (!batchResult.batchId.trim()) {
		errors.push("batchId is required");
	}
	if (!batchResult.sessionId.trim()) {
		errors.push("sessionId is required");
	}
	if (!isNonNegativeNumber(batchResult.totalMs)) {
		errors.push("totalMs must be a non-negative number");
	}
	if (batchResult.failedRefs.some((ref) => !ref.trim())) {
		errors.push("failedRefs must contain only non-empty strings");
	}
	for (const [index, result] of batchResult.results.entries()) {
		for (const error of validateVisionResult(result)) {
			errors.push(`results[${index}].${error}`);
		}
	}
	return errors;
}

function validateVisionObject(object: VisionObject): string[] {
	const errors: string[] = [];
	if (!object.id.trim()) {
		errors.push("id is required");
	}
	if (!object.label.trim()) {
		errors.push("label is required");
	}
	if (!object.rationale?.trim() && !object.geometry.rationale.trim()) {
		errors.push("rationale is required");
	}
	if (!validateGeometry(object.geometry)) {
		errors.push("geometry is invalid");
	}
	return errors;
}

function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}