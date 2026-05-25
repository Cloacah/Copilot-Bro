import type { MlSegmentResult } from "./adapters/types";

export type DeformationMode = "affine" | "perspective" | "grid";

export interface DeformationAnchor {
	x: number;
	y: number;
	dx: number;
	dy: number;
	weight?: number;
}

export interface DeformationConstraints {
	maxDisplacement: number;
	clampToBounds: boolean;
}

export interface DeformationOptions {
	mode: DeformationMode;
	anchors: readonly DeformationAnchor[];
	constraints: Partial<DeformationConstraints>;
}

const DEFAULT_CONSTRAINTS: DeformationConstraints = {
	maxDisplacement: 16,
	clampToBounds: true
};

export function deformMlSegmentMasks(
	segments: readonly MlSegmentResult[],
	options: Partial<DeformationOptions>
): { segments: MlSegmentResult[]; warnings: string[] } {
	const warnings: string[] = [];
	const transformed = segments.map((segment, index) => {
		const geometry = resolveMaskGeometry(segment.mask, segment.width, segment.height);
		if (!geometry) {
			warnings.push(`deform:segment_${index}_invalid_mask_geometry`);
			return segment;
		}
		try {
			const mask = applyAnchorDeformationToMask(segment.mask, geometry.width, geometry.height, options);
			return {
				...segment,
				mask,
				width: geometry.width,
				height: geometry.height
			};
		} catch (error) {
			warnings.push(`deform:segment_${index}_${toWarningSuffix(error)}`);
			return segment;
		}
	});

	return {
		segments: transformed,
		warnings
	};
}

export function applyAnchorDeformationToMask(
	mask: Buffer,
	width: number,
	height: number,
	options: Partial<DeformationOptions>
): Buffer {
	if (width <= 0 || height <= 0 || mask.length !== width * height) {
		return Buffer.from(mask);
	}

	const mode = options.mode ?? "grid";
	const normalizedAnchors = normalizeAnchors(options.anchors ?? [], width, height, options.constraints);
	const requiredAnchors = minimumAnchorCount(mode);
	if (normalizedAnchors.length < requiredAnchors) {
		throw new Error(`insufficient_anchors_for_${mode}`);
	}

	const out = Buffer.alloc(mask.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = estimateOffsetForPixel(x, y, normalizedAnchors);
			const sampleX = Math.round(x - offset.dx);
			const sampleY = Math.round(y - offset.dy);
			const index = y * width + x;
			if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) {
				out[index] = 0;
				continue;
			}
			out[index] = mask[sampleY * width + sampleX];
		}
	}

	return out;
}

function normalizeAnchors(
	anchors: readonly DeformationAnchor[],
	width: number,
	height: number,
	constraints?: Partial<DeformationConstraints>
): DeformationAnchor[] {
	const normalizedConstraints = normalizeConstraints(constraints);
	return anchors
		.filter((anchor) => Number.isFinite(anchor.x) && Number.isFinite(anchor.y) && Number.isFinite(anchor.dx) && Number.isFinite(anchor.dy))
		.map((anchor) => ({
			x: clamp(Math.round(anchor.x), 0, Math.max(0, width - 1)),
			y: clamp(Math.round(anchor.y), 0, Math.max(0, height - 1)),
			dx: clampDisplacement(anchor.dx, normalizedConstraints.maxDisplacement),
			dy: clampDisplacement(anchor.dy, normalizedConstraints.maxDisplacement),
			weight: Number.isFinite(anchor.weight) ? Math.max(0, Number(anchor.weight)) : 1
		}));
}

function normalizeConstraints(input?: Partial<DeformationConstraints>): DeformationConstraints {
	const maxDisplacement = Number.isFinite(input?.maxDisplacement)
		? Math.max(0, Math.floor(Number(input?.maxDisplacement)))
		: DEFAULT_CONSTRAINTS.maxDisplacement;
	return {
		maxDisplacement,
		clampToBounds: input?.clampToBounds ?? DEFAULT_CONSTRAINTS.clampToBounds
	};
}

function minimumAnchorCount(mode: DeformationMode): number {
	switch (mode) {
		case "affine":
			return 3;
		case "perspective":
			return 4;
		case "grid":
		default:
			return 1;
	}
}

function estimateOffsetForPixel(x: number, y: number, anchors: readonly DeformationAnchor[]): { dx: number; dy: number } {
	let weightSum = 0;
	let dxSum = 0;
	let dySum = 0;
	for (const anchor of anchors) {
		const distance = Math.hypot(x - anchor.x, y - anchor.y) + 1;
		const weight = (anchor.weight ?? 1) / distance;
		weightSum += weight;
		dxSum += anchor.dx * weight;
		dySum += anchor.dy * weight;
	}
	if (weightSum <= 0) {
		return { dx: 0, dy: 0 };
	}
	return {
		dx: dxSum / weightSum,
		dy: dySum / weightSum
	};
}

function clampDisplacement(value: number, maxDisplacement: number): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		return 0;
	}
	return Math.min(maxDisplacement, Math.max(-maxDisplacement, numeric));
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function toWarningSuffix(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
