import test from "node:test";
import assert from "node:assert/strict";
import {
	clearHostUiSmokeLogEvidence,
	findMissingLogMarkers,
	recordHostUiSmokeLogLine,
	snapshotHostUiSmokeLogEvidence
} from "../e2e/hostUi/logEvidence";

test("record and snapshot smoke log evidence", () => {
	clearHostUiSmokeLogEvidence();
	recordHostUiSmokeLogLine("request.start");
	recordHostUiSmokeLogLine("request.end");
	assert.equal(snapshotHostUiSmokeLogEvidence().length, 2);
	clearHostUiSmokeLogEvidence();
	assert.equal(snapshotHostUiSmokeLogEvidence().length, 0);
});

test("findMissingLogMarkers reports missing and forbidden", () => {
	const { missing, forbiddenHit } = findMissingLogMarkers(
		["vision.input.bound"],
		["vision.input.bound", "vision.proxy.cache.hit"],
		["vision.input.bound"]
	);
	assert.deepEqual(missing, ["vision.proxy.cache.hit"]);
	assert.deepEqual(forbiddenHit, ["vision.input.bound"]);
});
