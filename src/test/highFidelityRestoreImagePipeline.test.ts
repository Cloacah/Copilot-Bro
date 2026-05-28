import test from "node:test";
import assert from "node:assert/strict";
import {
	HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED,
	isStructuredVisionImageOutputEnabled,
	shouldPersistVisionImageArtifactsFromExecution
} from "../config/highFidelityRestoreImagePipelineSuspended";

test("structured vision image output is disabled while pipeline is suspended", () => {
	assert.equal(HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED, true);
	assert.equal(isStructuredVisionImageOutputEnabled("restore-artifact"), false);
	assert.equal(isStructuredVisionImageOutputEnabled("describe-only"), false);
});

test("shouldPersistVisionImageArtifactsFromExecution ignores raw processedImageParts when output disabled", () => {
	assert.equal(
		shouldPersistVisionImageArtifactsFromExecution("restore-artifact", {
			processedImageParts: [{}],
			svgOutputs: []
		}),
		false
	);
	assert.equal(
		shouldPersistVisionImageArtifactsFromExecution("describe-only", {
			processedImageParts: [{}],
			svgOutputs: ["<svg></svg>"]
		}),
		false
	);
});
