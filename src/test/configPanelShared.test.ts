import test from "node:test";
import assert from "node:assert/strict";
import { renderProviderOptions, resolveConfigPanelLanguage } from "../ui/configPanelShared";

test("resolveConfigPanelLanguage falls back to zh for invalid values", () => {
	assert.equal(resolveConfigPanelLanguage("zh"), "zh");
	assert.equal(resolveConfigPanelLanguage("en"), "en");
	assert.equal(resolveConfigPanelLanguage("ja"), "zh");
	assert.equal(resolveConfigPanelLanguage(""), "zh");
	assert.equal(resolveConfigPanelLanguage(undefined), "zh");
});

test("renderProviderOptions tolerates undefined values without crashing", () => {
	const html = renderProviderOptions(["deepseek", undefined], ["deepseek"], undefined, undefined);

	assert.match(html, /value="deepseek"/);
	assert.match(html, />✓ deepseek</);
	assert.match(html, /<option value=""/);
});