import type { ExtensionSettings } from "./types";

export type ImageMetadata = { width: number; height: number } | undefined;

export function validateImageIntegrity(
	settings: Pick<ExtensionSettings, "visionIntegrity">,
	original: Buffer,
	candidate: Buffer,
	originalDigest: string,
	candidateDigest: string,
	originalMeta: ImageMetadata,
	candidateMeta: ImageMetadata
): string[] {
	if (!settings.visionIntegrity.enabled) {
		return [];
	}
	const warnings: string[] = [];
	if (settings.visionIntegrity.checkCount && candidate.length === 0) {
		warnings.push("integrity:empty_image");
	}
	if (settings.visionIntegrity.checkDigest && candidate.length > 0 && !candidateDigest) {
		warnings.push("integrity:empty_image");
	}
	if (settings.visionIntegrity.checkDimensions) {
		if (!candidateMeta || candidateMeta.width <= 0 || candidateMeta.height <= 0) {
			warnings.push("integrity:invalid_dimensions");
		}
		if (originalMeta && candidateMeta && (candidateMeta.width > originalMeta.width * 4 || candidateMeta.height > originalMeta.height * 4)) {
			warnings.push("integrity:abnormal_dimension_growth");
		}
	}
	if (settings.visionIntegrity.trackByteSummary && original.length > 0 && candidate.length > original.length * 8) {
		warnings.push("integrity:abnormal_byte_growth");
	}
	if (settings.visionIntegrity.trackResize && originalDigest === candidateDigest && original.length !== candidate.length) {
		warnings.push("integrity:resize_metadata_drift");
	}
	return warnings;
}

export function isImageInputPart(value: unknown): value is { mimeType: string; data: Uint8Array } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.mimeType === "string"
		&& record.mimeType.startsWith("image/")
		&& record.data instanceof Uint8Array;
}

export function replaceImageInputPartData<T extends { mimeType: string; data: Uint8Array } & Record<string, unknown>>(
	part: T,
	image: Buffer
): T {
	return {
		...part,
		data: new Uint8Array(image)
	} as T;
}
