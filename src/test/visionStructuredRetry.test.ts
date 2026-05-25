import test from "node:test";
import assert from "node:assert/strict";
import {
	executeStructuredVisionLmWithRetry,
	resolveStructuredVisionFormatMaxAttempts,
	resolveStructuredVisionHttpRetry
} from "../visionStructuredRetryPolicy";
import { createHttpError } from "../errors";
import type { Logger } from "../logger";
import type { ExtensionSettings } from "../types";

function retrySettings(retry: ExtensionSettings["retry"]): ExtensionSettings {
	return { retry } as ExtensionSettings;
}

test("resolveStructuredVisionFormatMaxAttempts respects retry.enabled", () => {
	assert.equal(
		resolveStructuredVisionFormatMaxAttempts(
			retrySettings({ enabled: true, maxAttempts: 3, baseDelayMs: 1000, statusCodes: [] })
		),
		3
	);
	assert.equal(
		resolveStructuredVisionFormatMaxAttempts(
			retrySettings({ enabled: false, maxAttempts: 3, baseDelayMs: 1000, statusCodes: [] })
		),
		1
	);
});

test("resolveStructuredVisionHttpRetry caps attempts when retry disabled", () => {
	const httpRetry = resolveStructuredVisionHttpRetry(
		retrySettings({ enabled: false, maxAttempts: 6, baseDelayMs: 1000, statusCodes: [] })
	);
	assert.equal(httpRetry.maxAttempts, 1);
	assert.equal(httpRetry.enabled, false);
});

test("executeStructuredVisionLmWithRetry retries transient proxy LM failures", async () => {
	let calls = 0;
	const logger = { info: () => {} } as unknown as Logger;
	const settings = retrySettings({
		enabled: true,
		maxAttempts: 3,
		baseDelayMs: 1,
		statusCodes: []
	});
	const result = await executeStructuredVisionLmWithRetry(
		async () => {
			calls += 1;
			if (calls < 2) {
				throw createHttpError(429, "Too Many Requests", "{\"error\":{\"code\":\"1305\"}}", "");
			}
			return "ok";
		},
		settings,
		logger,
		{ route: "proxy", modelLabel: "test-proxy" }
	);
	assert.equal(result, "ok");
	assert.equal(calls, 2);
});
