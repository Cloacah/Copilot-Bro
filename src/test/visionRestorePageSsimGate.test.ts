import test from "node:test";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProxyStructuredOutput } from "../visionProxyStructuredPlan";
import { runPageRestoreBenchmark } from "../toolCooperation/visionRestoreBenchmarkRunner";

const BUTTON = path.join(process.cwd(), "fixtures/host-ui/testButtons/按钮1.png");

test("runPageRestoreBenchmark: dual raster tiles meet ≥99% web screenshot vs source (Playwright, no fixture plan JSON)", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const source = await readFile(BUTTON);
	const sharp = (await import("sharp")).default;
	const meta = await sharp(source).metadata();
	const w = meta.width ?? 1;
	const h = meta.height ?? 1;
	const half = Math.max(1, Math.floor(w / 2));
	const plan: ProxyStructuredOutput = {
		contract: "vision-proxy-contract-v3",
		sceneSummary: "inline two-tile benchmark",
		observations: [],
		recognizedText: [],
		layout: [],
		elements: [
			{
				elementId: "left",
				label: "left",
				mode: "image",
				confidence: 1,
				rationale: "left half",
				observations: [],
				recognizedText: [],
				layout: [],
				regions: [{ label: "L", bbox: { x: 0, y: 0, w: half, h }, confidence: 1, priority: 1, rationale: "x" }],
				imageParams: { crop: { x: 0, y: 0, w: half, h } }
			},
			{
				elementId: "right",
				label: "right",
				mode: "image",
				confidence: 1,
				rationale: "right half",
				observations: [],
				recognizedText: [],
				layout: [],
				regions: [
					{
						label: "R",
						bbox: { x: half, y: 0, w: Math.max(1, w - half), h },
						confidence: 1,
						priority: 1,
						rationale: "x"
					}
				],
				imageParams: { crop: { x: half, y: 0, w: Math.max(1, w - half), h } }
			}
		]
	};
	const result = await runPageRestoreBenchmark({
		sourceImage: source,
		plan,
		imageWidth: w,
		imageHeight: h,
		budget: { minCompositeSimilarity: 0.99 },
		playwrightResolveRoot: process.cwd()
	});
	assert.equal(result.pageSimilarity.passed, true, JSON.stringify(result.pageSimilarity));
	assert.equal(result.elementResults.length, 2);
});
