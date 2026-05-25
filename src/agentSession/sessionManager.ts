import type { VisionAgentConfig } from "../types";
import type { AgentSessionHandle, BatchContextSnapshot, BatchHandle, SessionState } from "./types";

interface SessionScheduler {
	now(): number;
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

interface SessionRecord {
	handle: AgentSessionHandle;
	config: VisionAgentConfig;
	history: SessionState[];
	events: string[];
	fixedSystemContext: string[];
	previousBatchImageRefs: string[];
	batchIds: Set<string>;
	autoCloseHandle?: unknown;
	closeReason?: string;
}

const sessions = new Map<string, SessionRecord>();
const batches = new Map<string, BatchHandle>();
const batchContexts = new Map<string, BatchContextSnapshot>();

let nextSessionId = 1;
let nextBatchId = 1;
let scheduler: SessionScheduler = {
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export function createSession(config: VisionAgentConfig): AgentSessionHandle {
	const now = scheduler.now();
	const sessionId = `session-${nextSessionId++}`;
	const record: SessionRecord = {
		handle: {
			sessionId,
			state: "Created",
			createdAt: now,
			lastActivityAt: now,
			concurrencyLimit: Math.max(1, config.maxConcurrentBatches),
			resetContextPerBatch: config.resetContextPerBatch,
			activeBatchId: undefined
		},
		config,
		history: ["Created"],
		events: [`session:${sessionId}:state=Created`],
		fixedSystemContext: ["vision-protocol-v1"],
		previousBatchImageRefs: [],
		batchIds: new Set<string>()
	};
	sessions.set(sessionId, record);
	return cloneSession(record.handle);
}

export function createSessionIfEnabled(config: VisionAgentConfig): AgentSessionHandle | undefined {
	return config.enabled ? createSession(config) : undefined;
}

export function getSession(sessionId: string): AgentSessionHandle | undefined {
	const record = sessions.get(sessionId);
	return record ? cloneSession(record.handle) : undefined;
}

export function markSessionReady(sessionId: string): AgentSessionHandle | undefined {
	const record = sessions.get(sessionId);
	if (!record || record.handle.state === "Closed") {
		return undefined;
	}
	transitionSession(record, "Ready");
	scheduleAfterTimeoutClose(record);
	return cloneSession(record.handle);
}

export function startBatch(
	sessionId: string,
	imageRefs: string[],
	batchIndex: number,
	concurrencySlot: number
): BatchHandle {
	const record = sessions.get(sessionId);
	if (!record) {
		throw new Error(`Unknown session: ${sessionId}`);
	}
	if (record.handle.state === "Created") {
		transitionSession(record, "Ready");
	}
	const batchId = `batch-${nextBatchId++}`;
	const now = scheduler.now();
	const batch: BatchHandle = {
		batchId,
		sessionId,
		state: "Running",
		imageRefs: [...imageRefs],
		batchIndex,
		concurrencySlot,
		createdAt: now,
		lastUpdatedAt: now
	};
	batches.set(batchId, batch);
	record.batchIds.add(batchId);
	record.handle.activeBatchId = batchId;
	record.handle.lastActivityAt = now;
	transitionSession(record, "Busy");
	batchContexts.set(batchId, {
		protocolSeed: [...record.fixedSystemContext],
		inheritedImageRefs: record.handle.resetContextPerBatch ? [] : [...record.previousBatchImageRefs]
	});
	clearScheduledClose(record);
	return cloneBatch(batch);
}

export function completeBatch(batchId: string): BatchHandle | undefined {
	const batch = batches.get(batchId);
	if (!batch) {
		return undefined;
	}
	const record = sessions.get(batch.sessionId);
	if (!record) {
		return undefined;
	}
	batch.state = "Done";
	batch.lastUpdatedAt = scheduler.now();
	record.handle.lastActivityAt = batch.lastUpdatedAt;
	record.previousBatchImageRefs = record.handle.resetContextPerBatch ? [] : [...batch.imageRefs];
	record.handle.activeBatchId = undefined;
	transitionSession(record, "Ready");
	if (record.config.autoClosePolicy === "afterMainTask") {
		closeSession(record.handle.sessionId, "afterMainTask");
	} else {
		scheduleAfterTimeoutClose(record);
	}
	return cloneBatch(batch);
}

export function failBatch(batchId: string): BatchHandle | undefined {
	const batch = batches.get(batchId);
	if (!batch) {
		return undefined;
	}
	const record = sessions.get(batch.sessionId);
	if (!record) {
		return undefined;
	}
	batch.state = "Failed";
	batch.lastUpdatedAt = scheduler.now();
	record.handle.lastActivityAt = batch.lastUpdatedAt;
	record.handle.activeBatchId = undefined;
	transitionSession(record, "Ready");
	scheduleAfterTimeoutClose(record);
	return cloneBatch(batch);
}

export function closeSession(sessionId: string, reason: string): void {
	const record = sessions.get(sessionId);
	if (!record || record.handle.state === "Closed") {
		return;
	}
	clearScheduledClose(record);
	record.closeReason = reason;
	transitionSession(record, "Closing");
	transitionSession(record, "Closed");
	record.handle.activeBatchId = undefined;
	record.handle.lastActivityAt = scheduler.now();
	for (const batchId of record.batchIds) {
		batchContexts.delete(batchId);
	}
	record.previousBatchImageRefs = [];
}

export function rebuildSession(failedSessionId: string): AgentSessionHandle {
	const record = sessions.get(failedSessionId);
	if (!record) {
		throw new Error(`Unknown session: ${failedSessionId}`);
	}
	clearScheduledClose(record);
	transitionSession(record, "Error");
	record.previousBatchImageRefs = [];
	record.handle.activeBatchId = undefined;
	return createSession({
		...record.config,
		resetContextPerBatch: true
	});
}

export function getBatch(batchId: string): BatchHandle | undefined {
	const batch = batches.get(batchId);
	return batch ? cloneBatch(batch) : undefined;
}

export function getBatchContextSnapshot(batchId: string): BatchContextSnapshot | undefined {
	const snapshot = batchContexts.get(batchId);
	return snapshot ? {
		protocolSeed: [...snapshot.protocolSeed],
		inheritedImageRefs: [...snapshot.inheritedImageRefs]
	} : undefined;
}

export function getSessionHistory(sessionId: string): SessionState[] {
	return [...(sessions.get(sessionId)?.history ?? [])];
}

export function getSessionEventLog(sessionId: string): string[] {
	return [...(sessions.get(sessionId)?.events ?? [])];
}

export function setSessionScheduler(nextScheduler: SessionScheduler): void {
	scheduler = nextScheduler;
}

export function resetSessionManagerForTests(): void {
	for (const record of sessions.values()) {
		clearScheduledClose(record);
	}
	sessions.clear();
	batches.clear();
	batchContexts.clear();
	nextSessionId = 1;
	nextBatchId = 1;
	scheduler = {
		now: () => Date.now(),
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
	};
}

function scheduleAfterTimeoutClose(record: SessionRecord): void {
	clearScheduledClose(record);
	if (record.config.autoClosePolicy !== "afterTimeout" || record.config.keepAliveMs <= 0) {
		return;
	}
	record.autoCloseHandle = scheduler.setTimeout(() => {
		closeSession(record.handle.sessionId, "afterTimeout");
	}, record.config.keepAliveMs);
}

function clearScheduledClose(record: SessionRecord): void {
	if (record.autoCloseHandle !== undefined) {
		scheduler.clearTimeout(record.autoCloseHandle);
		record.autoCloseHandle = undefined;
	}
}

function transitionSession(record: SessionRecord, nextState: SessionState): void {
	record.handle.state = nextState;
	record.handle.lastActivityAt = scheduler.now();
	if (record.history[record.history.length - 1] !== nextState) {
		record.history.push(nextState);
		record.events.push(`session:${record.handle.sessionId}:state=${nextState}`);
	}
}

function cloneSession(handle: AgentSessionHandle): AgentSessionHandle {
	return { ...handle };
}

function cloneBatch(batch: BatchHandle): BatchHandle {
	return {
		...batch,
		imageRefs: [...batch.imageRefs]
	};
}