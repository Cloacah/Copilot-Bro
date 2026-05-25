import type { ExtensionSettings, RetrySettings } from "./types";
import { executeWithRetry } from "./openaiCompat/client";
import { normalizeUnknownError } from "./errors";
import type { Logger } from "./logger";

const VISION_PROXY_MAX_FORMAT_RETRIES = 3;

/** @internal Exported for unit tests. */
export function resolveStructuredVisionFormatMaxAttempts(settings: ExtensionSettings): number {
	if (!settings.retry.enabled) {
		return 1;
	}
	return Math.max(1, Math.min(VISION_PROXY_MAX_FORMAT_RETRIES, settings.retry.maxAttempts));
}

/** @internal Exported for unit tests. */
export function resolveStructuredVisionHttpRetry(settings: ExtensionSettings): RetrySettings {
	return {
		...settings.retry,
		maxAttempts: settings.retry.enabled ? settings.retry.maxAttempts : 1
	};
}

/** Wraps VS Code LM structured vision calls with the same HTTP retry policy as native OpenAI requests. */
export async function executeStructuredVisionLmWithRetry(
	fn: () => Promise<string>,
	settings: ExtensionSettings,
	logger: Logger,
	meta: { route: "proxy" | "native"; modelLabel?: string }
): Promise<string> {
	const retry = resolveStructuredVisionHttpRetry(settings);
	return executeWithRetry(async () => {
		try {
			return await fn();
		} catch (error) {
			throw normalizeUnknownError(error);
		}
	}, retry, (attempt, delayMs, error) => {
		logger.info("vision.structured.request.retry", {
			route: meta.route,
			modelLabel: meta.modelLabel,
			attempt,
			delayMs,
			status: error.status,
			code: error.code,
			message: error.message
		});
	});
}
