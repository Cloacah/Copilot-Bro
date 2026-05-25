import type { MlSegmentResult } from "./adapters/types";

export interface MaskQualityMetric {
	index: number;
	iouSurrogate: number;
	boundaryFSurrogate: number;
}

export interface MaskQualitySummary {
	perSegment: MaskQualityMetric[];
	aggregate: {
		iouSurrogate: number;
		boundaryFSurrogate: number;
	};
	warnings: string[];
}

export function evaluateMaskQuality(
	segments: readonly MlSegmentResult[],
	threshold = 127
): MaskQualitySummary {
	const perSegment: MaskQualityMetric[] = [];
	const warnings: string[] = [];

	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i];
		const geometry = resolveMaskGeometry(segment.mask, segment.width, segment.height);
		if (!geometry) {
			warnings.push(`quality:segment_${i}_invalid_mask_geometry`);
			continue;
		}
		const metric = computeMetric(segment.mask, geometry.width, geometry.height, threshold);
		perSegment.push({
			index: i,
			iouSurrogate: metric.iouSurrogate,
			boundaryFSurrogate: metric.boundaryFSurrogate
		});
	}

	const aggregate = {
		iouSurrogate: average(perSegment.map((item) => item.iouSurrogate)),
		boundaryFSurrogate: average(perSegment.map((item) => item.boundaryFSurrogate))
	};

	return {
		perSegment,
		aggregate,
		warnings
	};
}

function computeMetric(mask: Buffer, width: number, height: number, threshold: number): { iouSurrogate: number; boundaryFSurrogate: number } {
	let area = 0;
	let boundary = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;
			const isFg = mask[index] > threshold;
			if (!isFg) {
				continue;
			}
			area += 1;
			if (isBoundaryPixel(mask, width, height, x, y, threshold)) {
				boundary += 1;
			}
		}
	}
	if (area <= 0) {
		return {
			iouSurrogate: 0,
			boundaryFSurrogate: 0
		};
	}

	const iouSurrogate = clamp01(area / (area + boundary));
	const boundaryFSurrogate = clamp01((2 * area) / (2 * area + boundary));
	return {
		iouSurrogate,
		boundaryFSurrogate
	};
}

function isBoundaryPixel(mask: Buffer, width: number, height: number, x: number, y: number, threshold: number): boolean {
	const neighbors = [
		[x + 1, y],
		[x - 1, y],
		[x, y + 1],
		[x, y - 1]
	] as const;
	for (const [nx, ny] of neighbors) {
		if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
			return true;
		}
		if (mask[ny * width + nx] <= threshold) {
			return true;
		}
	}
	return false;
}

function resolveMaskGeometry(mask: Buffer, width?: number, height?: number): { width: number; height: number } | undefined {
	const validWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width as number)) : 0;
	const validHeight = Number.isFinite(height) ? Math.max(0, Math.floor(height as number)) : 0;
	if (validWidth > 0 && validHeight > 0 && validWidth * validHeight === mask.length) {
		return { width: validWidth, height: validHeight };
	}
	const side = Math.floor(Math.sqrt(mask.length));
	if (side > 0 && side * side === mask.length) {
		return { width: side, height: side };
	}
	return undefined;
}

function average(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const sum = values.reduce((acc, value) => acc + value, 0);
	return clamp01(sum / values.length);
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}
