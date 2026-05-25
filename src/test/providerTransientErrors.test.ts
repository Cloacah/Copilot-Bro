import test from "node:test";
import assert from "node:assert/strict";
import { createHttpError } from "../errors";
import {
	extractBusinessCodeFromMessage,
	extractErrorTypeFromMessage,
	inferHttpRetryable,
	isFatalProviderFailure,
	isTransientProviderFailure,
	parseProviderErrorBody,
	shouldAdvanceHostUiModelCandidate
} from "../providerTransientErrors";

test("parseProviderErrorBody reads Zhipu business code from JSON body", () => {
	const body = "{\"error\":{\"code\":\"1305\",\"message\":\"该模型当前访问量过大，请您稍后再试\"}}";
	assert.deepEqual(parseProviderErrorBody(body), { businessCode: "1305" });
	assert.equal(inferHttpRetryable(429, "1305"), true);
});

test("createHttpError marks Zhipu 1305 as retryable", () => {
	const error = createHttpError(
		429,
		"Too Many Requests",
		"{\"error\":{\"code\":\"1305\",\"message\":\"该模型当前访问量过大，请您稍后再试\"}}",
		"https://open.bigmodel.cn/api/paas/v4/chat/completions"
	);
	assert.equal(error.code, "1305");
	assert.equal(error.retryable, true);
});

test("isTransientProviderFailure recognizes Copilot user-facing rate limit text", () => {
	const message = [
		"Sorry, your request failed. Please try again.",
		"Provider API error: [429] Too Many Requests",
		"{\"error\":{\"code\":\"1305\",\"message\":\"该模型当前访问量过大，请您稍后再试\"}}"
	].join("\n");
	assert.equal(isTransientProviderFailure(new Error(message)), true);
	assert.equal(extractBusinessCodeFromMessage(message), "1305");
});

test("isFatalProviderFailure rejects auth and balance errors", () => {
	assert.equal(isFatalProviderFailure(createHttpError(401, "Unauthorized", "{\"error\":{\"code\":\"1002\"}}", "")), true);
	assert.equal(isFatalProviderFailure(createHttpError(429, "Too Many Requests", "{\"error\":{\"code\":\"1113\"}}", "")), true);
	assert.equal(isTransientProviderFailure(createHttpError(429, "Too Many Requests", "{\"error\":{\"code\":\"1305\"}}", "")), true);
});

test("generic request failed without rate-limit signals is not transient", () => {
	assert.equal(isTransientProviderFailure(new Error("Sorry, your request failed.")), false);
	assert.equal(
		isTransientProviderFailure(new Error("Sorry, your request failed. Provider API error: [500] Internal Server Error")),
		false
	);
});

test("isFatalProviderFailure rejects Zhipu 1304 and 1310", () => {
	assert.equal(isFatalProviderFailure(createHttpError(403, "Forbidden", "{\"error\":{\"code\":\"1304\"}}", "")), true);
	assert.equal(isFatalProviderFailure(createHttpError(403, "Forbidden", "{\"error\":{\"code\":\"1310\"}}", "")), true);
});

test("isTransientProviderFailure recognizes Moonshot engine_overloaded type", () => {
	const body = "{\"error\":{\"type\":\"engine_overloaded\",\"message\":\"Engine is overloaded\"}}";
	assert.deepEqual(parseProviderErrorBody(body), { errorType: "engine_overloaded" });
	assert.equal(extractErrorTypeFromMessage(body), "engine_overloaded");
	assert.equal(isTransientProviderFailure(createHttpError(503, "Service Unavailable", body, "")), true);
});

test("shouldAdvanceHostUiModelCandidate advances on transient and model-missing errors", () => {
	assert.equal(shouldAdvanceHostUiModelCandidate(createHttpError(429, "x", "{\"error\":{\"code\":\"1305\"}}", "")), true);
	assert.equal(shouldAdvanceHostUiModelCandidate(new Error("模型不存在，请检查模型代码")), true);
	assert.equal(shouldAdvanceHostUiModelCandidate(createHttpError(401, "x", "{\"error\":{\"code\":\"1002\"}}", "")), false);
});
