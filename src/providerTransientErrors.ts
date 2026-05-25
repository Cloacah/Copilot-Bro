import { normalizeUnknownError, ProviderError } from "./errors";

/**
 * Zhipu / BigModel business codes that should be retried (see API FAQ).
 * @see https://docs.bigmodel.cn/cn/faq/api-code
 */
export const ZHIPU_TRANSIENT_BUSINESS_CODES = new Set([
	"1302", // account rate limit
	"1305", // model traffic too high
	"1308", // usage cap (resets at next_flush_time)
	"1312" // model busy — docs suggest switching models
]);

/** Business codes that must not be retried with the same request parameters. */
export const ZHIPU_FATAL_BUSINESS_CODES = new Set([
	"1000",
	"1001",
	"1002",
	"1003",
	"1004",
	"1113", // balance exhausted
	"1211", // model does not exist
	"1304", // apikey not authorized for model
	"1309", // apikey account in arrears
	"1310" // apikey account frozen
]);

const TRANSIENT_MESSAGE_PATTERNS = [
	/too many requests/i,
	/访问量过大/,
	/请您稍后再试/,
	/please try again/i,
	/rate limit/i
];

function matchesTransientMessagePattern(text: string): boolean {
	if (TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(text))) {
		return true;
	}
	if (/request failed/i.test(text)) {
		return /\b429\b/u.test(text)
			|| /\b(1302|1305|1308|1312)\b/u.test(text)
			|| /too many requests|rate limit|访问量过大/i.test(text);
	}
	return false;
}

export function parseProviderErrorBody(body: string): { businessCode?: string } {
	const trimmed = body?.trim();
	if (!trimmed) {
		return {};
	}
	try {
		const json = JSON.parse(trimmed) as { error?: { code?: unknown }; code?: unknown };
		const raw = json.error?.code ?? json.code;
		if (raw !== undefined && raw !== null) {
			return { businessCode: String(raw) };
		}
	} catch {
		// fall through — body may be embedded in a longer message
	}
	const match = trimmed.match(/"code"\s*:\s*"?(\d+)"?/u);
	return match ? { businessCode: match[1] } : {};
}

export function extractBusinessCodeFromMessage(message: string): string | undefined {
	const parsed = parseProviderErrorBody(message);
	if (parsed.businessCode) {
		return parsed.businessCode;
	}
	const inline = message.match(/\b(1[0-9]{3})\b/u);
	return inline?.[1];
}

export function inferHttpRetryable(status: number, businessCode?: string): boolean {
	if (businessCode) {
		if (ZHIPU_FATAL_BUSINESS_CODES.has(businessCode)) {
			return false;
		}
		if (ZHIPU_TRANSIENT_BUSINESS_CODES.has(businessCode)) {
			return true;
		}
	}
	return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function isTransientProviderFailure(error: unknown): boolean {
	const normalized = normalizeUnknownError(error);
	const businessCode = normalized.code ?? extractBusinessCodeFromMessage(`${normalized.message}\n${normalized.body ?? ""}`);
	if (businessCode && ZHIPU_FATAL_BUSINESS_CODES.has(businessCode)) {
		return false;
	}
	if (businessCode && ZHIPU_TRANSIENT_BUSINESS_CODES.has(businessCode)) {
		return true;
	}
	if (normalized.retryable) {
		return true;
	}
	const text = `${normalized.message}\n${normalized.body ?? ""}`;
	if (matchesTransientMessagePattern(text)) {
		return true;
	}
	if (/\b(429|1302|1305|1308|1312)\b/u.test(text)) {
		return true;
	}
	return false;
}

export function isFatalProviderFailure(error: unknown): boolean {
	const normalized = normalizeUnknownError(error);
	const businessCode = normalized.code ?? extractBusinessCodeFromMessage(`${normalized.message}\n${normalized.body ?? ""}`);
	if (businessCode && ZHIPU_FATAL_BUSINESS_CODES.has(businessCode)) {
		return true;
	}
	if (normalized.status === 401 || normalized.status === 403) {
		return true;
	}
	return false;
}

export function shouldAdvanceHostUiModelCandidate(error: unknown): boolean {
	if (isFatalProviderFailure(error)) {
		return false;
	}
	if (isTransientProviderFailure(error)) {
		return true;
	}
	const text = normalizeUnknownError(error).message;
	return /模型不存在|model.*not exist|does not exist/i.test(text);
}

export function computeProviderRetryDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
	const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
	return Math.min(exponential, maxDelayMs);
}
