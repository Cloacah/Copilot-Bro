import test from "node:test";
import assert from "node:assert/strict";
import {
	assertIntegrationScenarioCoversPlanPhases,
	CHAT_INTEGRATION_SCENARIO_PLAN_PHASES,
	listIntegrationScenarioIdsForPlanPhase,
	type HostUiSmokeChatPlanPhase
} from "../e2e/hostUi/chat/planCoverage";
import { HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL } from "../e2e/hostUi/chat/integration";

const PLAN_PHASES: HostUiSmokeChatPlanPhase[] = ["p3", "p4", "p5", "p6", "p7"];

test("every integration scenario maps to at least one plan phase p3-p7", () => {
	for (const scenario of HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL) {
		const phases = CHAT_INTEGRATION_SCENARIO_PLAN_PHASES[scenario.id];
		assert.ok(phases && phases.length > 0, `scenario ${scenario.id} must map to plan phases`);
	}
});

test("integration scenarios declare log markers required by their plan phases", () => {
	for (const scenario of HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL) {
		const issues = assertIntegrationScenarioCoversPlanPhases(scenario);
		assert.deepEqual(issues, [], issues.join("; "));
	}
});

test("plan phases p3-p7 each have at least one chat integration scenario", () => {
	for (const phase of PLAN_PHASES) {
		const ids = listIntegrationScenarioIdsForPlanPhase(phase);
		assert.ok(ids.length > 0, `no chat integration scenario for ${phase}`);
	}
});
