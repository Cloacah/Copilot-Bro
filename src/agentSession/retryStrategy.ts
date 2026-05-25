import type { VisionAgentConfig } from "../types";

const MAX_RETRY_ATTEMPTS = 3;

export function shouldRetry(attempt: number, error: Error, config: Pick<VisionAgentConfig, "retryOnFailure">): boolean {
	if (!config.retryOnFailure) {
		return false;
	}
	if (attempt >= MAX_RETRY_ATTEMPTS) {
		return false;
	}
	if (error.name === "AbortError") {
		return false;
	}
	return !/fatal|validation|schema/i.test(error.message);
}

export function getRetryDelay(attempt: number): number {
	return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}