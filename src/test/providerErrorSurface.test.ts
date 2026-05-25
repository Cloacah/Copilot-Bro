import test from "node:test";
import assert from "node:assert/strict";
import { createHttpError, normalizeUnknownError, ProviderError } from "../errors";

test("ProviderError surfaces auth and rate-limit user messages without leaking body", () => {
	const auth = createHttpError(401, "Unauthorized", '{"error":"invalid key"}', "https://api.example.com/v1/chat");
	assert.match(auth.toUserMessage(), /authentication/i);
	assert.doesNotMatch(auth.toUserMessage(), /invalid key/u);

	const rate = createHttpError(429, "Too Many Requests", "", "https://api.example.com/v1/chat");
	assert.match(rate.toUserMessage(), /rate limit/i);
});

test("normalizeUnknownError wraps unknown failures as ProviderError", () => {
	const normalized = normalizeUnknownError(new Error("fetch failed"));
	assert.ok(normalized instanceof ProviderError);
	assert.equal(normalized.retryable, true);
});
