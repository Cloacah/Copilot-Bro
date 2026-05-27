import test from "node:test";
import assert from "node:assert/strict";
import { createHttpError } from "../errors";
import {
	isVisionProxyFatalFailure,
	isVisionProxyRateLimitFailure
} from "../providerTransientErrors";
import { runVisionProxyDescriptionWithRetry } from "../visionProxyRetryCoordinator";
import type { ExtensionSettings } from "../types";
import type { Logger } from "../logger";
import { visionProxyFixture } from "./visionProxyTestFixtures";

function mockLogger(): Logger {
	return {
		debug: () => undefined,
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined
	} as unknown as Logger;
}

function testSettings(): ExtensionSettings {
	return {
		visionProxy: visionProxyFixture({
			selectionMode: "fixed",
			defaultModelId: "glm-4.6v-flash",
			customListMaxRetriesPerModel: 3,
			customListMaxDelayMs: 1
		}),
		retry: { enabled: true, maxAttempts: 3, baseDelayMs: 1, statusCodes: [] }
	} as unknown as ExtensionSettings;
}

test("VPR-01 isVisionProxyRateLimitFailure recognizes Zhipu 1305 and Moonshot engine_overloaded", () => {
	const zhipu = createHttpError(429, "Too Many Requests", "{\"error\":{\"code\":\"1305\"}}", "");
	assert.equal(isVisionProxyRateLimitFailure(zhipu), true);
	const moonshot = createHttpError(503, "Service Unavailable", "{\"error\":{\"type\":\"engine_overloaded\"}}", "");
	assert.equal(isVisionProxyRateLimitFailure(moonshot), true);
});

test("VPR-02 fatal errors are not rate-limit retryable", () => {
	assert.equal(isVisionProxyFatalFailure(createHttpError(401, "Unauthorized", "", "")), true);
	assert.equal(isVisionProxyRateLimitFailure(createHttpError(401, "Unauthorized", "", "")), false);
});

test("VPR-03 runVisionProxyDescriptionWithRetry succeeds after transient failures", async () => {
	let calls = 0;
	const logger = mockLogger();
	const result = await runVisionProxyDescriptionWithRetry(
		async () => {
			calls += 1;
			if (calls < 2) {
				throw createHttpError(429, "Too Many Requests", "{\"error\":{\"code\":\"1305\"}}", "");
			}
			return "ok";
		},
		testSettings(),
		logger,
		{ modelLabel: "glm-4.6v-flash" }
	);
	assert.equal(result, "ok");
	assert.equal(calls, 2);
});

test("VPR-04 runVisionProxyDescriptionWithRetry rethrows after max attempts", async () => {
	const logger = mockLogger();
	await assert.rejects(
		() => runVisionProxyDescriptionWithRetry(
			async () => {
				throw createHttpError(429, "Too Many Requests", "{\"error\":{\"code\":\"1305\"}}", "");
			},
			testSettings(),
			logger,
			{ modelLabel: "test" }
		),
		/Too Many Requests/
	);
});
