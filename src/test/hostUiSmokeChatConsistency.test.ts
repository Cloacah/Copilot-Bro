import test from "node:test";
import assert from "node:assert/strict";
import { validateHostUiSmokeChatIntegrationConsistency } from "../e2e/hostUi/chat/consistency";

test("validateHostUiSmokeChatIntegrationConsistency passes minimal suite log", () => {
	const log = [
		'host-ui-smoke.chat.integration.scenario.start {"scenarioId":"vision-proxy-miss"}',
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"vision-proxy-miss","ok":true}',
		'host-ui-smoke.chat.integration.scenario.start {"scenarioId":"vision-proxy-cache-hit"}',
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"vision-proxy-cache-hit","ok":true}',
		"vision.proxy.cache.hit"
	].join("\n");
	const report = validateHostUiSmokeChatIntegrationConsistency(log, ["vision-proxy-miss", "vision-proxy-cache-hit"]);
	assert.equal(report.ok, true);
});

test("validateHostUiSmokeChatIntegrationConsistency checks multi-turn vision then token", () => {
	const log = [
		'host-ui-smoke.chat.output {"kind":"integration-turn","ok":true}',
		'host-ui-smoke.chat.output {"kind":"integration-turn","ok":true}',
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"multi-turn-vision-then-token","ok":true,"turnCount":2}'
	].join("\n");
	const report = validateHostUiSmokeChatIntegrationConsistency(log, ["multi-turn-vision-then-token"]);
	assert.equal(report.ok, true);
});

test("validateHostUiSmokeChatIntegrationConsistency requires structured params when pipeline suspended", () => {
	const log = [
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"p3-global-qwen-proxy-chat","ok":true}',
		'vision.proxy.structured {"elementCount":2,"contract":"vision-proxy-contract-v3"}'
	].join("\n");
	const report = validateHostUiSmokeChatIntegrationConsistency(log, ["p3-global-qwen-proxy-chat"]);
	assert.equal(report.ok, true);
});

test("validateHostUiSmokeChatIntegrationConsistency orders cache hit after miss by scenarioId", () => {
	const log = [
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"vision-proxy-miss","ok":true}',
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"vision-proxy-cache-hit","ok":true}',
		"vision.proxy.cache.hit"
	].join("\n");
	const report = validateHostUiSmokeChatIntegrationConsistency(log, ["vision-proxy-miss", "vision-proxy-cache-hit"]);
	assert.equal(report.ok, true);
});

test("validateHostUiSmokeChatIntegrationConsistency ignores decoy scenarioId substring outside integration lines", () => {
	const log = [
		'debug note: "scenarioId":"vision-proxy-cache-hit" mentioned in prose before suite',
		'host-ui-smoke.chat.integration.scenario.start {"scenarioId":"vision-proxy-miss"}',
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"vision-proxy-miss","ok":true}',
		'host-ui-smoke.chat.integration.scenario.start {"scenarioId":"vision-proxy-cache-hit"}',
		'host-ui-smoke.chat.integration.scenario.end {"scenarioId":"vision-proxy-cache-hit","ok":true}',
		"vision.proxy.cache.hit"
	].join("\n");
	const report = validateHostUiSmokeChatIntegrationConsistency(log, ["vision-proxy-miss", "vision-proxy-cache-hit"]);
	assert.equal(report.ok, true, JSON.stringify(report.checks));
});

test("validateHostUiSmokeChatIntegrationConsistency flags missing scenario end", () => {
	const log = [
		'host-ui-smoke.chat.consistency.end {"ok":false}',
		'host-ui-smoke.chat.integration.suite.summary {"ok":false}'
	].join("\n");
	const report = validateHostUiSmokeChatIntegrationConsistency(log, ["vision-proxy-miss"]);
	assert.equal(report.ok, false);
	assert.ok(report.checks.some((check) => check.id === "scenario-end:vision-proxy-miss" && !check.ok));
});
