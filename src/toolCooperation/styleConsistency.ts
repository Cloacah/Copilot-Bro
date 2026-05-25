import type { MlSegmentResult } from "./adapters/types";

export interface StyleConsistencyOptions {
	textureConsistency: number;
	edgeConsistency: number;
	toneConsistency: number;
	warningThreshold: number;
}

export interface StyleConsistencyMetric {
	index: number;
	textureDelta: number;
	edgeDelta: number;
	toneDelta: number;
	consistencyScore: number;
}

export interface StyleConsistencySummary {
	perSegment: StyleConsistencyMetric[];
	aggregateScore: number;
	threshold: number;
	belowThreshold: boolean;
	warnings: string[];
}

const DEFAULT_STYLE_OPTIONS: StyleConsistencyOptions = {
	textureConsistency: 0.6,
	edgeConsistency: 0.7,
	toneConsistency: 0.6,
	warningThreshold: 0.55
};

export function applyStyleConstraintsToSegments(
	referenceSegments: readonly MlSegmentResult[],
	currentSegments: readonly MlSegmentResult[],
	options?: Partial<StyleConsistencyOptions>
): { segments: MlSegmentResult[]; styleConsistency: StyleConsistencySummary; warnings: string[] } {
	const normalized = normalizeStyleOptions(options);
	const warnings: string[] = [];
	const constrainedSegments: MlSegmentResult[] = [];

	const segmentCount = Math.min(referenceSegments.length, currentSegments.length);
	for (let i = 0; i < segmentCount; i += 1) {
		const reference = referenceSegments[i];
		const current = currentSegments[i];
		const referenceGeometry = resolveMaskGeometry(reference.mask, reference.width, reference.height);
		const currentGeometry = resolveMaskGeometry(current.mask, current.width, current.height);
		if (!referenceGeometry || !currentGeometry) {
			warnings.push(`style:segment_${i}_invalid_mask_geometry`);
			constrainedSegments.push(current);
			continue;
		}
		if (referenceGeometry.width !== currentGeometry.width || referenceGeometry.height !== currentGeometry.height) {
			warnings.push(`style:segment_${i}_geometry_mismatch`);
			constrainedSegments.push(current);
			continue;
		}

		const constrainedMask = applyStyleConstraintToMask(
			reference.mask,
			current.mask,
			referenceGeometry.width,
			referenceGeometry.height,
			normalized
		);
		constrainedSegments.push({
			...current,
			mask: constrainedMask,
			width: referenceGeometry.width,
			height: referenceGeometry.height
		});
	}

	for (let i = segmentCount; i < currentSegments.length; i += 1) {
		warnings.push(`style:segment_${i}_missing_reference`);
		constrainedSegments.push(currentSegments[i]);
	}

	const styleConsistency = evaluateStyleConsistency(referenceSegments, constrainedSegments, normalized.warningThreshold);
	warnings.push(...styleConsistency.warnings);
	if (styleConsistency.belowThreshold) {
		warnings.push(`style:consistency_below_threshold:${styleConsistency.aggregateScore.toFixed(4)}`);
	}

	return {
		segments: constrainedSegments,
		styleConsistency,
		warnings
	};
}

export function evaluateStyleConsistency(
	referenceSegments: readonly MlSegmentResult[],
	candidateSegments: readonly MlSegmentResult[],
	threshold = DEFAULT_STYLE_OPTIONS.warningThreshold
): StyleConsistencySummary {
	const normalizedThreshold = clamp01(threshold);
	const perSegment: StyleConsistencyMetric[] = [];
	const warnings: string[] = [];
	const segmentCount = Math.min(referenceSegments.length, candidateSegments.length);

	for (let i = 0; i < segmentCount; i += 1) {
		const reference = referenceSegments[i];
		const candidate = candidateSegments[i];
		const referenceGeometry = resolveMaskGeometry(reference.mask, reference.width, reference.height);
		const candidateGeometry = resolveMaskGeometry(candidate.mask, candidate.width, candidate.height);
		if (!referenceGeometry || !candidateGeometry) {
			warnings.push(`style:segment_${i}_invalid_mask_geometry`);
			continue;
		}
		if (referenceGeometry.width !== candidateGeometry.width || referenceGeometry.height !== candidateGeometry.height) {
			warnings.push(`style:segment_${i}_geometry_mismatch`);
			continue;
		}

		const referenceStats = computeMaskStats(reference.mask, referenceGeometry.width, referenceGeometry.height);
		const candidateStats = computeMaskStats(candidate.mask, candidateGeometry.width, candidateGeometry.height);

		const textureDelta = clamp01(Math.abs(candidateStats.transitionRatio - referenceStats.transitionRatio));
		const edgeDelta = clamp01(Math.abs(candidateStats.boundaryRatio - referenceStats.boundaryRatio));
		const toneDelta = clamp01(Math.abs(candidateStats.meanAlpha - referenceStats.meanAlpha) / 255);
		const consistencyScore = clamp01(1 - (textureDelta * 0.35 + edgeDelta * 0.4 + toneDelta * 0.25));
		perSegment.push({
			index: i,
			textureDelta,
			edgeDelta,
			toneDelta,
			consistencyScore
		});
	}

	const aggregateScore = average(perSegment.map((metric) => metric.consistencyScore));
	return {
		perSegment,
		aggregateScore,
		threshold: normalizedThreshold,
		belowThreshold: aggregateScore < normalizedThreshold,
		warnings
	};
}

function applyStyleConstraintToMask(
	referenceMask: Buffer,
	currentMask: Buffer,
	width: number,
	height: number,
	options: StyleConsistencyOptions
): Buffer {
	const out = Buffer.alloc(currentMask.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;
			const referenceAlpha = referenceMask[index];
			const currentAlpha = currentMask[index];
			let alpha = mix(currentAlpha, referenceAlpha, options.toneConsistency);
			if (isBoundaryPixel(referenceMask, width, height, x, y, 127)) {
				alpha = mix(alpha, referenceAlpha, options.edgeConsistency);
			}
			if (referenceAlpha > 0 && referenceAlpha < 255) {
				alpha = mix(alpha, referenceAlpha, options.textureConsistency);
			}
			out[index] = clampByte(alpha);
		}
	}
	return out;
}

function computeMaskStats(mask: Buffer, width: number, height: number): { meanAlpha: number; boundaryRatio: number; transitionRatio: number } {
	let alphaSum = 0;
	let area = 0;
	let boundary = 0;
	let transition = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;
			const alpha = mask[index];
			alphaSum += alpha;
			if (alpha > 0) {
				area += 1;
			}
			if (alpha > 0 && alpha < 255) {
				transition += 1;
			}
			if (alpha > 127 && isBoundaryPixel(mask, width, height, x, y, 127)) {
				boundary += 1;
			}
		}
	}

	if (area <= 0) {
		return {
			meanAlpha: 0,
			boundaryRatio: 0,
			transitionRatio: 0
		};
	}

	return {
		meanAlpha: alphaSum / (width * height),
		boundaryRatio: clamp01(boundary / area),
		transitionRatio: clamp01(transition / area)
	};
}

function normalizeStyleOptions(input?: Partial<StyleConsistencyOptions>): StyleConsistencyOptions {
	return {
		textureConsistency: Number.isFinite(input?.textureConsistency) ? clamp01(Number(input?.textureConsistency)) : DEFAULT_STYLE_OPTIONS.textureConsistency,
		edgeConsistency: Number.isFinite(input?.edgeConsistency) ? clamp01(Number(input?.edgeConsistency)) : DEFAULT_STYLE_OPTIONS.edgeConsistency,
		toneConsistency: Number.isFinite(input?.toneConsistency) ? clamp01(Number(input?.toneConsistency)) : DEFAULT_STYLE_OPTIONS.toneConsistency,
		warningThreshold: Number.isFinite(input?.warningThreshold) ? clamp01(Number(input?.warningThreshold)) : DEFAULT_STYLE_OPTIONS.warningThreshold
	};
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

function mix(currentValue: number, referenceValue: number, weight: number): number {
	return currentValue * (1 - weight) + referenceValue * weight;
}

function average(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const sum = values.reduce((acc, value) => acc + value, 0);
	return clamp01(sum / values.length);
}

function clampByte(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(255, Math.max(0, Math.round(value)));
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}
