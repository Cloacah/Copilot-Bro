import test from "node:test";
import assert from "node:assert/strict";
import {
	isVisionOrchestrationSuppressed,
	runWithSuppressedVisionOrchestration
} from "../visionOrchestrationContext";

test("vision orchestration suppression is scoped to async context", async () => {
	assert.equal(isVisionOrchestrationSuppressed(), false);
	await runWithSuppressedVisionOrchestration(async () => {
		assert.equal(isVisionOrchestrationSuppressed(), true);
		await Promise.resolve();
		assert.equal(isVisionOrchestrationSuppressed(), true);
	});
	assert.equal(isVisionOrchestrationSuppressed(), false);
});

test("vision orchestration suppression depth survives promise ticks", async () => {
	await runWithSuppressedVisionOrchestration(async () => {
		await new Promise<void>((resolve) => {
			setImmediate(() => {
				assert.equal(isVisionOrchestrationSuppressed(), true);
				resolve();
			});
		});
	});
});
