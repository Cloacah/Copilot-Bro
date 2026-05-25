import type { ExtensionSettings, RetrySettings } from "./types";

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
