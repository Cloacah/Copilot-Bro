import test from "node:test";
import assert from "node:assert/strict";
import {
	buildStructuredProxyProgressFromDescription,
	parseStructuredPlanFromProxyDescription
} from "../visionProxyStructuredSnapshot";
import { STRUCTURED_PROXY_CONTRACT_VERSION } from "../visionProxyStructuredPlan";

const SAMPLE_DESCRIPTION = [
	"proxyRecord=persisted",
	"normalizedProxySnapshot:",
	JSON.stringify({
		contract: STRUCTURED_PROXY_CONTRACT_VERSION,
		sceneSummary: "Sign-in button",
		observations: ["teal button"],
		recognizedText: ["Sign In"],
		layout: ["centered"],
		elements: [
			{
				elementId: "btn-1",
				label: "sign-in",
				mode: "svg",
				confidence: 0.95,
				rationale: "rounded control",
				regionCount: 1,
				regions: [{ label: "body", bbox: { x: 10, y: 20, w: 100, h: 40 }, priority: 1 }],
				imageParams: { crop: { x: 10, y: 20, w: 100, h: 40 } },
				svgParams: { mode: "path-guided", fillColor: "#00A4EF", strokeWidth: 2 }
			}
		]
	}, null, 2)
].join("\n");

test("parseStructuredPlanFromProxyDescription recovers plan from proxy description", () => {
	const plan = parseStructuredPlanFromProxyDescription(SAMPLE_DESCRIPTION);
	assert.ok(plan);
	assert.equal(plan?.elements.length, 1);
	assert.equal(plan?.elements[0]?.svgParams?.fillColor, "#00A4EF");
});

test("buildStructuredProxyProgressFromDescription preserves elementCount on cache-hit path", () => {
	const progress = buildStructuredProxyProgressFromDescription(SAMPLE_DESCRIPTION, { stage: "cache-hit" });
	assert.ok(progress);
	assert.equal(progress?.elementCount, 1);
	assert.match(progress?.snapshotJson ?? "", /#00A4EF/u);
	assert.match(progress?.snapshotJson ?? "", /"bbox":\s*\{/u);
});
