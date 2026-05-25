import test from "node:test";
import assert from "node:assert/strict";
import { buildMinimalStructuredVisionFallback, normalizeStructuredProxyOutput } from "../visionProxyStructuredPlan";

const multiElementPayload = {
	contract: "vision-proxy-contract-v3",
	sceneSummary: "Login dialog with two buttons",
	observations: ["Modal centered"],
	recognizedText: ["Continue"],
	layout: ["header", "footer actions"],
	elements: [
		{
			elementId: "btn-primary",
			label: "Continue button",
			mode: "svg",
			confidence: 0.95,
			rationale: "Teal filled primary CTA",
			regions: [{ label: "Continue", bbox: { x: 10, y: 20, w: 120, h: 40 } }],
			svgParams: { mode: "path-guided", strokeWidth: 0, fillColor: "#1F7A8C", pathHint: "rounded rect" }
		},
		{
			elementId: "btn-secondary",
			label: "Cancel button",
			mode: "svg",
			confidence: 0.9,
			rationale: "Outlined secondary button",
			regions: [{ label: "Cancel", bbox: { x: 140, y: 20, w: 100, h: 40 } }],
			svgParams: { mode: "bbox-overlay", strokeWidth: 1, fillColor: "#FFFFFF", pathHint: "stroke rect" }
		}
	]
};

test("normalizeStructuredProxyOutput accepts v3 multi-element tree", () => {
	const result = normalizeStructuredProxyOutput(multiElementPayload);
	assert.equal(result.ok, true);
	if (!result.ok) {
		return;
	}
	assert.equal(result.value.elements.length, 2);
	assert.equal(result.value.elements[0]?.elementId, "btn-primary");
	assert.equal(result.value.elements[1]?.mode, "svg");
	assert.equal(result.value.contract, "vision-proxy-contract-v3");
});

test("normalizeStructuredProxyOutput upgrades legacy v2 single-object payload", () => {
	const result = normalizeStructuredProxyOutput({
		contract: "vision-proxy-contract-v2",
		mode: "image",
		confidence: 0.8,
		rationale: "One subject",
		sceneSummary: "subject",
		observations: ["obs"],
		recognizedText: [],
		layout: [],
		regions: [{ label: "main", bbox: { x: 0, y: 0, w: 10, h: 10 } }],
		imageParams: { crop: { x: 0, y: 0, w: 10, h: 10 } }
	});
	assert.equal(result.ok, true);
	if (!result.ok) {
		return;
	}
	assert.equal(result.value.elements.length, 1);
	assert.equal(result.value.elements[0]?.mode, "image");
});

test("normalizeStructuredProxyOutput accepts missing contract when elements are valid v3", () => {
	const result = normalizeStructuredProxyOutput({
		contract: "",
		sceneSummary: "Steam",
		observations: [],
		recognizedText: [],
		layout: [],
		elements: multiElementPayload.elements
	});
	assert.equal(result.ok, true);
	if (!result.ok) {
		return;
	}
	assert.equal(result.value.contract, "vision-proxy-contract-v3");
});

test("normalizeStructuredProxyOutput rejects empty elements array", () => {
	const result = normalizeStructuredProxyOutput({
		contract: "vision-proxy-contract-v3",
		sceneSummary: "empty",
		elements: []
	});
	assert.equal(result.ok, false);
});

test("buildMinimalStructuredVisionFallback produces valid v3 plan for solid-color images", () => {
	const plan = buildMinimalStructuredVisionFallback();
	const result = normalizeStructuredProxyOutput(plan);
	assert.equal(result.ok, true);
	if (!result.ok) {
		return;
	}
	assert.equal(result.value.elements.length, 1);
	assert.equal(result.value.elements[0]?.mode, "none");
});
