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
