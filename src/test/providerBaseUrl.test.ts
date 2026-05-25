import test from "node:test";
import assert from "node:assert/strict";
import {
	enrichModelsWithProviderBaseUrl,
	normalizeProviderCustomBaseUrls,
	resolveEffectiveModelBaseUrl,
	stripBaseUrlFromModelRecord
} from "../config/providerBaseUrl";

test("resolveEffectiveModelBaseUrl prefers custom URL then catalog profile", () => {
	const model = { provider: "qwen", id: "qwen-turbo" };
	assert.equal(
		resolveEffectiveModelBaseUrl(model, { qwen: "dashscope-intl" }, {}),
		"https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
	);
	assert.equal(
		resolveEffectiveModelBaseUrl(model, {}, { qwen: "https://custom.example/v1" }),
		"https://custom.example/v1"
	);
});

test("enrichModelsWithProviderBaseUrl injects runtime baseUrl without persisting on custom models", () => {
	const enriched = enrichModelsWithProviderBaseUrl(
		[{ provider: "deepseek", id: "deepseek-v4-flash" }],
		{},
		{}
	);
	assert.match(String((enriched[0] as { baseUrl?: string }).baseUrl), /deepseek\.com/);
});

test("stripBaseUrlFromModelRecord removes persisted gateway from custom model rows", () => {
	const stripped = stripBaseUrlFromModelRecord({
		id: "custom-qwen",
		provider: "qwen",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
	});
	assert.equal("baseUrl" in stripped, false);
	assert.equal(stripped.id, "custom-qwen");
});

test("normalizeProviderCustomBaseUrls rejects invalid entries", () => {
	assert.deepEqual(
		normalizeProviderCustomBaseUrls({ qwen: "https://a.com/v1", bad: 1, empty: "  " }),
		{ qwen: "https://a.com/v1" }
	);
});
