import test from "node:test";
import assert from "node:assert/strict";
import {
	clearVisionEvidenceStoreForTests,
	createVisionEvidenceId,
	getVisionEvidenceRecord,
	listVisionEvidenceRecords,
	upsertVisionEvidenceRecord
} from "../visionProtocol/visionEvidenceStore";

test("vision evidence store persists structured proxy handoff records", () => {
	clearVisionEvidenceStoreForTests();
	const created = upsertVisionEvidenceRecord({
		imageHash: "abc123",
		route: "proxy",
		handoff: "description",
		taskStatus: "completed",
		modelId: "deepseek-v4-flash",
		proxyModelId: "copilot-vision",
		description: "structured visual evidence"
	}, new Date("2026-05-14T00:00:00.000Z"));

	assert.equal(created.id, "vision:abc123");
	assert.equal(created.createdAt, "2026-05-14T00:00:00.000Z");
	assert.deepEqual(getVisionEvidenceRecord("vision:abc123"), created);
	assert.equal(listVisionEvidenceRecords().length, 1);
});

test("vision evidence store updates task status without changing creation time", () => {
	clearVisionEvidenceStoreForTests();
	upsertVisionEvidenceRecord({
		id: createVisionEvidenceId("hash-1"),
		imageHash: "hash-1",
		route: "proxy",
		handoff: "restoration",
		taskStatus: "pending",
		modelId: "main-model",
		proxyModelId: "vision-model",
		description: "needs extraction"
	}, new Date("2026-05-14T00:00:00.000Z"));

	const updated = upsertVisionEvidenceRecord({
		id: createVisionEvidenceId("hash-1"),
		imageHash: "hash-1",
		route: "proxy",
		handoff: "restoration",
		taskStatus: "completed",
		modelId: "main-model",
		proxyModelId: "vision-model",
		description: "extraction complete"
	}, new Date("2026-05-14T00:01:00.000Z"));

	assert.equal(updated.createdAt, "2026-05-14T00:00:00.000Z");
	assert.equal(updated.updatedAt, "2026-05-14T00:01:00.000Z");
	assert.equal(updated.taskStatus, "completed");
	assert.equal(getVisionEvidenceRecord("vision:hash-1")?.description, "extraction complete");
});
