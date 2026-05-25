import test from "node:test";
import assert from "node:assert/strict";
import { buildRestoreSeedSvg, resolveHintedSvgFromElement } from "../visionRestoreSeed";
import type { ProxyVisualElement } from "../visionProxyStructuredPlan";

function baseElement(overrides: Partial<ProxyVisualElement> = {}): ProxyVisualElement {
	return {
		elementId: "btn-1",
		label: "button",
		mode: "svg",
		confidence: 0.9,
		rationale: "primary action",
		observations: [],
		recognizedText: [],
		layout: [],
		regions: [{
			label: "button",
			confidence: 0.9,
			priority: 1,
			bbox: { x: 0, y: 0, w: 48, h: 24 },
			rationale: "full control"
		}],
		...overrides
	};
}

test("buildRestoreSeedSvg uses pathHint when provided as SVG document", () => {
	const svg = buildRestoreSeedSvg(
		baseElement({
			svgParams: {
				mode: "path-guided",
				pathHint: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
			}
		}),
		{ x: 0, y: 0, w: 10, h: 10 }
	);
	assert.match(svg, /<circle/u);
});

test("resolveHintedSvgFromElement returns undefined without path hint (no bbox seed)", () => {
	const svg = resolveHintedSvgFromElement(
		baseElement({ svgParams: { mode: "bbox-overlay", fillColor: "#FF0000" } }),
		{ x: 0, y: 0, w: 48, h: 24 }
	);
	assert.equal(svg, undefined);
});

test("buildRestoreSeedSvg wraps bare path data in viewBox svg", () => {
	const svg = buildRestoreSeedSvg(
		baseElement({
			svgParams: {
				mode: "path-guided",
				fillColor: "#FF0000",
				pathHint: "M0 0h48v24H0z"
			}
		}),
		{ x: 0, y: 0, w: 48, h: 24 }
	);
	assert.match(svg, /viewBox="0 0 48 24"/u);
	assert.match(svg, /fill="#FF0000"/u);
	assert.match(svg, /M0 0h48v24H0z/u);
});
