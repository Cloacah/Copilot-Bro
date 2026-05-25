import type { ProviderErrorDetails } from "./types";
import { inferHttpRetryable, parseProviderErrorBody } from "./providerTransientErrors";

const DEFAULT_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const NETWORK_PATTERNS = [
	"fetch failed",
	"ECONNRESET",
	"ETIMEDOUT",
	"ENOTFOUND",
	"ECONNREFUSED",
	"network",
	"timeout",
	"aborted"
];

export class ProviderError extends Error {
	readonly status?: number;
	readonly code?: string;
	readonly body?: string;
	readonly url?: string;
	readonly retryable: boolean;

	constructor(message: string, details: ProviderErrorDetails = {}) {
		super(message);
		this.name = "ProviderError";
		this.status = details.status;
		this.code = details.code;
		this.body = details.body;
		this.url = details.url;
		this.retryable = details.retryable ?? inferRetryable(message, details.status);
	}

	toUserMessage(): string {
		if (this.status === 401 || this.status === 403) {
			return "Provider authentication failed. Check the API key for this model provider.";
		}
		if (this.status === 429) {
			return "Provider rate limit was reached. The request was retried when possible.";
		}
		if (this.status && this.status >= 500) {
			return `Provider returned a server error (${this.status}).`;
		}
		if (this.code === "CONFIG") {
			return this.message;
		}
		if (this.code === "CANCELLED") {
			return "The model request was cancelled.";
		}
		return this.message;
	}
}

export function createHttpError(status: number, statusText: string, body: string, url: string): ProviderError {
	const message = `Provider API error: [${status}] ${statusText}${body ? `\n${body}` : ""}`;
	const { businessCode } = parseProviderErrorBody(body);
	return new ProviderError(message, {
		status,
		body,
		url,
		code: businessCode,
		retryable: inferHttpRetryable(status, businessCode)
	});
}

export function normalizeUnknownError(error: unknown): ProviderError {
	if (error instanceof ProviderError) {
		return error;
	}
	if (error instanceof Error) {
		const isAbort = error.name === "AbortError";
		return new ProviderError(error.message, {
			code: isAbort ? "CANCELLED" : undefined,
			retryable: !isAbort && inferRetryable(error.message)
		});
	}
	return new ProviderError(String(error));
}

export function isRetryableError(error: unknown, extraStatusCodes: readonly number[] = []): boolean {
	const normalized = normalizeUnknownError(error);
	if (normalized.status && extraStatusCodes.includes(normalized.status)) {
		return true;
	}
	return normalized.retryable;
}

function inferRetryable(message: string, status?: number): boolean {
	if (status && DEFAULT_RETRYABLE_STATUS_CODES.has(status)) {
		return true;
	}
	const lower = message.toLowerCase();
	return NETWORK_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}
