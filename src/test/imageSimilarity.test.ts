import test from "node:test";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import assert from "node:assert/strict";
import { compareImageBuffers, compositeScore } from "../toolCooperation/imageSimilarity";

test("compositeScore is 1 for identical metrics", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	assert.equal(compositeScore(1, 100, 0), 1);
});

test("compareImageBuffers passes identical PNG buffers", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const sharp = (await import("sharp")).default;
	const png = await sharp({
		create: { width: 64, height: 32, channels: 3, background: { r: 40, g: 120, b: 200 } }
	})
		.png()
		.toBuffer();
	const report = await compareImageBuffers(png, Buffer.from(png), { threshold: 0.99 });
	assert.equal(report.passed, true);
	assert.ok(report.ssim >= 0.99);
	assert.ok(report.compositeSimilarity >= 0.99);
});

test("compareImageBuffers fails clearly different buffers", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const sharp = (await import("sharp")).default;
	const a = await sharp({
		create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } }
	})
		.png()
		.toBuffer();
	const b = await sharp({
		create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 255, b: 255 } }
	})
		.png()
		.toBuffer();
	const report = await compareImageBuffers(a, b, { threshold: 0.99 });
	assert.equal(report.passed, false);
});
