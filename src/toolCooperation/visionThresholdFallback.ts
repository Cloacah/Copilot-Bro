import { isImageJsUnavailableError } from "./adapters/imageJsAdapter";
import type { ImageAnalyzeAdapter } from "./adapters/types";

export interface VisionThresholdWarnSink {
	warn(message: string, data?: unknown): void;
}

export async function applyOptionalVisionThreshold(
	analyzer: Pick<ImageAnalyzeAdapter, "threshold">,
	input: Buffer,
	threshold: number,
	warnings: string[],
	logger: VisionThresholdWarnSink
): Promise<Buffer> {
	try {
		return Buffer.from(await analyzer.threshold(input, threshold));
	} catch (error) {
		if (!isImageJsUnavailableError(error)) {
			throw error;
		}
		warnings.push("image-processing:threshold_skipped_unavailable");
		logger.warn("vision.proxy.image.threshold.skipped", {
			reason: error instanceof Error ? error.message : String(error),
			threshold
		});
		return input;
	}
}