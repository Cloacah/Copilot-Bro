import type * as vscode from "vscode";
import { normalizeUnknownError } from "./errors";
import { Logger } from "./logger";
import {
	computeProviderRetryDelayMs,
	isVisionProxyFatalFailure,
	isVisionProxyRateLimitFailure
} from "./providerTransientErrors";
import type { ExtensionSettings } from "./types";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runVisionProxyDescriptionWithRetry<T>(
	fn: () => Promise<T>,
	settings: ExtensionSettings,
	logger: Logger,
	meta: { modelLabel: string; route?: string }
): Promise<T> {
	const maxAttempts = Math.max(1, settings.visionProxy.customListMaxRetriesPerModel);
	const baseDelayMs = settings.retry.baseDelayMs;
	const maxDelayMs = settings.visionProxy.customListMaxDelayMs;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			const normalized = normalizeUnknownError(error);
			if (isVisionProxyFatalFailure(error)) {
				throw error;
			}
			if (!isVisionProxyRateLimitFailure(error)) {
				throw error;
			}
			if (attempt >= maxAttempts) {
				throw error;
			}
			const delayMs = computeProviderRetryDelayMs(attempt, baseDelayMs, maxDelayMs);
			logger.info("vision.proxy.retry", {
				modelLabel: meta.modelLabel,
				route: meta.route ?? "proxy",
				attempt,
				delayMs,
				status: normalized.status,
				code: normalized.code,
				message: normalized.message
			});
			await sleep(delayMs);
		}
	}

	throw lastError;
}

export interface VisionProxyCandidate {
	readonly chatModel: vscode.LanguageModelChat;
	readonly configuredId: string;
}

export async function runVisionProxyCandidateChain<T>(
	candidates: readonly VisionProxyCandidate[],
	settings: ExtensionSettings,
	logger: Logger,
	invoke: (candidate: VisionProxyCandidate) => Promise<T>
): Promise<T> {
	if (candidates.length === 0) {
		throw new Error("vision proxy candidate chain is empty");
	}

	let lastError: unknown;
	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index]!;
		try {
			return await invoke(candidate);
		} catch (error) {
			lastError = error;
			const next = candidates[index + 1];
			if (!next) {
				throw error;
			}
			logger.info("vision.proxy.model-switch", {
				from: candidate.configuredId,
				to: next.configuredId,
				reason: isVisionProxyRateLimitFailure(error)
					? "rate-limit-exhausted"
					: normalizeUnknownError(error).message
			});
		}
	}

	throw lastError;
}
