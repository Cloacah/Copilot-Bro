import test from "node:test";
import assert from "node:assert/strict";
import { createHttpError, isRetryableError, ProviderError } from "../errors";
import { executeWithRetry } from "../openaiCompat/client";

test("createHttpError marks retryable status codes", () => {
	const rateLimit = createHttpError(429, "Too Many Requests", "slow down", "https://example.com");
	const zhipuBusy = createHttpError(
		429,
		"Too Many Requests",
		"{\"error\":{\"code\":\"1305\",\"message\":\"该模型当前访问量过大，请您稍后再试\"}}",
		"https://open.bigmodel.cn/api/paas/v4/chat/completions"
	);
	const badRequest = createHttpError(400, "Bad Request", "bad", "https://example.com");

	assert.equal(rateLimit.retryable, true);
	assert.equal(zhipuBusy.retryable, true);
	assert.equal(zhipuBusy.code, "1305");
	assert.equal(badRequest.retryable, false);
	assert.equal(rateLimit.toUserMessage(), "Provider rate limit was reached. The request was retried when possible.");
});

test("executeWithRetry retries retryable provider errors", async () => {
	let attempts = 0;
	const result = await executeWithRetry(async () => {
		attempts++;
		if (attempts < 2) {
			throw new ProviderError("temporary", { status: 500, retryable: true });
		}
		return "ok";
	}, {
		enabled: true,
		maxAttempts: 3,
		baseDelayMs: 1,
		statusCodes: []
	});

	assert.equal(result, "ok");
	assert.equal(attempts, 2);
});

test("isRetryableError recognizes network failures", () => {
	assert.equal(isRetryableError(new Error("fetch failed")), true);
});
