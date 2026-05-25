export interface ResolvedImageMimeType {
	mimeType: string | undefined;
	detectedMimeType: string | undefined;
	corrected: boolean;
}

export function resolveImageMimeType(bytes: Uint8Array, extensionMimeType?: string): ResolvedImageMimeType {
	const detectedMimeType = detectImageMimeType(bytes);
	return {
		mimeType: detectedMimeType ?? extensionMimeType,
		detectedMimeType,
		corrected: Boolean(detectedMimeType && extensionMimeType && detectedMimeType !== extensionMimeType)
	};
}

export function detectImageMimeType(bytes: Uint8Array): string | undefined {
	if (bytes.length >= 8 && isPng(bytes)) {
		return "image/png";
	}
	if (bytes.length >= 3 && isJpeg(bytes)) {
		return "image/jpeg";
	}
	if (bytes.length >= 6 && isGif(bytes)) {
		return "image/gif";
	}
	if (bytes.length >= 12 && isWebp(bytes)) {
		return "image/webp";
	}
	if (bytes.length >= 2 && isBmp(bytes)) {
		return "image/bmp";
	}
	if (looksLikeSvg(bytes)) {
		return "image/svg+xml";
	}
	return undefined;
}

function isPng(bytes: Uint8Array): boolean {
	return bytes[0] === 0x89
		&& bytes[1] === 0x50
		&& bytes[2] === 0x4e
		&& bytes[3] === 0x47
		&& bytes[4] === 0x0d
		&& bytes[5] === 0x0a
		&& bytes[6] === 0x1a
		&& bytes[7] === 0x0a;
}

function isJpeg(bytes: Uint8Array): boolean {
	return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isGif(bytes: Uint8Array): boolean {
	return (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
		&& ((bytes[4] === 0x37 && bytes[5] === 0x61) || (bytes[4] === 0x39 && bytes[5] === 0x61));
}

function isWebp(bytes: Uint8Array): boolean {
	return bytes[0] === 0x52
		&& bytes[1] === 0x49
		&& bytes[2] === 0x46
		&& bytes[3] === 0x46
		&& bytes[8] === 0x57
		&& bytes[9] === 0x45
		&& bytes[10] === 0x42
		&& bytes[11] === 0x50;
}

function isBmp(bytes: Uint8Array): boolean {
	return bytes[0] === 0x42 && bytes[1] === 0x4d;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
	const sample = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 512))).toString("utf8").trimStart();
	if (!sample) {
		return false;
	}
	if (sample.startsWith("<svg") || sample.startsWith("<?xml")) {
		return sample.includes("<svg");
	}
	return false;
}