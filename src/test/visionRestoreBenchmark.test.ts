import test from "node:test";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runElementRestoreBenchmark } from "../toolCooperation/visionRestoreBenchmarkRunner";

const BUTTON = path.join(process.cwd(), "fixtures/host-ui/testButtons/按钮1.png");

test("vision restore benchmark: testButtons SVG element >=99% similarity", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const source = await readFile(BUTTON);
	const sharp = (await import("sharp")).default;
	const meta = await sharp(source).metadata();
	const w = meta.width ?? 1;
	const h = meta.height ?? 1;
	const element = {
		elementId: "btn-benchmark",
		label: "button",
		mode: "svg" as const,
		confidence: 1,
		rationale: "UI button vector restore",
		observations: [] as string[],
		recognizedText: [] as string[],
		layout: [] as string[],
		regions: [
			{
				label: "button",
				bbox: { x: 0, y: 0, w, h },
				confidence: 1,
				priority: 1,
				rationale: "full asset"
			}
		],
		svgParams: { mode: "path-guided" as const }
	};
	const result = await runElementRestoreBenchmark({
		sourceImage: source,
		element,
		imageWidth: w,
		imageHeight: h,
		similarityThreshold: 0.99
	});
	assert.equal(result.similarity.passed, true, JSON.stringify(result.similarity));
	assert.equal(result.metrics.fidelityPassed, true);
	assert.ok(result.metrics.rasterPathCount <= 2048, `pathCount=${result.metrics.rasterPathCount}`);
});

test("vision restore benchmark: testButtons raster (matting) >=99% similarity", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const source = await readFile(BUTTON);
	const sharp = (await import("sharp")).default;
	const meta = await sharp(source).metadata();
	const w = meta.width ?? 1;
	const h = meta.height ?? 1;
	const element = {
		elementId: "btn-raster-benchmark",
		label: "button",
		mode: "image" as const,
		confidence: 1,
		rationale: "UI button raster extract",
		observations: [] as string[],
		recognizedText: [] as string[],
		layout: [] as string[],
		regions: [{ label: "button", bbox: { x: 0, y: 0, w, h }, confidence: 1, priority: 1, rationale: "full" }],
		imageParams: { crop: { x: 0, y: 0, w, h } }
	};
	const result = await runElementRestoreBenchmark({
		sourceImage: source,
		element,
		imageWidth: w,
		imageHeight: h,
		similarityThreshold: 0.99
	});
	assert.equal(result.similarity.passed, true, JSON.stringify(result.similarity));
	assert.equal(result.metrics.fidelityPassed, true);
});
