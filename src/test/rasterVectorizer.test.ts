import test from "node:test";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageDataLike, RasterVectorizeAdapter } from "../toolCooperation/adapters/types";
import { rasterBufferToImageData, vectorizeRasterBuffer } from "../toolCooperation/rasterVectorizer";
import { isBboxPlaceholderSvg } from "../toolCooperation/visionSvgFidelity";

test("rasterBufferToImageData produces RGBA dimensions", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const png = await readFile(path.join(process.cwd(), "fixtures/host-ui/testButtons/按钮1.png"));
	const data = await rasterBufferToImageData(png);
	assert.ok(data.width > 0);
	assert.ok(data.height > 0);
	assert.equal(data.data.length, data.width * data.height * 4);
});

test("vectorizeRasterBuffer returns non-placeholder SVG with path elements", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const png = await readFile(path.join(process.cwd(), "fixtures/host-ui/testButtons/按钮1.png"));
	const result = await vectorizeRasterBuffer(png);
	assert.equal(result.engine, "imagetracerjs");
	assert.ok(result.pathCount > 0);
	assert.match(result.svg, /<svg[\s>]/iu);
	assert.match(result.svg, /<path\b/iu);
	assert.equal(isBboxPlaceholderSvg(result.svg), false);
});

test("vectorizeRasterBuffer uses injectable adapter", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const adapter: RasterVectorizeAdapter = {
		capability: {
			name: "mock-tracer",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async vectorize(): Promise<import("../toolCooperation/rasterVectorizer").RasterVectorizeResult> {
			return {
				svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h4v4H0z" fill="#00f"/></svg>',
				engine: "mock-tracer",
				pathCount: 1,
				width: 4,
				height: 4
			};
		}
	};
	const result = await vectorizeRasterBuffer(Buffer.from([1, 2, 3]), {}, adapter);
	assert.equal(result.engine, "mock-tracer");
	assert.equal(result.pathCount, 1);
});
