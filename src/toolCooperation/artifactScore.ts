import type { MlSegmentResult } from "./adapters/types";

export interface ArtifactScoreMetric {
	index: number;
	score: number;
	boundaryRatio: number;
	transitionRatio: number;
}

export interface ArtifactScoreSummary {
	perSegment: ArtifactScoreMetric[];
	aggregateScore: number;
	threshold: number;
	exceeded: boolean;
	warnings: string[];
}

export function evaluateArtifactScore(
	segments: readonly MlSegmentResult[],
	threshold = 0.5,
	alphaThreshold = 127
): ArtifactScoreSummary {
	const normalizedThreshold = clamp01(threshold);
	const perSegment: ArtifactScoreMetric[] = [];
	const warnings: string[] = [];

	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i];
		const geometry = resolveMaskGeometry(segment.mask, segment.width, segment.height);
		if (!geometry) {
			warnings.push(`artifact:segment_${i}_invalid_mask_geometry`);
			continue;
		}
		const metric = computeArtifactMetric(segment.mask, geometry.width, geometry.height, alphaThreshold);
		perSegment.push({
			index: i,
			score: metric.score,
			boundaryRatio: metric.boundaryRatio,
			transitionRatio: metric.transitionRatio
		});
	}

	const aggregateScore = average(perSegment.map((item) => item.score));
	return {
		perSegment,
		aggregateScore,
		threshold: normalizedThreshold,
		exceeded: aggregateScore > normalizedThreshold,
		warnings
	};
}

function computeArtifactMetric(mask: Buffer, width: number, height: number, alphaThreshold: number): { score: number; boundaryRatio: number; transitionRatio: number } {
	let area = 0;
	let boundary = 0;
	let transition = 0;

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;
			const alpha = mask[index];
			if (alpha > 0) {
				area += 1;
			}
			if (alpha > 0 && alpha < 255) {
				transition += 1;
			}
			if (alpha > alphaThreshold && isBoundaryPixel(mask, width, height, x, y, alphaThreshold)) {
				boundary += 1;
			}
		}
	}

	if (area <= 0) {
		return {
			score: 0,
			boundaryRatio: 0,
			transitionRatio: 0
		};
	}

	const boundaryRatio = clamp01(boundary / area);
	const transitionRatio = clamp01(transition / area);
	const score = clamp01(boundaryRatio * 0.65 + transitionRatio * 0.35);
	return {
		score,
		boundaryRatio,
		transitionRatio
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
