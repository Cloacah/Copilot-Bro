/**
 * In-session long-term memory (design influenced by retrieval/summary patterns in
 * claude-mem and context-budget ideas in rtk — reimplemented in TypeScript; no code copied).
 */
export type MemoryCategory =
	| "project-fact"
	| "user-preference"
	| "vision-evidence"
	| "long-task"
	| "model-capability";

export interface MemoryRecord {
	readonly id: string;
	readonly workspaceId: string;
	readonly category: MemoryCategory;
	/** Dedupe key within workspace + category. */
	readonly key: string;
	readonly content: string;
	readonly estimatedTokens: number;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly expiresAt?: number;
	readonly tags?: readonly string[];
}

export interface UpsertMemoryInput {
	readonly workspaceId: string;
	readonly category: MemoryCategory;
	readonly key: string;
	readonly content: string;
	readonly estimatedTokens?: number;
	readonly ttlMs?: number;
	readonly tags?: readonly string[];
}

export interface MemorySearchOptions {
	readonly category?: MemoryCategory;
	readonly query?: string;
	readonly limit?: number;
	readonly includeExpired?: boolean;
}

export interface LongTermMemoryStoreOptions {
	readonly maxEntriesPerWorkspace?: number;
}

const DEFAULT_MAX_ENTRIES = 512;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const store = new Map<string, Map<string, MemoryRecord>>();

function estimateMemoryTokens(content: string): number {
	return Math.max(1, Math.ceil(content.trim().length / 4));
}

function workspaceBucket(workspaceId: string): Map<string, MemoryRecord> {
	const id = workspaceId.trim() || "global";
	let bucket = store.get(id);
	if (!bucket) {
		bucket = new Map();
		store.set(id, bucket);
	}
	return bucket;
}

function isExpired(record: MemoryRecord, now = Date.now()): boolean {
	return typeof record.expiresAt === "number" && record.expiresAt <= now;
}

function touchLru(bucket: Map<string, MemoryRecord>, record: MemoryRecord): void {
	bucket.delete(record.id);
	bucket.set(record.id, record);
}

function enforceLruCap(bucket: Map<string, MemoryRecord>, maxEntries: number): void {
	while (bucket.size > maxEntries) {
		const oldestKey = bucket.keys().next().value as string | undefined;
		if (!oldestKey) {
			break;
		}
		bucket.delete(oldestKey);
	}
}

export function upsertMemoryRecord(
	input: UpsertMemoryInput,
	options: LongTermMemoryStoreOptions = {}
): MemoryRecord {
	const now = Date.now();
	const bucket = workspaceBucket(input.workspaceId);
	const maxEntries = options.maxEntriesPerWorkspace ?? DEFAULT_MAX_ENTRIES;
	const existing = [...bucket.values()].find(
		(r) => r.category === input.category && r.key === input.key && !isExpired(r, now)
	);
	const id = existing?.id ?? `mem_${now}_${Math.random().toString(36).slice(2, 10)}`;
	const record: MemoryRecord = {
		id,
		workspaceId: input.workspaceId.trim() || "global",
		category: input.category,
		key: input.key.trim(),
		content: input.content.trim(),
		estimatedTokens: input.estimatedTokens ?? estimateMemoryTokens(input.content),
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		expiresAt: input.ttlMs === undefined ? existing?.expiresAt : now + Math.max(0, input.ttlMs),
		tags: input.tags
	};
	if (existing) {
		bucket.delete(existing.id);
	}
	bucket.set(record.id, record);
	touchLru(bucket, record);
	enforceLruCap(bucket, maxEntries);
	return record;
}

export function getMemoryRecord(workspaceId: string, id: string): MemoryRecord | undefined {
	const record = workspaceBucket(workspaceId).get(id);
	if (!record || isExpired(record)) {
		return undefined;
	}
	return record;
}

export function deleteMemoryRecord(workspaceId: string, id: string): boolean {
	return workspaceBucket(workspaceId).delete(id);
}

export function listMemoryRecords(workspaceId: string, options: MemorySearchOptions = {}): MemoryRecord[] {
	const now = Date.now();
	const query = options.query?.trim().toLowerCase();
	const limit = options.limit ?? Number.POSITIVE_INFINITY;
	const out: MemoryRecord[] = [];
	for (const record of workspaceBucket(workspaceId).values()) {
		if (!options.includeExpired && isExpired(record, now)) {
			continue;
		}
		if (options.category && record.category !== options.category) {
			continue;
		}
		if (query) {
			const haystack = `${record.key} ${record.content} ${(record.tags ?? []).join(" ")}`.toLowerCase();
			if (!haystack.includes(query)) {
				continue;
			}
		}
		out.push(record);
	}
	out.sort((a, b) => b.updatedAt - a.updatedAt);
	return out.slice(0, limit);
}

export function searchMemoryRecords(
	workspaceId: string,
	query: string,
	limit = 20
): MemoryRecord[] {
	return listMemoryRecords(workspaceId, { query, limit });
}

export function purgeExpiredMemory(workspaceId: string): number {
	const bucket = workspaceBucket(workspaceId);
	let removed = 0;
	for (const [id, record] of bucket) {
		if (isExpired(record)) {
			bucket.delete(id);
			removed += 1;
		}
	}
	return removed;
}

export function dedupeMemoryByKey(workspaceId: string): number {
	const bucket = workspaceBucket(workspaceId);
	const winners = new Map<string, MemoryRecord>();
	for (const record of bucket.values()) {
		if (isExpired(record)) {
			continue;
		}
		const compound = `${record.category}\0${record.key}`;
		const prev = winners.get(compound);
		if (!prev || record.updatedAt > prev.updatedAt) {
			winners.set(compound, record);
		}
	}
	let removed = 0;
	for (const record of [...bucket.values()]) {
		const compound = `${record.category}\0${record.key}`;
		const winner = winners.get(compound);
		if (winner && winner.id !== record.id) {
			bucket.delete(record.id);
			removed += 1;
		}
	}
	return removed;
}

export function summarizeMemoryRecords(records: readonly MemoryRecord[], maxChars = 400): string {
	if (records.length === 0) {
		return "";
	}
	const lines = records.map((r) => `[${r.category}] ${r.key}: ${r.content}`);
	let text = lines.join("\n");
	if (text.length > maxChars) {
		text = `${text.slice(0, maxChars - 3)}...`;
	}
	return text;
}

export interface MemorySnapshot {
	readonly workspaceId: string;
	readonly exportedAt: number;
	readonly records: MemoryRecord[];
}

export function exportMemorySnapshot(workspaceId: string): MemorySnapshot {
	purgeExpiredMemory(workspaceId);
	return {
		workspaceId: workspaceId.trim() || "global",
		exportedAt: Date.now(),
		records: listMemoryRecords(workspaceId, { includeExpired: false })
	};
}

export function importMemorySnapshot(
	snapshot: MemorySnapshot,
	options: LongTermMemoryStoreOptions = {}
): { imported: number; skipped: number } {
	let imported = 0;
	let skipped = 0;
	for (const record of snapshot.records) {
		if (!record.key?.trim() || !record.content?.trim()) {
			skipped += 1;
			continue;
		}
		upsertMemoryRecord(
			{
				workspaceId: snapshot.workspaceId,
				category: record.category,
				key: record.key,
				content: record.content,
				estimatedTokens: record.estimatedTokens,
				tags: record.tags
			},
			options
		);
		imported += 1;
	}
	return { imported, skipped };
}

export function getMemoryStoreStats(workspaceId: string): {
	total: number;
	expired: number;
	byCategory: Record<MemoryCategory, number>;
} {
	const bucket = workspaceBucket(workspaceId);
	const byCategory: Record<MemoryCategory, number> = {
		"project-fact": 0,
		"user-preference": 0,
		"vision-evidence": 0,
		"long-task": 0,
		"model-capability": 0
	};
	let expired = 0;
	for (const record of bucket.values()) {
		if (isExpired(record)) {
			expired += 1;
			continue;
		}
		byCategory[record.category] += 1;
	}
	return { total: bucket.size, expired, byCategory };
}

/** Test-only reset. */
export function clearLongTermMemoryForTests(): void {
	store.clear();
}

export const DEFAULT_MEMORY_TTL_MS = DEFAULT_TTL_MS;
