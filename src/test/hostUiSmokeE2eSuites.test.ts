import test from "node:test";
import assert from "node:assert/strict";
import {
	applyHostUiSmokeE2eSuiteDependencies,
	HOST_UI_SMOKE_E2E_CORE_SUITE_IDS,
	HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS,
	HOST_UI_SMOKE_E2E_EXTENDED_SUITE_IDS,
	HOST_UI_SMOKE_E2E_OPTIONAL_SUITE_IDS,
	HOST_UI_SMOKE_E2E_SUITE_IDS,
	isConfigPanelOnlyHostUiSmokeRun,
	parseHostUiSmokeE2eSuites,
	shouldRunHostUiSmokeE2eSuite
} from "../e2e/hostUi/suites/e2eSuites";

test("parseHostUiSmokeE2eSuites defaults to full matrix (core + extended)", () => {
	const s = parseHostUiSmokeE2eSuites({});
	assert.equal(s.size, HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS.length);
	for (const id of HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS) {
		assert.equal(s.has(id), true);
	}
});

test("parseHostUiSmokeE2eSuites adds github-chat-login when chat-scenarios is selected", () => {
	const s = parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "chat-scenarios" });
	assert.equal(s.has("chat-scenarios"), true);
	assert.equal(s.has("github-chat-login"), true);
});

test("applyHostUiSmokeE2eSuiteDependencies is idempotent when login already listed", () => {
	const input = new Set(["chat-scenarios", "github-chat-login"] as const);
	const out = applyHostUiSmokeE2eSuiteDependencies(input);
	assert.equal(out.size, 2);
});

test("parseHostUiSmokeE2eSuites accepts comma subset of core", () => {
	const s = parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "config-panel, chat-scenarios " });
	assert.equal(shouldRunHostUiSmokeE2eSuite(s, "config-panel"), true);
	assert.equal(shouldRunHostUiSmokeE2eSuite(s, "provider-probe"), false);
});

test("parseHostUiSmokeE2eSuites accepts extended suite ids explicitly", () => {
	const s = parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "vision-probe" });
	assert.equal(s.size, 1);
	assert.equal(shouldRunHostUiSmokeE2eSuite(s, "vision-probe"), true);
});

test("parseHostUiSmokeE2eSuites merges all with extended without duplicating", () => {
	const s = parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "all, vision-probe" });
	assert.equal(s.size, HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS.length);
	assert.equal(shouldRunHostUiSmokeE2eSuite(s, "vision-probe"), true);
});

test("parseHostUiSmokeE2eSuites rejects unknown id", () => {
	assert.throws(() => parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "not-a-suite" }), /Unknown COPILOT_BRO_UI_SMOKE_E2E/);
});

test("isConfigPanelOnlyHostUiSmokeRun detects single-suite config-panel runs", () => {
	const only = parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "config-panel" });
	assert.equal(isConfigPanelOnlyHostUiSmokeRun(only), true);
	const multi = parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "config-panel,chat-scenarios" });
	assert.equal(isConfigPanelOnlyHostUiSmokeRun(multi), false);
});

test("parseHostUiSmokeE2eSuites treats explicit all like default full matrix", () => {
	const explicit = parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "ALL" });
	const implicit = parseHostUiSmokeE2eSuites({});
	assert.equal(explicit.size, implicit.size);
});

test("parseHostUiSmokeE2eSuites merges all with core id dedupes", () => {
	const s = parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "all, config-panel" });
	assert.equal(s.size, HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS.length);
});

test("parseHostUiSmokeE2eSuites rejects comma-only suite list", () => {
	assert.throws(() => parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: " , , " }), /empty suite list/);
});

test("HOST_UI_SMOKE_E2E_SUITE_IDS is core plus extended", () => {
	assert.equal(
		HOST_UI_SMOKE_E2E_SUITE_IDS.length,
		HOST_UI_SMOKE_E2E_CORE_SUITE_IDS.length + HOST_UI_SMOKE_E2E_EXTENDED_SUITE_IDS.length
	);
	assert.equal(HOST_UI_SMOKE_E2E_OPTIONAL_SUITE_IDS, HOST_UI_SMOKE_E2E_EXTENDED_SUITE_IDS);
});
