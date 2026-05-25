import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
	countHostUiSmokeChatLmRequests,
	countExecutableIntegrationLmRequests,
	countIntegrationLmRequestBudget,
	countIntegrationLmRequests,
	HOST_UI_SMOKE_INTEGRATION_SUITE_MARKER,
	HOST_UI_SMOKE_ALT_MIN_PNG,
	HOST_UI_SMOKE_MIN_PNG,
	HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL,
	parseHostUiSmokeChatIntegrationScenarioIds,
	resolveHostUiSmokeChatIntegrationScenarios,
	shouldRunHostUiSmokeChatIntegration,
	shouldRunHostUiSmokeChatIntegrationSuite
} from "../e2e/hostUi/chat/integration";
import {
	clearHostUiSmokeLogEvidence,
	findMissingLogMarkers,
	recordHostUiSmokeLogLine
} from "../e2e/hostUi/logEvidence";
import { validateHostUiSmokeChatIntegrationEvidence } from "../e2e/driver/hostUiSmokeAssertions";
import { buildHostUiSmokeSuiteChatQuery } from "../e2e/hostUi/chat/scenarios";
import { CHAT_INTEGRATION_SCENARIO_PLAN_PHASES } from "../e2e/hostUi/chat/planCoverage";
import {
	HOST_UI_MODEL_PROFILE_REGISTRY,
	validateHostUiIntegrationModelProfiles
} from "../e2e/hostUi/chat/hostUiModelProfiles";

test("HOST_UI_SMOKE_MIN_PNG meets provider minimum dimensions (>10px)", () => {
	for (const bytes of [HOST_UI_SMOKE_MIN_PNG, HOST_UI_SMOKE_ALT_MIN_PNG]) {
		const png = Buffer.from(bytes);
		const width = png.readUInt32BE(16);
		const height = png.readUInt32BE(20);
		assert.ok(width > 10, `width=${width}`);
		assert.ok(height > 10, `height=${height}`);
	}
});

test("integration suite marker and default env", () => {
	assert.equal(shouldRunHostUiSmokeChatIntegration({}), true);
	assert.equal(shouldRunHostUiSmokeChatIntegration({ COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION: "0" }), false);
	assert.match(buildHostUiSmokeSuiteChatQuery({}), /integration-suite/);
	assert.equal(buildHostUiSmokeSuiteChatQuery({ COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION: "0" }).includes(HOST_UI_SMOKE_INTEGRATION_SUITE_MARKER), false);
});

test("mock mode trims integration scenarios to model-switch only", () => {
	const ids = parseHostUiSmokeChatIntegrationScenarioIds({ COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_MOCK: "1" });
	assert.deepEqual(ids, ["model-switch-pro-token"]);
});

test("countHostUiSmokeChatLmRequests uses executable integration turns", () => {
	const env = {};
	const tokenCount = 3;
	const integration = resolveHostUiSmokeChatIntegrationScenarios(env);
	const nominal = countIntegrationLmRequests(integration);
	const executable = countExecutableIntegrationLmRequests(integration, env);
	const budget = countIntegrationLmRequestBudget(integration, env);
	assert.ok(budget >= nominal);
	assert.equal(countHostUiSmokeChatLmRequests(env, tokenCount), tokenCount + executable);
	assert.ok(executable <= nominal);
});

test("p3-p7 plan phases are assigned on integration scenarios", () => {
	assert.ok(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES["p3-global-qwen-proxy-chat"]?.includes("p3"));
	assert.ok(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES["vision-proxy-miss"]?.includes("p3"));
	assert.ok(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES["p5-qwen-vl-native-chat"]?.includes("p5"));
	assert.ok(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES["p7-describe-only-evidence"]?.includes("p7"));
	assert.ok(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES["p6-path-hydration-chat"]?.includes("p6"));
	assert.ok(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES["p7-restore-artifact-chat"]?.includes("p7"));
	assert.ok(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES["p7-chat-benchmark-web-restore"]?.includes("p7"));
	assert.ok(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES["p4-self-refer-proxy-chat"]?.includes("p4"));
	assert.ok(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES["multi-provider-switch-context"]?.includes("p5"));
	assert.ok(HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.some((s) => s.id === "provider-token-smoke-chat"));
	const p5 = HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.find((s) => s.id === "p5-qwen-vl-native-chat");
	assert.equal(p5?.kind, "native-vision");
	assert.ok(HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.some((s) => s.id === "prompt-preset-applied"));
	assert.deepEqual(validateHostUiIntegrationModelProfiles(HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL), []);
	const nativeZhipu = HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.find((s) => s.id === "native-vision-zhipu-chat");
	assert.equal(nativeZhipu?.modelProfile, "zhipu.vision-native");
	assert.deepEqual(
		nativeZhipu?.modelProfile && HOST_UI_MODEL_PROFILE_REGISTRY[nativeZhipu.modelProfile],
		HOST_UI_MODEL_PROFILE_REGISTRY["zhipu.vision-native"]
	);
});

test("log evidence markers detect vision proxy path", () => {
	clearHostUiSmokeLogEvidence();
	recordHostUiSmokeLogLine("vision.input.bound");
	recordHostUiSmokeLogLine("vision.proxy.cache.miss");
	recordHostUiSmokeLogLine('request.messages.summary {"hasImageParts":false}');
	const lines = ["vision.input.bound", "vision.proxy.cache.miss", 'request.messages.summary {"hasImageParts":false}'];
	const { missing, forbiddenHit } = findMissingLogMarkers(
		lines,
		["vision.input.bound", "vision.proxy.cache.miss", "request.messages.summary", '"hasImageParts":false'],
		["vision.proxy.cache.hit"]
	);
	assert.deepEqual(missing, []);
	assert.deepEqual(forbiddenHit, []);
});

test("validateHostUiSmokeChatIntegrationEvidence accepts ok and skipped vision", () => {
	const log = [
		'host-ui-smoke.chat.integration.suite.summary {"ok":true}',
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"vision-proxy-miss","ok":true,"skipped":true}',
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"model-switch-pro-token","ok":true}',
		"[INFO] vision.input.bound {}"
	].join("\n");
	assert.deepEqual(
		validateHostUiSmokeChatIntegrationEvidence(log, ["vision-proxy-miss", "model-switch-pro-token"]),
		[]
	);
});

test("validateHostUiSmokeChatIntegrationEvidence flags scenario ok:false without skip", () => {
	const log = [
		'host-ui-smoke.chat.integration.suite.summary {"ok":false}',
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"p7-chat-benchmark-web-restore","ok":false,"reason":"benchmark-page-ssim"}',
		"[INFO] vision.input.bound {}"
	].join("\n");
	const issues = validateHostUiSmokeChatIntegrationEvidence(log, ["p7-chat-benchmark-web-restore"]);
	assert.ok(issues.some((entry) => entry.includes("failed:p7-chat-benchmark-web-restore")));
});
