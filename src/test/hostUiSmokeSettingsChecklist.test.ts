import test from "node:test";
import assert from "node:assert/strict";
import { getVisiblePhase1Sections } from "../ui/phase1ConfigUi";
import {
	buildPhase1SettingsChecklist,
	getPhase1FieldLogMarkers,
	WORKSPACE_SETTINGS_CHECKLIST
} from "../e2e/hostUi/settingsChecklist";
import { HostUiSmokeLogEvent } from "../visionProtocol/hostUiSmokeLogEvents";
import { ProviderLogEvent, VisionLogEvent } from "../visionProtocol/visionLogEvents";

test("phase1 checklist fields with logMarkers use canonical event constants", () => {
	for (const item of buildPhase1SettingsChecklist()) {
		for (const marker of item.logMarkers ?? []) {
			assert.ok(marker.length > 0, `${item.section}.${item.field}`);
		}
	}
	assert.deepEqual(getPhase1FieldLogMarkers("requestAttribution", "enabled"), [ProviderLogEvent.requestStart]);
	assert.deepEqual(getPhase1FieldLogMarkers("visionProcessing", "chatDebugVisibility"), [
		HostUiSmokeLogEvent.visionProgressFlush
	]);
});

test("workspace settings checklist markers align with vision/provider events", () => {
	for (const item of WORKSPACE_SETTINGS_CHECKLIST) {
		for (const marker of item.logMarkers ?? []) {
			const known =
				Object.values(VisionLogEvent).includes(marker as (typeof VisionLogEvent)[keyof typeof VisionLogEvent])
				|| Object.values(ProviderLogEvent).includes(marker as (typeof ProviderLogEvent)[keyof typeof ProviderLogEvent])
				|| marker === "vision.proxy.format.invalid";
			assert.ok(known, `unknown marker ${marker} on ${item.section}.${item.field}`);
		}
	}
});

test("every visible phase1 section appears in generated checklist", () => {
	const checklistSections = new Set(buildPhase1SettingsChecklist().map((item) => item.section));
	for (const section of getVisiblePhase1Sections()) {
		assert.ok(checklistSections.has(section.key), `missing checklist for ${section.key}`);
	}
});
