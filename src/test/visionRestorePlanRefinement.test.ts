import test from "node:test";
import assert from "node:assert/strict";
import type { ProxyStructuredOutput } from "../visionProxyStructuredPlan";
import { refineVisionRestorePlan } from "../toolCooperation/visionRestorePlanRefinement";

test("refineVisionRestorePlan drops full-viewport single element", () => {
	const plan: ProxyStructuredOutput = {
		contract: "vision-proxy-contract-v3",
		sceneSummary: "test",
		observations: [],
		recognizedText: [],
		layout: [],
		elements: [
			{
				elementId: "full",
				label: "screen",
				mode: "image",
				confidence: 1,
				rationale: "all",
				observations: [],
				recognizedText: [],
				layout: [],
				regions: [{ label: "all", bbox: { x: 0, y: 0, w: 1024, h: 640 }, confidence: 1, priority: 1, rationale: "x" }],
				imageParams: { crop: { x: 0, y: 0, w: 1024, h: 640 } }
			}
		]
	};
	const refined = refineVisionRestorePlan(plan, 1024, 640);
	assert.equal(refined.plan.elements.length, 0);
	assert.ok(refined.adjustments.some((a) => a.includes("dropped-full-viewport")));
	assert.ok(refined.adjustments.some((a) => a.includes("few-elements-after-refine")));
});

test("refineVisionRestorePlan coerces oversized svg region to image", () => {
	const plan: ProxyStructuredOutput = {
		contract: "vision-proxy-contract-v3",
		sceneSummary: "test",
		observations: [],
		recognizedText: [],
		layout: [],
		elements: [
			{
				elementId: "panel-a",
				label: "editor",
				mode: "svg",
				confidence: 1,
				rationale: "main",
				observations: [],
				recognizedText: [],
				layout: [],
				regions: [{ label: "editor", bbox: { x: 0, y: 0, w: 900, h: 600 }, confidence: 1, priority: 1, rationale: "x" }],
				imageParams: { crop: { x: 0, y: 0, w: 900, h: 600 } }
			},
			{
				elementId: "icon-b",
				label: "toolbar icon",
				mode: "image",
				confidence: 1,
				rationale: "small icon glyph",
				observations: [],
				recognizedText: [],
				layout: [],
				regions: [{ label: "icon", bbox: { x: 10, y: 10, w: 24, h: 24 }, confidence: 1, priority: 1, rationale: "x" }],
				imageParams: { crop: { x: 10, y: 10, w: 24, h: 24 } }
			}
		]
	};
	const refined = refineVisionRestorePlan(plan, 1024, 640);
	assert.equal(refined.plan.elements.find((e) => e.elementId === "panel-a")?.mode, "image");
	assert.ok(refined.adjustments.some((a) => a.includes("coerced-svg-to-image:panel-a")));
});

test("refineVisionRestorePlan strips high raster threshold hints from LLM plans", () => {
	const plan: ProxyStructuredOutput = {
		contract: "vision-proxy-contract-v3",
		sceneSummary: "test",
		observations: [],
		recognizedText: [],
		layout: [],
		elements: [
			{
				elementId: "a",
				label: "a",
				mode: "image",
				confidence: 1,
				rationale: "x",
				observations: [],
				recognizedText: [],
				layout: [],
				regions: [{ label: "a", bbox: { x: 0, y: 0, w: 100, h: 100 }, confidence: 1, priority: 1, rationale: "x" }],
				imageParams: { crop: { x: 0, y: 0, w: 100, h: 100 }, threshold: 255 }
			},
			{
				elementId: "b",
				label: "b",
				mode: "image",
				confidence: 1,
				rationale: "x",
				observations: [],
				recognizedText: [],
				layout: [],
				regions: [{ label: "b", bbox: { x: 200, y: 0, w: 100, h: 100 }, confidence: 1, priority: 1, rationale: "x" }],
				imageParams: { crop: { x: 200, y: 0, w: 100, h: 100 }, threshold: 50 }
			}
		]
	};
	const refined = refineVisionRestorePlan(plan, 1024, 640);
	const a = refined.plan.elements.find((e) => e.elementId === "a");
	const b = refined.plan.elements.find((e) => e.elementId === "b");
	assert.equal(a?.imageParams?.threshold, undefined);
	assert.equal(b?.imageParams?.threshold, 50);
	assert.ok(refined.adjustments.some((adj) => adj.startsWith("stripped-high-raster-threshold:a")));
});
