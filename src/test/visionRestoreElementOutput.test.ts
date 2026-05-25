import test from "node:test";
import assert from "node:assert/strict";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	defaultRestoreBenchmarkSettings,
	isRestoreElementOutputAcceptable,
	produceRestoreElementOutputs
} from "../toolCooperation/visionRestoreElementOutput";
import { compareImageBuffers } from "../toolCooperation/imageSimilarity";

const FIXTURES = path.join(process.cwd(), "src/test/fixtures");
const BUTTON = path.join(process.cwd(), "fixtures/host-ui/testButtons/按钮1.png");

test("produceRestoreElementOutputs: image mode raster only (no svg chain)", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const source = await readFile(BUTTON);
	const sharp = (await import("sharp")).default;
	const meta = await sharp(source).metadata();
	const w = meta.width ?? 1;
	const h = meta.height ?? 1;
	const outputs = await produceRestoreElementOutputs({
		original: source,
		element: {
			elementId: "matting-only",
			label: "btn",
			mode: "image",
			confidence: 1,
			rationale: "matting",
			observations: [],
			recognizedText: [],
			layout: [],
			regions: [{ label: "btn", bbox: { x: 0, y: 0, w, h }, confidence: 1, priority: 1, rationale: "full" }],
			imageParams: { crop: { x: 0, y: 0, w, h } }
		},
		imageWidth: w,
		imageHeight: h,
		settings: defaultRestoreBenchmarkSettings()
	});
	assert.equal(outputs.mode, "image");
	assert.ok(outputs.productionPng.length > 0);
	assert.equal(outputs.productionSvg, undefined);
	assert.equal(outputs.svgChain, undefined);
	assert.equal(isRestoreElementOutputAcceptable(outputs), true);
});

test("produceRestoreElementOutputs: svg mode yields raster layer + svg artifact", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const source = await readFile(BUTTON);
	const sharp = (await import("sharp")).default;
	const meta = await sharp(source).metadata();
	const w = meta.width ?? 1;
	const h = meta.height ?? 1;
	const outputs = await produceRestoreElementOutputs({
		original: source,
		element: {
			elementId: "dual-path",
			label: "btn",
			mode: "svg",
			confidence: 1,
			rationale: "vector",
			observations: [],
			recognizedText: [],
			layout: [],
			regions: [{ label: "btn", bbox: { x: 0, y: 0, w, h }, confidence: 1, priority: 1, rationale: "full" }],
			svgParams: { mode: "path-guided" }
		},
		imageWidth: w,
		imageHeight: h,
		settings: defaultRestoreBenchmarkSettings()
	});
	assert.equal(outputs.mode, "svg");
	assert.ok(outputs.productionPng.length > 0);
	assert.ok(outputs.productionSvg && outputs.productionSvg.length > 50);
	assert.ok(outputs.svgChain);
	const ref = await sharp(source).extract({ left: 0, top: 0, width: w, height: h }).png().toBuffer();
	const sim = await compareImageBuffers(ref, outputs.productionPng, { threshold: 0.99 });
	assert.equal(sim.passed, true, JSON.stringify(sim));
});
