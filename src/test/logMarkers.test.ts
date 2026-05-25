import test from "node:test";
import assert from "node:assert/strict";
import {
	CHAT_INTEGRATION_SCENARIO_EXTRA_MARKERS,
	P7_RESTORE_ARTIFACT_CHAT_MARKERS,
	PLAN_PHASE_REQUIRED_CHAT_LOG_MARKERS,
	VisionLogEvent
} from "../e2e/hostUi/logMarkers";

test("P7 restore artifact markers satisfy p6/p7 phase requirements", () => {
	const joined = P7_RESTORE_ARTIFACT_CHAT_MARKERS.join("\n");
	for (const required of PLAN_PHASE_REQUIRED_CHAT_LOG_MARKERS.p6) {
		assert.ok(joined.includes(required), `p6 marker missing: ${required}`);
	}
	for (const required of PLAN_PHASE_REQUIRED_CHAT_LOG_MARKERS.p7) {
		assert.ok(joined.includes(required), `p7 marker missing: ${required}`);
	}
});

test("scenario extra markers use canonical vision event strings", () => {
	const p7Extra = CHAT_INTEGRATION_SCENARIO_EXTRA_MARKERS["p7-restore-artifact-chat"] ?? [];
	assert.ok(p7Extra.includes(VisionLogEvent.inputBound));
	assert.ok(p7Extra.includes(VisionLogEvent.handoffResolved));
});
