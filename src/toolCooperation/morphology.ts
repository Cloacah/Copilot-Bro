import type { MlSegmentResult } from "./adapters/types";

export type MorphologyMode = "open" | "close" | "open-close" | "close-open";

export interface MorphologyOptions {
	mode: MorphologyMode;
	radius: number;
	threshold: number;
}

export interface FeatherOptions {
	radius: number;
}

export interface DecontaminationOptions {
	threshold: number;
	strength: number;
}

export const DEFAULT_MORPHOLOGY_OPTIONS: MorphologyOptions = {
	mode: "open-close",
	radius: 1,
	threshold: 127
};

export const DEFAULT_FEATHER_OPTIONS: FeatherOptions = {
	radius: 1
};

export const DEFAULT_DECONTAMINATION_OPTIONS: DecontaminationOptions = {
	threshold: 127,
	strength: 0.5
};

export function normalizeMorphologyOptions(input?: Partial<MorphologyOptions>): MorphologyOptions {
	const mode = input?.mode ?? DEFAULT_MORPHOLOGY_OPTIONS.mode;
	const radius = Number.isFinite(input?.radius) ? Math.max(0, Math.floor(input?.radius as number)) : DEFAULT_MORPHOLOGY_OPTIONS.radius;
	const threshold = Number.isFinite(input?.threshold)
		? clamp(Math.floor(input?.threshold as number), 0, 255)
		: DEFAULT_MORPHOLOGY_OPTIONS.threshold;
	return {
		mode,
		radius,
		threshold
	};
}

export function refineMlSegmentMasks(
	segments: readonly MlSegmentResult[],
	options?: Partial<MorphologyOptions>
): { segments: MlSegmentResult[]; warnings: string[] } {
	const normalized = normalizeMorphologyOptions(options);
	const warnings: string[] = [];
	const refined = segments.map((segment, index) => {
		const geometry = resolveMaskGeometry(segment.mask, segment.width, segment.height);
		if (!geometry) {
			warnings.push(`morphology:segment_${index}_invalid_mask_geometry`);
			return segment;
		}
		const nextMask = applyMorphologyToBinaryMask(segment.mask, geometry.width, geometry.height, normalized);
		return {
			...segment,
			mask: nextMask,
			width: geometry.width,
			height: geometry.height
		};
	});
	return { segments: refined, warnings };
}

export function featherMlSegmentMasks(
	segments: readonly MlSegmentResult[],
	options?: Partial<FeatherOptions>
): { segments: MlSegmentResult[]; warnings: string[] } {
	const radius = normalizeFeatherRadius(options?.radius);
	const warnings: string[] = [];
	const refined = segments.map((segment, index) => {
		const geometry = resolveMaskGeometry(segment.mask, segment.width, segment.height);
		if (!geometry) {
			warnings.push(`feather:segment_${index}_invalid_mask_geometry`);
			return segment;
		}
		const nextMask = applyFeatherToMask(segment.mask, geometry.width, geometry.height, { radius });
		return {
			...segment,
			mask: nextMask,
			width: geometry.width,
			height: geometry.height
		};
	});
	return { segments: refined, warnings };
}

export function decontaminateMlSegmentMasks(
	segments: readonly MlSegmentResult[],
	options?: Partial<DecontaminationOptions>
): { segments: MlSegmentResult[]; warnings: string[] } {
	const normalized = normalizeDecontaminationOptions(options);
	const warnings: string[] = [];
	const refined = segments.map((segment, index) => {
		const geometry = resolveMaskGeometry(segment.mask, segment.width, segment.height);
		if (!geometry) {
			warnings.push(`decontaminate:segment_${index}_invalid_mask_geometry`);
			return segment;
		}
		const nextMask = applyDecontaminationToMask(segment.mask, geometry.width, geometry.height, normalized);
		return {
			...segment,
			mask: nextMask,
			width: geometry.width,
			height: geometry.height
		};
	});
	return { segments: refined, warnings };
}

export function applyMorphologyToBinaryMask(
	mask: Buffer,
	width: number,
	height: number,
	options?: Partial<MorphologyOptions>
): Buffer {
	const normalized = normalizeMorphologyOptions(options);
	if (normalized.radius <= 0 || width <= 0 || height <= 0 || mask.length !== width * height) {
		return Buffer.from(mask);
	}
	let buffer = toBinary(mask, normalized.threshold);
	switch (normalized.mode) {
		case "open":
			buffer = dilate(erode(buffer, width, height, normalized.radius), width, height, normalized.radius);
			break;
		case "close":
			buffer = erode(dilate(buffer, width, height, normalized.radius), width, height, normalized.radius);
			break;
		case "close-open":
			buffer = dilate(erode(dilate(buffer, width, height, normalized.radius), width, height, normalized.radius), width, height, normalized.radius);
			buffer = erode(buffer, width, height, normalized.radius);
			break;
		case "open-close":
		default:
			buffer = dilate(erode(buffer, width, height, normalized.radius), width, height, normalized.radius);
			buffer = erode(dilate(buffer, width, height, normalized.radius), width, height, normalized.radius);
			break;
	}
	return fromBinary(buffer);
}

export function applyFeatherToMask(
	mask: Buffer,
	width: number,
	height: number,
	options?: Partial<FeatherOptions>
): Buffer {
	const radius = normalizeFeatherRadius(options?.radius);
	if (radius <= 0 || width <= 0 || height <= 0 || mask.length !== width * height) {
		return Buffer.from(mask);
	}
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

export function applyDecontaminationToMask(
	mask: Buffer,
	width: number,
	height: number,
	options?: Partial<DecontaminationOptions>
): Buffer {
	const normalized = normalizeDecontaminationOptions(options);
	if (width <= 0 || height <= 0 || mask.length !== width * height || normalized.strength <= 0) {
		return Buffer.from(mask);
	}
	const binary = toBinary(mask, normalized.threshold);
	const out = Buffer.from(mask);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;
			const alpha = mask[index];
			if (alpha === 0 || alpha === 255) {
				continue;
			}
			let fg = 0;
			let bg = 0;
			for (let ny = y - 1; ny <= y + 1; ny += 1) {
				for (let nx = x - 1; nx <= x + 1; nx += 1) {
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
						continue;
					}
					if (binary[ny * width + nx] === 1) {
						fg += 1;
					} else {
						bg += 1;
					}
				}
			}
			const total = fg + bg;
			if (total <= 0 || fg === bg) {
				continue;
			}
			const imbalance = Math.abs(fg - bg) / total;
			const factor = normalized.strength * imbalance;
			if (bg > fg) {
				out[index] = clamp(Math.round(alpha * (1 - factor)), 0, 255);
			} else {
				out[index] = clamp(Math.round(alpha + (255 - alpha) * factor), 0, 255);
			}
		}
	}
	return out;
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

function normalizeFeatherRadius(value: number | undefined): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_FEATHER_OPTIONS.radius;
	}
	return Math.max(0, Math.floor(value as number));
}

function normalizeDecontaminationOptions(input?: Partial<DecontaminationOptions>): DecontaminationOptions {
	const threshold = Number.isFinite(input?.threshold)
		? clamp(Math.floor(input?.threshold as number), 0, 255)
		: DEFAULT_DECONTAMINATION_OPTIONS.threshold;
	const strength = Number.isFinite(input?.strength)
		? clamp(Number(input?.strength), 0, 1)
		: DEFAULT_DECONTAMINATION_OPTIONS.strength;
	return {
		threshold,
		strength
	};
}

function toBinary(mask: Buffer, threshold: number): Uint8Array {
	const out = new Uint8Array(mask.length);
	for (let i = 0; i < mask.length; i += 1) {
		out[i] = mask[i] > threshold ? 1 : 0;
	}
	return out;
}

function fromBinary(mask: Uint8Array): Buffer {
	const out = Buffer.alloc(mask.length);
	for (let i = 0; i < mask.length; i += 1) {
		out[i] = mask[i] === 1 ? 255 : 0;
	}
	return out;
}

function erode(binary: Uint8Array, width: number, height: number, radius: number): Uint8Array {
	const out = new Uint8Array(binary.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let keep = 1;
			for (let ny = y - radius; ny <= y + radius && keep === 1; ny += 1) {
				for (let nx = x - radius; nx <= x + radius; nx += 1) {
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
						keep = 0;
						break;
					}
					if (binary[ny * width + nx] === 0) {
						keep = 0;
						break;
					}
				}
			}
			out[y * width + x] = keep;
		}
	}
	return out;
}

function dilate(binary: Uint8Array, width: number, height: number, radius: number): Uint8Array {
	const out = new Uint8Array(binary.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let mark = 0;
			for (let ny = y - radius; ny <= y + radius && mark === 0; ny += 1) {
				for (let nx = x - radius; nx <= x + radius; nx += 1) {
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
						continue;
					}
					if (binary[ny * width + nx] === 1) {
						mark = 1;
						break;
					}
				}
			}
			out[y * width + x] = mark;
		}
	}
	return out;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
