import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSelfReferProxyPolicy, shouldSkipP4WrappedChatScenario } from "../e2e/hostUi/chat/p4Route";
import { assertIntegrationScenarioCoversPlanPhases } from "../e2e/hostUi/chat/planCoverage";
import {
	countHostUiSmokeChatLmRequests,
	countExecutableIntegrationLmRequests,
	countIntegrationLmRequestBudget,
	countIntegrationLmRequests,
	HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL,
	resolveHostUiSmokeChatIntegrationScenarios
} from "../e2e/hostUi/chat/integration";
import type { ExtensionSettings, ModelConfig } from "../types";
import { visionProxyFixture } from "./visionProxyTestFixtures";

const baseSettings: Pick<ExtensionSettings, "visionProxy"> = {
	visionProxy: visionProxyFixture({ defaultModelId: "copilot-vision", selectionMode: "fixed" })
};

const flashModel: ModelConfig = {
	id: "deepseek-v4-flash",
	provider: "deepseek",
	baseUrl: "https://example.com/v1",
	contextLength: 128000,
	maxOutputTokens: 4096,
	vision: false,
	visionProxyModelId: "",
	toolCalling: true,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: []
};

test("evaluateSelfReferProxyPolicy detects self-disabled overlay", () => {
	const evaluated = evaluateSelfReferProxyPolicy(
		{ ...flashModel, visionProxyModelId: "deepseek-v4-flash" },
		baseSettings
	);
	assert.equal(evaluated.ok, true);
	assert.equal(evaluated.policy.reason, "self-disabled");
});

test("p4 chat scenarios satisfy plan phase marker contracts", () => {
	const selfRefer = HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.find((s) => s.id === "p4-self-refer-proxy-chat");
	const wrapped = HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.find((s) => s.id === "p4-wrapped-vision-chat");
	assert.ok(selfRefer && wrapped);
	assert.deepEqual(assertIntegrationScenarioCoversPlanPhases(selfRefer), []);
	assert.deepEqual(assertIntegrationScenarioCoversPlanPhases(wrapped), []);
});

test("p4-wrapped chat skips unless MODEL_KIND=wrapped", () => {
	assert.equal(shouldSkipP4WrappedChatScenario({ COPILOT_BRO_UI_SMOKE_MODEL_KIND: "provider" }).skip, true);
	assert.equal(shouldSkipP4WrappedChatScenario({
		COPILOT_BRO_UI_SMOKE_MODEL_KIND: "wrapped",
		COPILOT_BRO_UI_SMOKE_INCLUDE_WRAPPED_MODELS: "1"
	}).skip, false);
});

test("default integration request count includes p4 scenarios", () => {
	const env = {};
	const integration = resolveHostUiSmokeChatIntegrationScenarios(env);
	const total = countHostUiSmokeChatLmRequests(env, 3);
	assert.equal(total, 3 + countExecutableIntegrationLmRequests(integration, env));
	assert.ok(countIntegrationLmRequestBudget(integration, env) >= countIntegrationLmRequests(integration));
});
