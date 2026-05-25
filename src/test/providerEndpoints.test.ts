import test from "node:test";
import assert from "node:assert/strict";
import {
	CUSTOM_ENDPOINT_PROFILE_ID,
	applyProviderBaseUrlToStoredModels,
	applyProviderEndpointPreferences,
	findEndpointProfileByBaseUrl,
	findEndpointProfileById,
	mergeProviderEndpointsPreference,
	normalizeBaseUrlForCompare,
	normalizeProviderEndpointsConfig,
	resolveEndpointProfileId,
	resolveProviderEndpointBaseUrl,
	resolveStoredProviderEndpointProfileId
} from "../config/providerEndpoints";

test("normalizeProviderEndpointsConfig keeps valid catalog profile ids only", () => {
	// 'dashscope' is itself a valid catalog provider alias, so both qwen and dashscope survive.
	// The deduplication to one canonical key happens in mergeProviderEndpointsPreference, not here.
	const result = normalizeProviderEndpointsConfig({
		qwen: "dashscope-intl",
		unknown: "nope",
		dashscope: "dashscope-us",
		kimi: "not-real"
	});
	assert.equal(result.qwen, "dashscope-intl");
	assert.equal(result.dashscope, "dashscope-us");
	assert.equal((result as Record<string, string | undefined>).unknown, undefined);
	assert.equal((result as Record<string, string | undefined>).kimi, undefined);
});

test("resolveEndpointProfileId prefers baseUrl match over stored profile", () => {
	assert.equal(
		resolveEndpointProfileId("qwen", "https://dashscope-us.aliyuncs.com/compatible-mode/v1"),
		"dashscope-us"
	);
	assert.equal(
		resolveEndpointProfileId("qwen", "https://dashscope-us.aliyuncs.com/compatible-mode/v1", "dashscope-cn"),
		"dashscope-us"
	);
	assert.equal(
		resolveEndpointProfileId("qwen", undefined, "dashscope-cn"),
		"dashscope-cn"
	);
	assert.equal(
		resolveEndpointProfileId("qwen", ""),
		"dashscope-cn"
	);
	assert.equal(resolveEndpointProfileId("deepseek", "https://api.deepseek.com"), CUSTOM_ENDPOINT_PROFILE_ID);
});

test("applyProviderEndpointPreferences overrides built-in baseUrl for catalog providers", () => {
	const models = applyProviderEndpointPreferences(
		[{ provider: "qwen", id: "qwen-max", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" }],
		{ qwen: "dashscope-intl" }
	);
	assert.equal(
		normalizeBaseUrlForCompare(models[0]?.baseUrl ?? ""),
		normalizeBaseUrlForCompare("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
	);
});

test("applyProviderBaseUrlToStoredModels updates every custom model for provider", () => {
	const next = applyProviderBaseUrlToStoredModels(
		[
			{ id: "a", provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
			{ id: "b", provider: "deepseek", baseUrl: "https://api.deepseek.com" }
		],
		"qwen",
		"https://dashscope-us.aliyuncs.com/compatible-mode/v1"
	);
	const qwen = next[0] as { baseUrl?: string };
	const deepseek = next[1] as { baseUrl?: string };
	assert.equal(qwen.baseUrl, "https://dashscope-us.aliyuncs.com/compatible-mode/v1");
	assert.equal(deepseek.baseUrl, "https://api.deepseek.com");
});

test("mergeProviderEndpointsPreference deduplicates provider aliases", () => {
	const merged = mergeProviderEndpointsPreference(
		{ dashscope: "dashscope-cn" },
		"qwen",
		"dashscope-intl"
	);
	assert.deepEqual(merged, { qwen: "dashscope-intl" });
	assert.equal((merged as Record<string, string>).dashscope, undefined);
});

test("resolveStoredProviderEndpointProfileId reads alias keys", () => {
	assert.equal(
		resolveStoredProviderEndpointProfileId("qwen", { dashscope: "dashscope-us" }),
		"dashscope-us"
	);
});

test("kimi and minimax catalogs expose multiple regional base URLs", () => {
	assert.ok(findEndpointProfileById("kimi", "moonshot-cn"));
	assert.ok(findEndpointProfileById("minimax", "minimax-cn"));
	assert.ok(findEndpointProfileByBaseUrl("kimi", "https://api.moonshot.cn/v1"));
});

test("resolveProviderEndpointBaseUrl returns undefined for custom profile", () => {
	assert.equal(resolveProviderEndpointBaseUrl("qwen", CUSTOM_ENDPOINT_PROFILE_ID), undefined);
	assert.ok(resolveProviderEndpointBaseUrl("qwen", "dashscope-cn")?.includes("dashscope.aliyuncs.com"));
});
