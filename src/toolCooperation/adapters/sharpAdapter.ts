import { ProviderError, normalizeUnknownError } from "../../errors";
import type { ImagePreprocessAdapter, SupportedImageFormat } from "./types";

interface SharpPipelineLike {
	resize(width: number, height: number): SharpPipelineLike;
	extract(region: { left: number; top: number; width: number; height: number }): SharpPipelineLike;
	toFormat(format: SupportedImageFormat): SharpPipelineLike;
	toBuffer(): Promise<Buffer>;
}

type SharpFactoryLike = (input: Buffer) => SharpPipelineLike;

let loadedSharpFactory: SharpFactoryLike | null = null;

try {
	const sharpModule = require("sharp") as SharpFactoryLike | { default?: SharpFactoryLike };
	loadedSharpFactory = typeof sharpModule === "function" ? sharpModule : sharpModule.default ?? null;
} catch {
	loadedSharpFactory = null;
}

const detectedSharpAvailability = loadedSharpFactory !== null;
let sharpAvailabilityOverride: boolean | undefined;

export let sharpAvailable = detectedSharpAvailability;

function refreshSharpAvailability(): void {
	sharpAvailable = sharpAvailabilityOverride ?? detectedSharpAvailability;
}

function toSharpError(operation: string, error: unknown): ProviderError {
	const normalized = normalizeUnknownError(error);
	return new ProviderError(`[sharp] ${operation} failed: ${normalized.message}`, {
		status: normalized.status,
		code: normalized.code ?? "SHARP_ADAPTER",
		body: normalized.body,
		url: normalized.url,
		retryable: normalized.retryable
	});
}

function getSharpFactory(): SharpFactoryLike | null {
	if (!sharpAvailable) {
		return null;
	}
	return loadedSharpFactory;
}

function normalizeDimension(value: number): number {
	return Math.max(1, Math.round(value));
}

export function setSharpAvailabilityForTests(value: boolean | undefined): void {
	sharpAvailabilityOverride = value;
	refreshSharpAvailability();
}

export const sharpAdapter: ImagePreprocessAdapter = {
	capability: {
		name: "sharp",
		license: "Apache-2.0",
		runtimeRequirement: "native-addon",
		performanceTier: "A",
		fallbackAdapterName: "jimp"
	},
	async resize(input: Buffer, width: number, height: number): Promise<Buffer> {
		const sharpFactory = getSharpFactory();
		if (!sharpFactory) {
			void toSharpError("resize", new Error("sharp is unavailable"));
			return input;
		}
		try {
			return await sharpFactory(input)
				.resize(normalizeDimension(width), normalizeDimension(height))
				.toBuffer();
		} catch (error) {
			throw toSharpError("resize", error);
		}
	},
	async crop(input: Buffer, x: number, y: number, w: number, h: number): Promise<Buffer> {
		const sharpFactory = getSharpFactory();
		if (!sharpFactory) {
			void toSharpError("crop", new Error("sharp is unavailable"));
			return input;
		}
		try {
			return await sharpFactory(input)
				.extract({
					left: Math.max(0, Math.round(x)),
					top: Math.max(0, Math.round(y)),
					width: normalizeDimension(w),
					height: normalizeDimension(h)
				})
				.toBuffer();
		} catch (error) {
			throw toSharpError("crop", error);
		}
	},
	async toFormat(input: Buffer, format: SupportedImageFormat): Promise<Buffer> {
		const sharpFactory = getSharpFactory();
		if (!sharpFactory) {
			void toSharpError("toFormat", new Error("sharp is unavailable"));
			return input;
		}
		try {
			return await sharpFactory(input)
				.toFormat(format)
				.toBuffer();
		} catch (error) {
			throw toSharpError("toFormat", error);
		}
	}
};