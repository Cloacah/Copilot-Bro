export type VisionEvidenceRoute = "proxy" | "native";
export type VisionEvidenceHandoff = "description" | "restoration";
export type VisionEvidenceTaskStatus = "pending" | "completed" | "failed";

export interface VisionEvidenceRecord {
	id: string;
	imageHash: string;
	route: VisionEvidenceRoute;
	handoff: VisionEvidenceHandoff;
	taskStatus: VisionEvidenceTaskStatus;
	modelId: string;
	proxyModelId?: string;
	description: string;
	createdAt: string;
	updatedAt: string;
}

const VISION_EVIDENCE_LIMIT = 128;
const evidenceStore = new Map<string, VisionEvidenceRecord>();

export function createVisionEvidenceId(imageHash: string): string {
	const normalizedHash = imageHash.trim();
	return normalizedHash ? `vision:${normalizedHash}` : "vision:unknown";
}

export function upsertVisionEvidenceRecord(
	record: Omit<VisionEvidenceRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
	now = new Date()
): VisionEvidenceRecord {
	const timestamp = now.toISOString();
	const id = record.id?.trim() || createVisionEvidenceId(record.imageHash);
	const existing = evidenceStore.get(id);
	const next: VisionEvidenceRecord = {
		...record,
		id,
		createdAt: existing?.createdAt ?? timestamp,
		updatedAt: timestamp
	};
	evidenceStore.set(id, next);
	trimEvidenceStore();
	return next;
}

export function getVisionEvidenceRecord(id: string): VisionEvidenceRecord | undefined {
	const record = evidenceStore.get(id.trim());
	return record ? { ...record } : undefined;
}

export function listVisionEvidenceRecords(): VisionEvidenceRecord[] {
	return Array.from(evidenceStore.values()).map((record) => ({ ...record }));
}

export function clearVisionEvidenceStoreForTests(): void {
	evidenceStore.clear();
}

function trimEvidenceStore(): void {
	while (evidenceStore.size > VISION_EVIDENCE_LIMIT) {
		const oldestKey = evidenceStore.keys().next().value;
		if (typeof oldestKey !== "string") {
			return;
		}
		evidenceStore.delete(oldestKey);
	}
}
