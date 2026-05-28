import test from "node:test";
import assert from "node:assert/strict";
import {
	extractJsonObjectFromVisionText,
	repairSplitDecimalLiterals
} from "../visionProtocol/visionJsonExtract";
import { canonicalizeVisionJsonKey } from "../visionProtocol/visionJsonCanonicalize";
import { normalizeStructuredProxyOutput } from "../visionProxyStructuredPlan";

test("canonicalizeVisionJsonKey maps split GLM-style keys", () => {
	assert.equal(canonicalizeVisionJsonKey("element Id"), "elementId");
	assert.equal(canonicalizeVisionJsonKey("scene Summary"), "sceneSummary");
	assert.equal(canonicalizeVisionJsonKey("recognized Text"), "recognizedText");
});

test("repairSplitDecimalLiterals joins split decimals", () => {
	const repaired = repairSplitDecimalLiterals('"confidence": 0 . 91');
	assert.ok(JSON.parse(`{${repaired}}`).confidence === 0.91);
});

test("extractJsonObjectFromVisionText normalizes split keys and decimals from near-JSON", () => {
	const raw = [
		"{",
		'"contract": "vision-proxy-contract-v3",',
		'"scene Summary": "A row of trees",',
		'"elements": [{',
		'"element Id": "tree-1",',
		'"label": "cypress",',
		'"mode": "image",',
		'"confidence": 0 . 95,',
		'"rationale": "Leftmost tree",',
		'"observations": [],',
		'"recognized Text": [],',
		'"layout": [],',
		'"regions": [{',
		'"label": "tree-1",',
		'"bbox": { "x": 125, "y": 180, "w": 30, "h": 280 },',
		'"confidence": 0 . 9,',
		'"priority": 1,',
		'"rationale": "region"',
		"}]",
		"}]",
		"}"
	].join("\n");
	const extracted = extractJsonObjectFromVisionText(raw);
	assert.ok(extracted);
	const normalized = normalizeStructuredProxyOutput(extracted.value);
	assert.equal(normalized.ok, true, normalized.ok ? undefined : normalized.error);
	if (normalized.ok) {
		assert.equal(normalized.value.elements.length, 1);
		assert.equal(normalized.value.elements[0]!.elementId, "tree-1");
	}
});

test("extractJsonObjectFromVisionText handles token-per-line GLM keys and split mode enum", () => {
	const raw = [
		"I need to output JSON.",
		"{",
		'  "contract": "vision-proxy-contract-v3",',
		'  "elements": [{',
		'    "element Id": "a",',
		'    "mode": "i mage",',
		'    "label": "x",',
		'    "confidence": 0 . 9,',
		'    "rationale": "solid tree",',
		'    "observations": [], "recognizedText": [], "layout": [],',
		'    "regions": [{ "label": "r", "bbox": { "x": 0, "y": 0, "w": 1, "h": 1 },',
		'      "confidence": 0.9, "priority": 1, "rationale": "r" }]',
		"  }]",
		"}"
	].join("\n");
	const extracted = extractJsonObjectFromVisionText(raw);
	assert.ok(extracted);
	const normalized = normalizeStructuredProxyOutput(extracted.value);
	assert.equal(normalized.ok, true, normalized.ok ? undefined : normalized.error);
});
