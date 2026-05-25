import test from "node:test";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import assert from "node:assert/strict";
import { buildVisionRestoreFidelityReport } from "../toolCooperation/visionRestoreFidelityReport";

const VECTOR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1h8v8H1z"/></svg>';
const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

test("buildVisionRestoreFidelityReport passes for real vector output", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const report = buildVisionRestoreFidelityReport({
		elementId: "btn-1",
		bbox: { x: 0, y: 0, w: 10, h: 10 },
		rasterVectorize: { svg: VECTOR, engine: "imagetracerjs", pathCount: 1, width: 10, height: 10 },
		chain: { svg: VECTOR, warnings: [] },
		resolvedSvg: VECTOR
	});
	assert.equal(report.contract, "vision-restore-fidelity-v1");
	assert.equal(report.passed, true);
	assert.deepEqual(report.failureReasons, []);
	assert.equal(report.svg?.pathCount, 1);
});

test("buildVisionRestoreFidelityReport fails on bbox placeholder", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const report = buildVisionRestoreFidelityReport({
		chain: { svg: PLACEHOLDER, warnings: [] },
		resolvedSvg: PLACEHOLDER
	});
	assert.equal(report.passed, false);
	assert.ok(report.failureReasons.includes("bbox-placeholder-svg"));
});
