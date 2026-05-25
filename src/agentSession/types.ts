export type SessionState = "Created" | "Ready" | "Busy" | "Closing" | "Closed" | "Error";
export type BatchState = "Pending" | "Running" | "Done" | "Failed";

export interface AgentSessionHandle {
	sessionId: string;
	state: SessionState;
	createdAt: number;
	lastActivityAt: number;
	concurrencyLimit: number;
	resetContextPerBatch: boolean;
	activeBatchId?: string;
}

export interface BatchHandle {
	batchId: string;
	sessionId: string;
	state: BatchState;
	imageRefs: string[];
	batchIndex: number;
	concurrencySlot: number;
	createdAt: number;
	lastUpdatedAt: number;
}

export interface BatchContextSnapshot {
	protocolSeed: string[];
	inheritedImageRefs: string[];
}