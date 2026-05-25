import test from "node:test";
import assert from "node:assert/strict";
import {
	resolveStructuredVisionFormatMaxAttempts,
	resolveStructuredVisionHttpRetry
} from "../visionStructuredRetryPolicy";
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
