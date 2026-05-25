import test from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { getApiKey, providerSecretKey, shouldDeferApiKeyPromptInSmoke } from "../secretsStorage";
import type { ModelConfig } from "../types";

function createMockSecrets(store: Record<string, string> = {}): vscode.SecretStorage {
	return {
		get: async (key: string) => store[key],
		store: async (key: string, value: string) => {
			store[key] = value;
		},
		delete: async (key: string) => {
			delete store[key];
		},
		keys: async () => Object.keys(store),
		onDidChange: () => ({ dispose: () => undefined })
	} as unknown as vscode.SecretStorage;
}

const deepseekModel: ModelConfig = {
	id: "deepseek-v4-flash",
	provider: "deepseek",
	baseUrl: "https://example.com/v1",
	contextLength: 128000,
	maxOutputTokens: 8192,
	vision: false,
	toolCalling: false,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: []
};

test("providerSecretKey normalizes provider id", () => {
	assert.equal(providerSecretKey("DeepSeek"), "extendedModels.apiKey.deepseek");
});

test("getApiKey prefers provider-specific secret over default", async () => {
	const secrets = createMockSecrets({
		"extendedModels.apiKey.deepseek": "provider-key",
		"extendedModels.apiKey": "default-key"
	});
	assert.equal(await getApiKey(secrets, deepseekModel), "provider-key");
});

test("shouldDeferApiKeyPromptInSmoke is true when COPILOT_BRO_UI_SMOKE=1", () => {
	const previous = process.env.COPILOT_BRO_UI_SMOKE;
	process.env.COPILOT_BRO_UI_SMOKE = "1";
	try {
		assert.equal(shouldDeferApiKeyPromptInSmoke(), true);
	} finally {
		if (previous === undefined) {
			delete process.env.COPILOT_BRO_UI_SMOKE;
		} else {
			process.env.COPILOT_BRO_UI_SMOKE = previous;
		}
	}
});
