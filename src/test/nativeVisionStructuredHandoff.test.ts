import test from "node:test";
import assert from "node:assert/strict";
import {
	clearVisionEvidenceStoreForTests,
	createVisionEvidenceId,
	getVisionEvidenceRecord,
	listVisionEvidenceRecords,
	upsertVisionEvidenceRecord
} from "../visionProtocol/visionEvidenceStore";
import { createVisionTaskStack, getVisionTaskStack } from "../visionProtocol/visionTaskStack";
import {
	buildVisionEvidenceContractSnapshot,
	extractVisionBatchFromAssistantText,
	finalizeNativeVisionStructuredHandoff,
	isDescribeOnlyHandoff
} from "../visionProtocol/nativeVisionStructuredHandoff";

const FIXTURE_BATCH = {
	batchId: "batch-1",
	sessionId: "session-1",
	results: [
		{
			imageRef: "img-0",
			imageHash: "hash-native-1",
			objects: [
				{
					id: "obj-1",
					label: "button",
					geometry: {
						version: "v1",
						bbox: { x: 1, y: 2, w: 3, h: 4 },
						rationale: "primary control"
					}
				}
			],
			processingMs: 12
		}
	],
	totalMs: 12,
	failedRefs: []
};

test("isDescribeOnlyHandoff treats description as describe-only", () => {
	assert.equal(isDescribeOnlyHandoff("description"), true);
	assert.equal(isDescribeOnlyHandoff("restoration"), false);
});

test("extractVisionBatchFromAssistantText parses raw JSON and fenced JSON", () => {
	const raw = extractVisionBatchFromAssistantText(JSON.stringify(FIXTURE_BATCH));
	assert.ok(raw);
	assert.equal(raw?.results[0]?.imageHash, "hash-native-1");
	const fenced = extractVisionBatchFromAssistantText(
		"Here is the vision output:\n```json\n" + JSON.stringify(FIXTURE_BATCH) + "\n```"
	);
	assert.equal(fenced?.batchId, "batch-1");
	assert.equal(extractVisionBatchFromAssistantText("not json at all"), undefined);
});

test("finalizeNativeVisionStructuredHandoff completes pending native evidence for matching hash", () => {
	clearVisionEvidenceStoreForTests();
	const evidenceId = createVisionEvidenceId("hash-native-1");
	upsertVisionEvidenceRecord({
		id: evidenceId,
		imageHash: "hash-native-1",
		route: "native",
		handoff: "description",
		taskStatus: "pending",
		modelId: "qwen-vl-max",
		description: "pending"
	});
	createVisionTaskStack(evidenceId, ["describe", "complete"]);
	const logs: Array<{ event: string; payload: unknown }> = [];
	const result = finalizeNativeVisionStructuredHandoff({
		assistantText: JSON.stringify(FIXTURE_BATCH),
		modelId: "qwen-vl-max",
		imageHashes: ["hash-native-1"],
		pendingHandoff: "description",
		logger: {
			info: (event: string, payload?: unknown) => {
				logs.push({ event, payload });
			}
		}
	});
	assert.equal(result.parsed, true);
	assert.equal(result.completedEvidenceIds.length, 1);
	assert.equal(result.regionCount, 1);
	assert.ok(result.structured);
	assert.equal(result.structured?.contract, "vision-proxy-contract-v3");
	assert.equal(result.structured?.elements.length, 1);
	assert.ok(result.structuredSnapshotJson?.includes("vision-proxy-contract-v3"));
	const record = getVisionEvidenceRecord("vision:hash-native-1");
	assert.equal(record?.route, "native");
	assert.equal(record?.taskStatus, "completed");
	assert.equal(record?.handoff, "description");
	assert.ok(record?.description.includes("button"));
	const stack = getVisionTaskStack("vision:hash-native-1:stack");
	assert.ok(stack);
	assert.ok(stack.tasks.every((task) => task.status === "completed"));
	assert.ok(logs.some((entry) => entry.event === "vision.native.structured.completed"));
	assert.ok(logs.some((entry) => entry.event === "vision.native.structured.snapshot"));
	assert.equal(listVisionEvidenceRecords().length, 1);
});

test("describe-only finalize does not schedule restoration artifact tasks", () => {
	clearVisionEvidenceStoreForTests();
	const evidenceId = createVisionEvidenceId("hash-native-1");
	upsertVisionEvidenceRecord({
		id: evidenceId,
		imageHash: "hash-native-1",
		route: "native",
		handoff: "description",
		taskStatus: "pending",
		modelId: "qwen-vl-max",
		description: "pending"
	});
	createVisionTaskStack(evidenceId, ["describe", "complete"]);
	finalizeNativeVisionStructuredHandoff({
		assistantText: JSON.stringify(FIXTURE_BATCH),
		modelId: "qwen-vl-max",
		imageHashes: ["hash-native-1"],
		pendingHandoff: "description"
	});
	const stack = getVisionTaskStack("vision:hash-native-1:stack");
	assert.ok(stack);
	assert.ok(!stack.tasks.some((task) => task.kind === "restore-svg" || task.kind === "extract-image"));
});

test("buildVisionEvidenceContractSnapshot exposes shared proxy/native log fields", () => {
	const snapshot = buildVisionEvidenceContractSnapshot();
	assert.deepEqual(snapshot.handoffs, ["description", "restoration"]);
	assert.ok(snapshot.sharedLogFields.includes("evidenceId"));
	assert.ok(snapshot.sharedLogFields.includes("imageHash"));
});

test("finalizeNativeVisionStructuredHandoff leaves evidence pending when output is not structured", () => {
	clearVisionEvidenceStoreForTests();
	upsertVisionEvidenceRecord({
		id: createVisionEvidenceId("hash-native-2"),
		imageHash: "hash-native-2",
		route: "native",
		handoff: "description",
		taskStatus: "pending",
		modelId: "qwen-vl-max",
		description: "pending"
	});
	const result = finalizeNativeVisionStructuredHandoff({
		assistantText: "plain text without structured vision batch",
		modelId: "qwen-vl-max",
		imageHashes: ["hash-native-2"],
		pendingHandoff: "description"
	});
	assert.equal(result.parsed, false);
	assert.equal(result.completedEvidenceIds.length, 0);
	assert.equal(getVisionEvidenceRecord("vision:hash-native-2")?.taskStatus, "pending");
});
