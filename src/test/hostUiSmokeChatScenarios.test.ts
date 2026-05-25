import test from "node:test";
import assert from "node:assert/strict";
import {
	buildHostUiSmokeSuiteChatQuery,
	normalizeHostUiSmokeScenarioResponse,
	parseHostUiSmokeChatScenarioIds,
	resolveHostUiSmokeChatScenarios,
	shouldRunHostUiSmokeChatSuite,
	HOST_UI_SMOKE_RUN_SUITE_MARKER
} from "../e2e/hostUi/chat/scenarios";

test("default chat smoke scenario ids are stable baseline triple", () => {
	assert.deepEqual(parseHostUiSmokeChatScenarioIds({}), ["baseline", "unicode-prompt", "markdown-wrap"]);
});

test("parseHostUiSmokeChatScenarioIds trims and splits", () => {
	assert.deepEqual(
		parseHostUiSmokeChatScenarioIds({ COPILOT_BRO_UI_SMOKE_CHAT_SCENARIOS: " baseline , unicode-prompt " }),
		["baseline", "unicode-prompt"]
	);
});

test("resolveHostUiSmokeChatScenarios rejects unknown ids", () => {
	assert.throws(
		() => resolveHostUiSmokeChatScenarios({ COPILOT_BRO_UI_SMOKE_CHAT_SCENARIOS: "baseline,not-a-real-scenario" }),
		/not-a-real-scenario/
	);
});

test("suite marker detection is exact substring", () => {
	assert.equal(shouldRunHostUiSmokeChatSuite(`@bro-smoke ${HOST_UI_SMOKE_RUN_SUITE_MARKER}`), true);
	assert.equal(shouldRunHostUiSmokeChatSuite("plain user prompt"), false);
});

test("buildHostUiSmokeSuiteChatQuery includes run and integration markers by default", () => {
	assert.match(buildHostUiSmokeSuiteChatQuery({}), /host-ui-smoke-run-suite/);
	assert.match(buildHostUiSmokeSuiteChatQuery({}), /host-ui-smoke-integration-suite/);
});

test("markdown-wrap scenario accepts fenced model output", () => {
	const raw = "```  \nBRO_SMOKE_OK_20260506  \n```";
	const inlineOpen = "``` BRO_SMOKE_OK_20260506\n```";
	assert.equal(normalizeHostUiSmokeScenarioResponse(raw, "markdown-wrap"), "BRO_SMOKE_OK_20260506");
	assert.equal(normalizeHostUiSmokeScenarioResponse(inlineOpen, "markdown-wrap"), "BRO_SMOKE_OK_20260506");
	assert.equal(normalizeHostUiSmokeScenarioResponse("BRO_SMOKE_OK_20260506", "markdown-wrap"), "BRO_SMOKE_OK_20260506");
	assert.equal(normalizeHostUiSmokeScenarioResponse(raw, "baseline"), raw.trim());
});

test("whitespace-padding and empty-lines scenarios resolve and normalize like baseline", () => {
	const env = { COPILOT_BRO_UI_SMOKE_CHAT_SCENARIOS: "whitespace-padding,empty-lines" };
	const scenarios = resolveHostUiSmokeChatScenarios(env);
	assert.equal(scenarios.length, 2);
	assert.equal(scenarios[0].id, "whitespace-padding");
	assert.equal(scenarios[1].id, "empty-lines");
	const token = "BRO_SMOKE_OK_20260506";
	assert.equal(normalizeHostUiSmokeScenarioResponse(`  \n${token}\t`, "whitespace-padding"), token);
	assert.equal(normalizeHostUiSmokeScenarioResponse(`\n\n${token}\n`, "empty-lines"), token);
});
