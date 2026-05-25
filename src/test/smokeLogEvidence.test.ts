import test from "node:test";
import assert from "node:assert/strict";
import {
	clearSmokeLogEvidence,
	findMissingLogMarkers,
	formatSmokeLogEvidenceLine,
	recordHostUiSmokeLogLine,
	snapshotHostUiSmokeLogEvidence
} from "../smokeLogBridge/smokeLogEvidence";
import { ProviderLogEvent } from "../visionProtocol/visionLogEvents";

test("formatSmokeLogEvidenceLine matches logger smoke capture shape", () => {
	const line = formatSmokeLogEvidenceLine("request.start", { model: "x" }, (value) => value);
	assert.match(line, /^request\.start \{/);
	recordHostUiSmokeLogLine(line);
	assert.ok(snapshotHostUiSmokeLogEvidence()[0]?.includes(ProviderLogEvent.requestStart));
	clearSmokeLogEvidence();
});

test("findMissingLogMarkers on automation buffer", () => {
	clearSmokeLogEvidence();
	recordHostUiSmokeLogLine("vision.input.bound");
	const { missing } = findMissingLogMarkers(snapshotHostUiSmokeLogEvidence(), ["vision.proxy.cache.hit"]);
	assert.deepEqual(missing, ["vision.proxy.cache.hit"]);
});
