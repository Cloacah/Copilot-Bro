import test from "node:test";
import assert from "node:assert/strict";
import {
	HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS,
	HOST_UI_SMOKE_CHAT_ACCEPTANCE_GROUPS,
	listAllChatAcceptanceScenarioIds
} from "../e2e/hostUi/chat/acceptance";
import { HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL, parseHostUiSmokeChatIntegrationScenarioIds } from "../e2e/hostUi/chat/integration";
import { assertIntegrationScenarioCoversPlanPhases } from "../e2e/hostUi/chat/planCoverage";

test("default acceptance ids resolve to canonical integration scenarios", () => {
	const byId = new Set(HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.map((scenario) => scenario.id));
	for (const id of HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS) {
		assert.ok(byId.has(id), `missing canonical scenario ${id}`);
	}
	const resolved = parseHostUiSmokeChatIntegrationScenarioIds({});
	assert.equal(resolved.length, HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS.length);
});

test("acceptance groups only reference known scenario ids", () => {
	const known = new Set(listAllChatAcceptanceScenarioIds());
	for (const [group, ids] of Object.entries(HOST_UI_SMOKE_CHAT_ACCEPTANCE_GROUPS)) {
		for (const id of ids) {
			assert.ok(known.has(id), `${group} references unknown id ${id}`);
		}
	}
});

test("every default acceptance scenario satisfies plan phase markers", () => {
	const byId = new Map(HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.map((scenario) => [scenario.id, scenario]));
	for (const id of HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS) {
		const scenario = byId.get(id);
		assert.ok(scenario, id);
		const issues = assertIntegrationScenarioCoversPlanPhases(scenario!);
		assert.deepEqual(issues, [], issues.join("; "));
	}
});
