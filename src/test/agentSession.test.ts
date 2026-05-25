import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import type { VisionAgentConfig } from "../types";
import { deduplicateRefs, getIsolatedBatchError, isolateFailedBatch, resetBatchPlannerForTests, splitIntoBatches } from "../agentSession/batchPlanner";
import { getRetryDelay, shouldRetry } from "../agentSession/retryStrategy";
import {
	closeSession,
	completeBatch,
	createSession,
	createSessionIfEnabled,
	getBatchContextSnapshot,
	getSessionEventLog,
	getSession,
	getSessionHistory,
	markSessionReady,
	rebuildSession,
	resetSessionManagerForTests,
	setSessionScheduler,
	startBatch
} from "../agentSession/sessionManager";

const baseConfig: VisionAgentConfig = {
	enabled: true,
	keepAliveMs: 120000,
	maxBatchSize: 3,
	maxConcurrentBatches: 2,
	resetContextPerBatch: true,
	deduplicateImages: true,
	dedupeByHash: true,
	retryOnFailure: true,
	autoClosePolicy: "afterMainTask"
};

afterEach(() => {
	resetSessionManagerForTests();
	resetBatchPlannerForTests();
});

test("splitIntoBatches splits refs by maxBatchSize and deduplicateRefs respects config", () => {
	assert.deepEqual(splitIntoBatches(["0", "1", "2", "3"], 3), [["0", "1", "2"], ["3"]]);
	assert.deepEqual(splitIntoBatches(["0", "1", "2", "3", "4", "5", "6"], 6), [["0", "1", "2", "3", "4", "5"], ["6"]]);
	assert.deepEqual(deduplicateRefs([
		"image://1|hash:abc",
		"image://2|hash:abc",
		"image://3|hash:def"
	], baseConfig), ["image://1|hash:abc", "image://3|hash:def"]);
	assert.deepEqual(deduplicateRefs([
		"image://1|hash:abc",
		"image://2|hash:abc"
	], {
		deduplicateImages: false,
		dedupeByHash: false
	} as Pick<VisionAgentConfig, "deduplicateImages" | "dedupeByHash">), ["image://1|hash:abc", "image://2|hash:abc"]);
});

test("sessionManager follows Created -> Ready -> Busy -> Ready -> Closing -> Closed and resets context per batch", () => {
	const created = createSession(baseConfig);
	assert.equal(created.state, "Created");
	assert.equal(created.concurrencyLimit, 2);
	const ready = markSessionReady(created.sessionId);
	assert.equal(ready?.state, "Ready");

	const batch = startBatch(created.sessionId, ["img-1", "img-2"], 0, 0);
	assert.equal(batch.state, "Running");
	assert.deepEqual(getBatchContextSnapshot(batch.batchId), {
		protocolSeed: ["vision-protocol-v1"],
		inheritedImageRefs: []
	});

	completeBatch(batch.batchId);
	assert.equal(getSession(created.sessionId)?.state, "Closed");
	assert.deepEqual(getSessionHistory(created.sessionId), ["Created", "Ready", "Busy", "Ready", "Closing", "Closed"]);
	assert.deepEqual(getSessionEventLog(created.sessionId), [
		`session:${created.sessionId}:state=Created`,
		`session:${created.sessionId}:state=Ready`,
		`session:${created.sessionId}:state=Busy`,
		`session:${created.sessionId}:state=Ready`,
		`session:${created.sessionId}:state=Closing`,
		`session:${created.sessionId}:state=Closed`
	]);
});

test("resetContextPerBatch prevents cross-batch image leakage while false allows controlled inheritance", () => {
	const isolated = createSession({
		...baseConfig,
		autoClosePolicy: "never",
		resetContextPerBatch: true
	});
	markSessionReady(isolated.sessionId);
	const isolatedBatch1 = startBatch(isolated.sessionId, ["img-1"], 0, 0);
	completeBatch(isolatedBatch1.batchId);
	const isolatedBatch2 = startBatch(isolated.sessionId, ["img-2"], 1, 1);
	assert.deepEqual(getBatchContextSnapshot(isolatedBatch2.batchId), {
		protocolSeed: ["vision-protocol-v1"],
		inheritedImageRefs: []
	});

	const inherited = createSession({
		...baseConfig,
		autoClosePolicy: "never",
		resetContextPerBatch: false
	});
	markSessionReady(inherited.sessionId);
	const inheritedBatch1 = startBatch(inherited.sessionId, ["img-a"], 0, 0);
	completeBatch(inheritedBatch1.batchId);
	const inheritedBatch2 = startBatch(inherited.sessionId, ["img-b"], 1, 0);
	assert.deepEqual(getBatchContextSnapshot(inheritedBatch2.batchId), {
		protocolSeed: ["vision-protocol-v1"],
		inheritedImageRefs: ["img-a"]
	});
});

test("rebuildSession creates a new session without inheriting old batch context", () => {
	const created = createSession({
		...baseConfig,
		autoClosePolicy: "never"
	});
	markSessionReady(created.sessionId);
	const firstBatch = startBatch(created.sessionId, ["img-a"], 0, 0);
	completeBatch(firstBatch.batchId);
	const rebuilt = rebuildSession(created.sessionId);
	assert.notEqual(rebuilt.sessionId, created.sessionId);
	assert.equal(rebuilt.state, "Created");

	markSessionReady(rebuilt.sessionId);
	const rebuiltBatch = startBatch(rebuilt.sessionId, ["img-b"], 1, 1);
	assert.deepEqual(getBatchContextSnapshot(rebuiltBatch.batchId), {
		protocolSeed: ["vision-protocol-v1"],
		inheritedImageRefs: []
	});
	assert.deepEqual(getSessionHistory(created.sessionId), ["Created", "Ready", "Busy", "Ready", "Error"]);
	assert.deepEqual(getSessionHistory(rebuilt.sessionId), ["Created", "Ready", "Busy"]);
	assert.equal(rebuiltBatch.concurrencySlot, 1);
	assert.equal(rebuiltBatch.batchIndex, 1);
});

test("afterTimeout policy uses keepAliveMs, keepAliveMs=0 skips timer, and isolateFailedBatch tracks local failures", () => {
	const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
	setSessionScheduler({
		now: () => 100,
		setTimeout: (callback, delayMs) => {
			scheduled.push({ callback, delayMs });
			return scheduled.length - 1;
		},
		clearTimeout: () => undefined
	});

	const timed = createSession({
		...baseConfig,
		autoClosePolicy: "afterTimeout",
		keepAliveMs: 5000
	});
	markSessionReady(timed.sessionId);
	assert.equal(scheduled[0]?.delayMs, 5000);
	assert.equal(getSession(timed.sessionId)?.state, "Ready");
	scheduled[0]?.callback();
	assert.equal(getSession(timed.sessionId)?.state, "Closed");

	resetSessionManagerForTests();
	setSessionScheduler({
		now: () => 200,
		setTimeout: (callback, delayMs) => {
			scheduled.push({ callback, delayMs });
			return scheduled.length - 1;
		},
		clearTimeout: () => undefined
	});
	const noTimer = createSession({
		...baseConfig,
		autoClosePolicy: "afterTimeout",
		keepAliveMs: 0
	});
	markSessionReady(noTimer.sessionId);
	assert.equal(getSession(noTimer.sessionId)?.state, "Ready");
	assert.equal(scheduled.length, 1);

	isolateFailedBatch("batch-x", new Error("local failure"));
	assert.equal(getIsolatedBatchError("batch-x"), "local failure");
});

test("retryStrategy honors retryOnFailure, abort/fatal failures, and exponential backoff cap", () => {
	assert.equal(shouldRetry(0, new Error("temporary upstream failure"), baseConfig), true);
	assert.equal(shouldRetry(3, new Error("temporary upstream failure"), baseConfig), false);
	assert.equal(shouldRetry(0, new Error("fatal validation mismatch"), baseConfig), false);
	assert.equal(shouldRetry(0, Object.assign(new Error("abort"), { name: "AbortError" }), baseConfig), false);
	assert.equal(shouldRetry(0, new Error("temporary"), {
		...baseConfig,
		retryOnFailure: false
	}), false);
	assert.equal(getRetryDelay(1), 1000);
	assert.equal(getRetryDelay(2), 2000);
	assert.equal(getRetryDelay(10), 30000);
});

test("closeSession is idempotent when called repeatedly", () => {
	const created = createSession({
		...baseConfig,
		autoClosePolicy: "never"
	});
	markSessionReady(created.sessionId);
	closeSession(created.sessionId, "manual");
	closeSession(created.sessionId, "manual");
	assert.equal(getSession(created.sessionId)?.state, "Closed");
	assert.deepEqual(getSessionHistory(created.sessionId), ["Created", "Ready", "Closing", "Closed"]);
});

test("createSessionIfEnabled blocks new scheduling sessions when the gray switch is off", () => {
	assert.equal(createSessionIfEnabled({
		...baseConfig,
		enabled: false
	}), undefined);
	assert.equal(createSessionIfEnabled(baseConfig)?.state, "Created");
});

test("getSession returns undefined for unknown sessionId and markSessionReady handles closed or unknown sessions", () => {
	assert.equal(getSession("nonexistent-session-id"), undefined);

	const created = createSession({ ...baseConfig, autoClosePolicy: "never" });
	// markSessionReady on unknown session returns undefined
	assert.equal(markSessionReady("nonexistent-session-id"), undefined);
	// markSessionReady on closed session returns undefined
	markSessionReady(created.sessionId);
	closeSession(created.sessionId, "test");
	assert.equal(markSessionReady(created.sessionId), undefined);
});

test("startBatch on unknown session throws, and batchIndex tracks separate batches", () => {
	assert.throws(
		() => startBatch("nonexistent-session-id", ["img-a"], 0, 0),
		/Unknown session/
	);
	const session = createSession({ ...baseConfig, autoClosePolicy: "never" });
	markSessionReady(session.sessionId);
	const b1 = startBatch(session.sessionId, ["img-1", "img-2"], 0, 0);
	completeBatch(b1.batchId);
	const b2 = startBatch(session.sessionId, ["img-3"], 1, 1);
	assert.equal(b1.batchIndex, 0);
	assert.equal(b2.batchIndex, 1);
	assert.notEqual(b1.batchId, b2.batchId);
});

test("single-image repeated turns keep isolated context when resetContextPerBatch=true", () => {
	const session = createSession({
		...baseConfig,
		autoClosePolicy: "never",
		resetContextPerBatch: true
	});
	markSessionReady(session.sessionId);

	const turn1 = startBatch(session.sessionId, ["img-single"], 0, 0);
	completeBatch(turn1.batchId);
	const turn2 = startBatch(session.sessionId, ["img-single"], 1, 0);
	completeBatch(turn2.batchId);
	const turn3 = startBatch(session.sessionId, ["img-single"], 2, 0);

	assert.deepEqual(getBatchContextSnapshot(turn1.batchId), {
		protocolSeed: ["vision-protocol-v1"],
		inheritedImageRefs: []
	});
	assert.deepEqual(getBatchContextSnapshot(turn2.batchId), {
		protocolSeed: ["vision-protocol-v1"],
		inheritedImageRefs: []
	});
	assert.deepEqual(getBatchContextSnapshot(turn3.batchId), {
		protocolSeed: ["vision-protocol-v1"],
		inheritedImageRefs: []
	});
});

test("single-image repeated turns can inherit prior refs when resetContextPerBatch=false", () => {
	const session = createSession({
		...baseConfig,
		autoClosePolicy: "never",
		resetContextPerBatch: false
	});
	markSessionReady(session.sessionId);

	const turn1 = startBatch(session.sessionId, ["img-single"], 0, 0);
	completeBatch(turn1.batchId);
	const turn2 = startBatch(session.sessionId, ["img-single"], 1, 0);

	assert.deepEqual(getBatchContextSnapshot(turn2.batchId), {
		protocolSeed: ["vision-protocol-v1"],
		inheritedImageRefs: ["img-single"]
	});
});