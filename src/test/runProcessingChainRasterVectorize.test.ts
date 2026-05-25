import test from "node:test";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runProcessingChain } from "../toolCooperation/resultAssembler";
import { isBboxPlaceholderSvg } from "../toolCooperation/visionSvgFidelity";

test("runProcessingChain with rasterVectorize traces PNG to non-placeholder SVG", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const png = await readFile(path.join(process.cwd(), "fixtures/host-ui/testButtons/按钮1.png"));
	const result = await runProcessingChain(
		{ image: png },
		{
			imagePreprocess: true,
			svgOptimize: true,
			mlSegment: false,
			rasterVectorize: true,
			svgDecisionPolicy: "always"
		}
	);
	assert.ok(result.rasterVectorize);
	assert.equal(result.rasterVectorize?.engine, "imagetracerjs");
	assert.ok((result.rasterVectorize?.pathCount ?? 0) > 0);
	assert.ok(result.svg?.includes("<path"));
	assert.equal(isBboxPlaceholderSvg(result.svg), false);
});
