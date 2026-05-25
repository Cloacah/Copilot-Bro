import type { MlSegmentResult } from "./adapters/types";

export type BlendMode = "poisson-like" | "multi-band";

export interface BlendOptions {
	mode: BlendMode;
	strength: number;
	iterations?: number;
	fallbackMode?: BlendMode;
}

const DEFAULT_BLEND_OPTIONS: BlendOptions = {
	mode: "poisson-like",
	strength: 0.5,
	iterations: 2,
	fallbackMode: "multi-band"
};

export function blendMlSegmentMasks(
	segments: readonly MlSegmentResult[],
	options?: Partial<BlendOptions>
): { segments: MlSegmentResult[]; warnings: string[] } {
	const normalized = normalizeBlendOptions(options);
	const warnings: string[] = [];
	const next = segments.map((segment, index) => {
		const geometry = resolveMaskGeometry(segment.mask, segment.width, segment.height);
		if (!geometry) {
			warnings.push(`blend:segment_${index}_invalid_mask_geometry`);
			return segment;
		}
		try {
			const blended = applyBlendToMask(segment.mask, geometry.width, geometry.height, normalized);
			return {
				...segment,
				mask: blended,
				width: geometry.width,
				height: geometry.height
			};
		} catch (error) {
			warnings.push(`blend:segment_${index}_${toWarningMessage(error)}`);
			return segment;
		}
	});
	return {
		segments: next,
		warnings
	};
}

export function applyBlendToMask(
	mask: Buffer,
	width: number,
	height: number,
	options?: Partial<BlendOptions>
): Buffer {
	const normalized = normalizeBlendOptions(options);
	if (width <= 0 || height <= 0 || mask.length !== width * height || normalized.strength <= 0) {
		return Buffer.from(mask);
	}
	if (normalized.mode === "multi-band") {
		return applyMultibandBlend(mask, width, height, normalized.strength);
	}

	try {
		return applyPoissonLikeBlend(mask, width, height, normalized.strength, normalized.iterations);
	} catch {
		if (normalized.fallbackMode === "multi-band") {
			return applyMultibandBlend(mask, width, height, normalized.strength);
		}
		throw new Error("blend_failed_without_fallback");
	}
}

function applyPoissonLikeBlend(mask: Buffer, width: number, height: number, strength: number, iterations: number): Buffer {
	if (iterations <= 0) {
		throw new Error("invalid_poisson_iterations");
	}
	let working = Buffer.from(mask);
	for (let pass = 0; pass < iterations; pass += 1) {
		const next = Buffer.from(working);
		for (let y = 1; y < height - 1; y += 1) {
			for (let x = 1; x < width - 1; x += 1) {
				const idx = y * width + x;
				const alpha = working[idx];
				if (alpha <= 0 || alpha >= 255) {
					continue;
				}
				const laplacianMean = (
					working[idx - 1] +
					working[idx + 1] +
					working[idx - width] +
					working[idx + width]
				) / 4;
				next[idx] = clamp(Math.round(alpha * (1 - strength) + laplacianMean * strength), 0, 255);
			}
		}
		working = next;
	}
	return working;
}

function applyMultibandBlend(mask: Buffer, width: number, height: number, strength: number): Buffer {
	const low = boxBlur(mask, width, height, 2);
	const high = boxBlur(mask, width, height, 1);
	const out = Buffer.alloc(mask.length);
	for (let i = 0; i < mask.length; i += 1) {
		const mixed = high[i] * 0.6 + low[i] * 0.4;
		out[i] = clamp(Math.round(mask[i] * (1 - strength) + mixed * strength), 0, 255);
	}
	return out;
}

function boxBlur(mask: Buffer, width: number, height: number, radius: number): Buffer {
	const out = Buffer.alloc(mask.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let sum = 0;
			let count = 0;
			for (let ny = y - radius; ny <= y + radius; ny += 1) {
				for (let nx = x - radius; nx <= x + radius; nx += 1) {
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
						continue;
					}
					sum += mask[ny * width + nx];
					count += 1;
				}
			}
			out[y * width + x] = count > 0 ? Math.round(sum / count) : mask[y * width + x];
		}
	}
	return out;
}

function normalizeBlendOptions(input?: Partial<BlendOptions>): Required<BlendOptions> {
	const mode = input?.mode ?? DEFAULT_BLEND_OPTIONS.mode;
	const strength = Number.isFinite(input?.strength)
		? clamp(Number(input?.strength), 0, 1)
		: DEFAULT_BLEND_OPTIONS.strength;
	const iterations = Number.isFinite(input?.iterations)
		? Math.max(0, Math.floor(Number(input?.iterations)))
		: (DEFAULT_BLEND_OPTIONS.iterations ?? 2);
	const fallbackMode = input?.fallbackMode ?? DEFAULT_BLEND_OPTIONS.fallbackMode ?? "multi-band";
	return {
		mode,
		strength,
		iterations,
		fallbackMode
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function toWarningMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
