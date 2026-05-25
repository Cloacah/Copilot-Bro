import type { ROIRecord } from "./types";

export interface ImageBounds {
	width: number;
	height: number;
}

export function normalizeRoiRecordsToImageBounds(
	records: readonly ROIRecord[],
	bounds?: ImageBounds
): ROIRecord[] {
	return records.map((record) => normalizeRoiRecordToImageBounds(record, bounds));
}

export function normalizeRoiRecordToImageBounds(
	record: ROIRecord,
	bounds?: ImageBounds
): ROIRecord {
	const normalizedRotation = normalizeRotationDegrees(record.rotationDeg);
	if (!bounds || !isValidBounds(bounds)) {
		return {
			...record,
			bbox: {
				x: Math.max(0, record.bbox.x),
				y: Math.max(0, record.bbox.y),
				w: Math.max(0, record.bbox.w),
				h: Math.max(0, record.bbox.h)
			},
			rotationDeg: normalizedRotation
		};
	}

	const left = clamp(record.bbox.x, 0, bounds.width);
	const top = clamp(record.bbox.y, 0, bounds.height);
	const right = clamp(record.bbox.x + Math.max(0, record.bbox.w), 0, bounds.width);
	const bottom = clamp(record.bbox.y + Math.max(0, record.bbox.h), 0, bounds.height);

	return {
		...record,
		bbox: {
			x: left,
			y: top,
			w: Math.max(0, right - left),
			h: Math.max(0, bottom - top)
		},
		rotationDeg: normalizedRotation
	};
}

export function normalizeRotationDegrees(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) {
		return undefined;
	}
	let normalized = value % 360;
	if (normalized >= 180) {
		normalized -= 360;
	}
	if (normalized < -180) {
		normalized += 360;
	}
	return normalized;
}

function isValidBounds(bounds: ImageBounds): boolean {
	return Number.isFinite(bounds.width)
		&& Number.isFinite(bounds.height)
		&& bounds.width > 0
		&& bounds.height > 0;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
