import test from "node:test";
import assert from "node:assert/strict";
import { renderPhase1Field, renderProviderOptions } from "../ui/configPanelShared";
import { providerEndpointCatalogForClient } from "../config/providerEndpoints";
import { renderProviderEndpointProfileSelect } from "../ui/providerEndpointUi";
import { getVisiblePhase1Sections } from "../ui/phase1ConfigUi";

function getSectionField(sectionKey: string, fieldKey: string) {
	const section = getVisiblePhase1Sections().find((candidate) => candidate.key === sectionKey);
	assert.ok(section, `missing section ${sectionKey}`);
	const field = section.fields.find((candidate) => candidate.key === fieldKey);
	assert.ok(field, `missing field ${sectionKey}.${fieldKey}`);
	return field;
}

test("config panel provider options keep the persisted provider selected", () => {
	const html = renderProviderOptions(["deepseek", "qwen"], ["deepseek"], "qwen", "provider option tip");
	assert.match(html, /<option value="qwen" title="provider option tip" selected>qwen<\/option>/);
	assert.match(html, /<option value="deepseek" title="provider option tip" >✓ deepseek<\/option>/);
});

test("config panel phase1 boolean and number fields inline persisted values", () => {
	const enabledField = getSectionField("visionAgent", "enabled");
	const keepAliveField = getSectionField("visionAgent", "keepAliveMs");
	const enabledHtml = renderPhase1Field("visionAgent", enabledField, true, "en");
	const keepAliveHtml = renderPhase1Field("visionAgent", keepAliveField, 120000, "en");
	assert.match(enabledHtml, /type="checkbox"[^>]*checked/);
	assert.match(keepAliveHtml, /value="120000"/);
	assert.match(keepAliveHtml, /min="0"/);
	assert.match(keepAliveHtml, /max="600000"/);
	assert.doesNotMatch(keepAliveHtml, /undefined/);
});

test("config panel renders provider endpoint profile select for catalog providers", () => {
	const catalog = providerEndpointCatalogForClient();
	const html = renderProviderEndpointProfileSelect({
		catalog,
		provider: "qwen",
		selectedProfileId: "dashscope-cn",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		language: "en",
		customLabel: { zh: "自定义 URL", en: "Custom URL" },
		selectTip: "Pick regional gateway"
	});
	assert.match(html, /id="providerEndpointProfile"/);
	assert.match(html, /value="dashscope-cn" selected/);
	assert.match(html, /China \(Beijing\)/);
	assert.match(html, /value="custom"/);
	assert.equal(renderProviderEndpointProfileSelect({
		catalog,
		provider: "deepseek",
		selectedProfileId: "custom",
		baseUrl: "https://api.deepseek.com",
		language: "zh",
		customLabel: { zh: "自定义 URL", en: "Custom URL" },
		selectTip: "tip"
	}), "");
});

test("config panel phase1 select and string fields inline persisted values", () => {
	const autoCloseField = getSectionField("visionAgent", "autoClosePolicy");
	const schemaField = getSectionField("visionProcessing", "spatialSchemaVersion");
	const autoCloseHtml = renderPhase1Field("visionAgent", autoCloseField, "afterTimeout", "en");
	const schemaHtml = renderPhase1Field("visionProcessing", schemaField, "v2", "en");
	assert.match(autoCloseHtml, /<option value="afterTimeout" selected>afterTimeout<\/option>/);
	assert.match(schemaHtml, /value="v2"/);
	assert.doesNotMatch(schemaHtml, /undefined/);
});