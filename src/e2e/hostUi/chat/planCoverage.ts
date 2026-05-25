/**
 * Maps Host UI Chat integration scenario ids to plan phases (p3–p7) for audit and tests.
 * Each scenario's {@link HostUiSmokeChatIntegrationScenario.requiredLogMarkers} must satisfy its phases.
 */
import type { HostUiSmokeChatIntegrationScenario } from "./integration";
import {
	CHAT_INTEGRATION_SCENARIO_EXTRA_MARKERS,
	PLAN_PHASE_REQUIRED_CHAT_LOG_MARKERS,
	type HostUiSmokeChatPlanPhase
} from "../logMarkers";

export type { HostUiSmokeChatPlanPhase };
export { CHAT_INTEGRATION_SCENARIO_EXTRA_MARKERS, PLAN_PHASE_REQUIRED_CHAT_LOG_MARKERS };

export const CHAT_INTEGRATION_SCENARIO_PLAN_PHASES: Readonly<Record<string, readonly HostUiSmokeChatPlanPhase[]>> = {
	"p3-global-qwen-proxy-chat": ["p3"],
	"vision-proxy-miss": ["p3", "p6"],
	"vision-proxy-cache-hit": ["p3"],
	"model-switch-pro-token": ["p5"],
	"prompt-preset-applied": ["p5"],
	"multi-turn-vision-then-token": ["p3", "p6"],
	"p5-qwen-vl-native-chat": ["p5"],
	"p7-describe-only-evidence": ["p6", "p7"],
	"p6-path-hydration-chat": ["p3", "p6"],
	"p7-restore-artifact-chat": ["p6", "p7"],
	"p7-chat-benchmark-web-restore": ["p6", "p7"],
	"p4-self-refer-proxy-chat": ["p4"],
	"p4-wrapped-vision-chat": ["p4"],
	"provider-token-smoke-chat": ["p5"],
	"native-vision-zhipu-chat": ["p5"],
	"multi-provider-switch-context": ["p3", "p5"],
	"tool-call-model-chat": ["p5"]
} as const;

export function getPlanPhasesForIntegrationScenario(scenarioId: string): readonly HostUiSmokeChatPlanPhase[] {
	return CHAT_INTEGRATION_SCENARIO_PLAN_PHASES[scenarioId] ?? [];
}

export function assertIntegrationScenarioCoversPlanPhases(scenario: HostUiSmokeChatIntegrationScenario): string[] {
	const issues: string[] = [];
	const phases = getPlanPhasesForIntegrationScenario(scenario.id);
	const markers = scenario.requiredLogMarkers.join("\n");
	for (const phase of phases) {
		for (const required of PLAN_PHASE_REQUIRED_CHAT_LOG_MARKERS[phase]) {
			if (!markers.includes(required)) {
				issues.push(`${scenario.id} missing marker for ${phase}: ${required}`);
			}
		}
	}
	for (const required of CHAT_INTEGRATION_SCENARIO_EXTRA_MARKERS[scenario.id] ?? []) {
		if (!markers.includes(required)) {
			issues.push(`${scenario.id} missing scenario marker: ${required}`);
		}
	}
	return issues;
}

export function listIntegrationScenarioIdsForPlanPhase(phase: HostUiSmokeChatPlanPhase): string[] {
	return Object.entries(CHAT_INTEGRATION_SCENARIO_PLAN_PHASES)
		.filter(([, phases]) => phases.includes(phase))
		.map(([id]) => id);
}
