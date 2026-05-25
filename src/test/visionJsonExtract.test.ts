import test from "node:test";
import assert from "node:assert/strict";
import {
	extractJsonObjectFromVisionText,
	repairCommonJsonDefects,
	repairUnbalancedJsonBrackets
} from "../visionProtocol/visionJsonExtract";
import { runVisionJsonRepairProbe, VISION_JSON_REPAIR_PROBE_SAMPLES } from "../visionProtocol/visionJsonRepairProbe";

function buildProbeContractJson(options?: { trailingComma?: boolean; unclosed?: boolean }): string {
	const sample = VISION_JSON_REPAIR_PROBE_SAMPLES.find((entry) =>
		options?.unclosed ? entry.id === "unclosed-brace" : options?.trailingComma ? entry.id === "trailing-comma" : false
	);
	if (!sample) {
		throw new Error("probe fixture missing");
	}
	return sample.raw;
}

test("extractJsonObjectFromVisionText repairs trailing commas", () => {
	const raw = '{"contract":"vision-proxy-contract-v3","elements":[{"elementId":"a","label":"x",}],}';
	const extracted = extractJsonObjectFromVisionText(raw);
	assert.ok(extracted);
	assert.equal(extracted.repaired, true);
	assert.equal((extracted.value as { contract?: string }).contract, "vision-proxy-contract-v3");
});

test("repairCommonJsonDefects strips trailing comma before closing brace", () => {
	const repaired = repairCommonJsonDefects('{"a":1,}');
	assert.equal(JSON.parse(repaired).a, 1);
});

test("extractJsonObjectFromVisionText accepts prose around a valid contract object", () => {
	const inner = '{"contract":"vision-proxy-contract-v3","sceneSummary":"x","elements":[{"elementId":"a","label":"b","mode":"none","confidence":0.9,"rationale":"r","regions":[{"label":"r","bbox":{"x":0,"y":0,"w":1,"h":1},"confidence":0.9,"priority":1,"rationale":"r"}]}]}';
	const raw = `Here is the structured vision JSON:\n${inner}\nThanks.`;
	const extracted = extractJsonObjectFromVisionText(raw);
	assert.ok(extracted);
	assert.equal((extracted.value as { contract?: string }).contract, "vision-proxy-contract-v3");
});

test("repairUnbalancedJsonBrackets closes a truncated outer object", () => {
	const truncated = buildProbeContractJson({ unclosed: true });
	const repaired = repairUnbalancedJsonBrackets(truncated);
	const parsed = JSON.parse(repairCommonJsonDefects(repaired));
	assert.equal(parsed.contract, "vision-proxy-contract-v3");
});

test("runVisionJsonRepairProbe passes all fixture samples", () => {
	const probe = runVisionJsonRepairProbe();
	assert.equal(probe.ok, true, probe.results.map((r) => `${r.id}:${r.error ?? "ok"}`).join("; "));
});
