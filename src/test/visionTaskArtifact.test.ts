import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	clearVisionTaskStacksForTests,
	createVisionTaskStack,
	getNextRunnableVisionTask,
	isVisionTaskStackComplete,
	updateVisionTaskStatus
} from "../visionProtocol/visionTaskStack";
import { saveVisionArtifact } from "../toolCooperation/visionArtifactStore";

test("vision task stack gates restoration tasks until dependencies complete", () => {
	clearVisionTaskStacksForTests();
	const stack = createVisionTaskStack("vision:abc123", [
		"describe",
		"extract-image",
		"restore-svg",
		"verify-artifact",
		"complete"
	], new Date("2026-05-14T00:00:00.000Z"));

	const first = getNextRunnableVisionTask(stack.id);
	assert.equal(first?.kind, "describe");
	updateVisionTaskStatus(stack.id, first!.id, "running");
	updateVisionTaskStatus(stack.id, first!.id, "completed");
	assert.equal(getNextRunnableVisionTask(stack.id)?.kind, "extract-image");
	assert.equal(isVisionTaskStackComplete(stack.id), false);
});

test("vision artifact store persists hash-bound artifacts and completes task stack", async () => {
	clearVisionTaskStacksForTests();
	const rootDir = await mkdtemp(path.join(tmpdir(), "copilot-bro-vision-artifact-"));
	try {
		const stack = createVisionTaskStack("vision:hash-1", ["restore-svg", "verify-artifact", "complete"]);
		const restoreTask = getNextRunnableVisionTask(stack.id)!;
		updateVisionTaskStatus(stack.id, restoreTask.id, "running");
		const artifact = await saveVisionArtifact({
			rootDir,
			evidenceId: stack.evidenceId,
			taskId: restoreTask.id,
			kind: "svg",
			bytes: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><path d=\"M0 0H1V1H0Z\"/></svg>"
		}, new Date("2026-05-14T00:01:00.000Z"));

		assert.match(artifact.filePath, /vision-artifacts/);
		assert.equal(artifact.kind, "svg");
		assert.equal(artifact.sha256.length, 64);
		updateVisionTaskStatus(stack.id, restoreTask.id, "completed", { artifactId: artifact.id });
		const verifyTask = getNextRunnableVisionTask(stack.id)!;
		assert.equal(verifyTask.kind, "verify-artifact");
		updateVisionTaskStatus(stack.id, verifyTask.id, "running");
		updateVisionTaskStatus(stack.id, verifyTask.id, "completed", { artifactId: artifact.id });
		const completeTask = getNextRunnableVisionTask(stack.id)!;
		updateVisionTaskStatus(stack.id, completeTask.id, "running");
		updateVisionTaskStatus(stack.id, completeTask.id, "completed", { artifactId: artifact.id });
		assert.equal(isVisionTaskStackComplete(stack.id), true);
	} finally {
		await rm(rootDir, { recursive: true, force: true });
	}
});
