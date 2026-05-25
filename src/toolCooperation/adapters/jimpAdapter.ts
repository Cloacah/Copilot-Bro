import { ProviderError, normalizeUnknownError } from "../../errors";
import type { ImagePreprocessAdapter, SupportedImageFormat } from "./types";

interface JimpBitmap {
	width: number;
	height: number;
}

interface JimpImageLike {
	bitmap: JimpBitmap;
	resize(options: { w: number; h: number }): JimpImageLike;
	crop(options: { x: number; y: number; w: number; h: number }): JimpImageLike;
	getBuffer(mime: string): Promise<Buffer>;
}

interface JimpClassLike {
	read(input: Buffer): Promise<JimpImageLike>;
}

let loadedJimpClass: JimpClassLike | null | undefined;

function getJimpClass(): JimpClassLike | null {
	if (loadedJimpClass !== undefined) {
		return loadedJimpClass;
	}
	try {
		const jimpModule = require("jimp") as { Jimp?: JimpClassLike };
		loadedJimpClass = jimpModule.Jimp ?? null;
	} catch {
		loadedJimpClass = null;
	}
	return loadedJimpClass;
}

const MIME_BY_FORMAT: Record<SupportedImageFormat, string> = {
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp"
};

function toJimpError(operation: string, error: unknown): ProviderError {
	const normalized = normalizeUnknownError(error);
	return new ProviderError(`[jimp] ${operation} failed: ${normalized.message}`, {
		status: normalized.status,
		code: normalized.code ?? "JIMP_ADAPTER",
		body: normalized.body,
		url: normalized.url,
		retryable: normalized.retryable
	});
}

function normalizeDimension(value: number): number {
	return Math.max(1, Math.round(value));
}

async function loadJimpImage(input: Buffer): Promise<JimpImageLike> {
	const JimpClass = getJimpClass();
	if (!JimpClass) {
		throw toJimpError("load", new Error("jimp is unavailable"));
	}
	return JimpClass.read(input);
}

export const jimpAdapter: ImagePreprocessAdapter = {
	capability: {
		name: "jimp",
		license: "MIT",
		runtimeRequirement: "none",
		performanceTier: "B"
	},
	async resize(input: Buffer, width: number, height: number): Promise<Buffer> {
		try {
			const image = await loadJimpImage(input);
			image.resize({
				w: normalizeDimension(width),
				h: normalizeDimension(height)
			});
			return image.getBuffer(MIME_BY_FORMAT.png);
		} catch (error) {
			throw toJimpError("resize", error);
		}
	},
	async crop(input: Buffer, x: number, y: number, w: number, h: number): Promise<Buffer> {
		try {
			const image = await loadJimpImage(input);
			image.crop({
				x: Math.max(0, Math.round(x)),
				y: Math.max(0, Math.round(y)),
				w: normalizeDimension(w),
				h: normalizeDimension(h)
			});
			return image.getBuffer(MIME_BY_FORMAT.png);
		} catch (error) {
			throw toJimpError("crop", error);
		}
	},
	async toFormat(input: Buffer, format: SupportedImageFormat): Promise<Buffer> {
		try {
			const image = await loadJimpImage(input);
			return image.getBuffer(MIME_BY_FORMAT[format]);
		} catch (error) {
			throw toJimpError("toFormat", error);
		}
	}
};