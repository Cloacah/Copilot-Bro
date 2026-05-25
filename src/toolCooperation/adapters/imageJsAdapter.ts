import { ProviderError, normalizeUnknownError } from "../../errors";
import type { ImageAnalyzeAdapter } from "./types";

interface ImageJsEncodable {
	width: number;
	height: number;
	channels: number;
}

interface ImageJsThresholdable extends ImageJsEncodable {
	grey(): ImageJsThresholdable;
	threshold(options: { threshold: number }): ImageJsEncodable;
}

interface ImageJsModule {
	decode(input: Uint8Array): Promise<ImageJsThresholdable>;
	encodePng(image: ImageJsEncodable): Uint8Array | Buffer;
}

let loadedImageJsModule: ImageJsModule | null | undefined;
let imageJsLoadFailureMessage: string | undefined;

function getImageJsModule(): ImageJsModule | null {
	if (loadedImageJsModule !== undefined) {
		return loadedImageJsModule;
	}
	try {
		loadedImageJsModule = require("image-js") as ImageJsModule;
		imageJsLoadFailureMessage = undefined;
	} catch (error) {
		loadedImageJsModule = null;
		const normalized = normalizeUnknownError(error);
		imageJsLoadFailureMessage = normalized.message;
	}
	return loadedImageJsModule;
}

function createImageJsUnavailableMessage(): string {
	return imageJsLoadFailureMessage
		? `image-js is unavailable: ${imageJsLoadFailureMessage}`
		: "image-js is unavailable";
}

function toImageJsError(operation: string, error: unknown): ProviderError {
	const normalized = normalizeUnknownError(error);
	return new ProviderError(`[image-js] ${operation} failed: ${normalized.message}`, {
		status: normalized.status,
		code: normalized.code ?? "IMAGE_JS_ADAPTER",
		body: normalized.body,
		url: normalized.url,
		retryable: normalized.retryable
	});
}

function normalizeThreshold(value: number): number {
	if (!Number.isFinite(value)) {
		return 0.5;
	}
	if (value > 1) {
		return Math.max(0, Math.min(value / 255, 1));
	}
	return Math.max(0, Math.min(value, 1));
}

export const imageJsAdapter: ImageAnalyzeAdapter = {
	capability: {
		name: "image-js",
		license: "MIT",
		runtimeRequirement: "none",
		performanceTier: "A"
	},
	async getMetadata(input: Buffer): Promise<{ width: number; height: number; channels: number }> {
		try {
			const imageJsModule = getImageJsModule();
			if (!imageJsModule) {
				throw new Error(createImageJsUnavailableMessage());
			}
			const image = await imageJsModule.decode(input);
			return {
				width: image.width,
				height: image.height,
				channels: image.channels
			};
		} catch (error) {
			throw toImageJsError("getMetadata", error);
		}
	},
	async threshold(input: Buffer, value: number): Promise<Buffer> {
		try {
			const imageJsModule = getImageJsModule();
			if (!imageJsModule) {
				throw new Error(createImageJsUnavailableMessage());
			}
			const image = await imageJsModule.decode(input);
			const thresholdSource = image.channels === 1 ? image : image.grey();
			const thresholdImage = thresholdSource.threshold({ threshold: normalizeThreshold(value) });
			return Buffer.from(imageJsModule.encodePng(thresholdImage));
		} catch (error) {
			throw toImageJsError("threshold", error);
		}
	}
};

export function isImageJsUnavailableError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /image-js is unavailable/i.test(message);
}