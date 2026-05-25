import test from "node:test";
import assert from "node:assert/strict";
import { API_KEY_ENVIRONMENT_VARIABLES, getProviderEnvironmentVariableName, HOST_UI_SMOKE_API_KEY_PROVIDERS, summarizeApiKeyEnvironment } from "../e2e/hostUi/env";
import { isHostUiSmokeWindowTitle, isSmokeVscodeWelcomeWindowTitle } from "../e2e/driver/hostUiSmokeWindowMatch";

test("host UI smoke knows all supported provider API key environment variables", () => {
	assert.deepEqual([...HOST_UI_SMOKE_API_KEY_PROVIDERS], ["deepseek", "zhipu", "kimi", "minimax", "qwen"]);
	assert.deepEqual(API_KEY_ENVIRONMENT_VARIABLES, [
		"DASHSCOPE_API_KEY",
		"DEEPSEEK_API_KEY",
		"KIMI_API_KEY",
		"MINIMAX_API_KEY",
		"ZHIPU_API_KEY"
	]);
	assert.equal(getProviderEnvironmentVariableName("deepseek"), "DEEPSEEK_API_KEY");
	assert.equal(getProviderEnvironmentVariableName("zhipu"), "ZHIPU_API_KEY");
	assert.equal(getProviderEnvironmentVariableName("qwen"), "DASHSCOPE_API_KEY");
	assert.equal(getProviderEnvironmentVariableName("dashscope"), "DASHSCOPE_API_KEY");
	assert.equal(getProviderEnvironmentVariableName("minimax"), "MINIMAX_API_KEY");
	assert.equal(getProviderEnvironmentVariableName("kimi"), "KIMI_API_KEY");
	assert.equal(getProviderEnvironmentVariableName("moonshot"), "KIMI_API_KEY");
});

test("host UI smoke records API key availability without exposing secrets", () => {
	const summary = summarizeApiKeyEnvironment({
		DEEPSEEK_API_KEY: "sk-present",
		ZHIPU_API_KEY: "   ",
		DASHSCOPE_API_KEY: undefined,
		MINIMAX_API_KEY: "minimax-present",
		KIMI_API_KEY: "kimi-present"
	});

	assert.deepEqual(summary, {
		DASHSCOPE_API_KEY: "missing",
		DEEPSEEK_API_KEY: "present",
		KIMI_API_KEY: "present",
		MINIMAX_API_KEY: "present",
		ZHIPU_API_KEY: "missing"
	});
	assert.doesNotMatch(JSON.stringify(summary), /sk-present|minimax-present|kimi-present/);
});

test("host UI smoke window cleanup only targets smoke VS Code windows", () => {
	assert.equal(isHostUiSmokeWindowTitle("README.md - HostUiSmokeWorkspace-123 - Visual Studio Code"), true);
	assert.equal(isHostUiSmokeWindowTitle("README.md - CustomSmoke - Visual Studio Code", "CustomSmoke"), true);
	assert.equal(isHostUiSmokeWindowTitle("README.md - Extended-Models-For-Copilot - Visual Studio Code"), false);
	assert.equal(isHostUiSmokeWindowTitle("HostUiSmokeWorkspace-123 - Browser"), false);
});

test("host UI smoke welcome window titles are exact allowlist only", () => {
	assert.equal(isSmokeVscodeWelcomeWindowTitle("Welcome - Visual Studio Code"), true);
	assert.equal(isSmokeVscodeWelcomeWindowTitle("Getting Started - Visual Studio Code"), true);
	assert.equal(isSmokeVscodeWelcomeWindowTitle("Welcome - Visual Studio Code "), true);
	assert.equal(isSmokeVscodeWelcomeWindowTitle("README.md - HostUiSmokeWorkspace-1 - Visual Studio Code"), false);
});
