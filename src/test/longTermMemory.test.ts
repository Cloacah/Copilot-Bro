import test from "node:test";
import assert from "node:assert/strict";
import {
	clearLongTermMemoryForTests,
	dedupeMemoryByKey,
	exportMemorySnapshot,
	getMemoryRecord,
	importMemorySnapshot,
	listMemoryRecords,
	purgeExpiredMemory,
	searchMemoryRecords,
	upsertMemoryRecord
} from "../memory/longTermMemory";

test("upsertMemoryRecord dedupes by workspace category+key", () => {
	clearLongTermMemoryForTests();
	const ws = "ws-a";
	upsertMemoryRecord({
		workspaceId: ws,
		category: "project-fact",
		key: "stack",
		content: "TypeScript extension"
	});
	const second = upsertMemoryRecord({
		workspaceId: ws,
		category: "project-fact",
		key: "stack",
		content: "TypeScript VS Code extension"
	});
	const listed = listMemoryRecords(ws);
	assert.equal(listed.length, 1);
	assert.equal(listed[0]?.id, second.id);
	assert.ok(listed[0]?.content.includes("VS Code"));
});

test("workspace isolation keeps buckets separate", () => {
	clearLongTermMemoryForTests();
	upsertMemoryRecord({ workspaceId: "ws-1", category: "user-preference", key: "lang", content: "zh" });
	upsertMemoryRecord({ workspaceId: "ws-2", category: "user-preference", key: "lang", content: "en" });
	assert.equal(listMemoryRecords("ws-1").length, 1);
	assert.equal(listMemoryRecords("ws-2").length, 1);
	assert.notEqual(listMemoryRecords("ws-1")[0]?.content, listMemoryRecords("ws-2")[0]?.content);
});

test("purgeExpiredMemory removes ttl-expired rows", () => {
	clearLongTermMemoryForTests();
	const ws = "ws-ttl";
	upsertMemoryRecord({
		workspaceId: ws,
		category: "long-task",
		key: "t1",
		content: "ephemeral",
		ttlMs: 1
	});
	const id = listMemoryRecords(ws)[0]?.id;
	assert.ok(id);
	return new Promise<void>((resolve, reject) => {
		setTimeout(() => {
			try {
				assert.equal(purgeExpiredMemory(ws), 1);
				assert.equal(getMemoryRecord(ws, id!), undefined);
				resolve();
			} catch (error) {
				reject(error);
			}
		}, 20);
	});
});

test("searchMemoryRecords matches content and respects limit", () => {
	clearLongTermMemoryForTests();
	const ws = "ws-search";
	upsertMemoryRecord({ workspaceId: ws, category: "vision-evidence", key: "e1", content: "screenshot_page bound" });
	upsertMemoryRecord({ workspaceId: ws, category: "project-fact", key: "p1", content: "unrelated" });
	const hits = searchMemoryRecords(ws, "screenshot", 5);
	assert.equal(hits.length, 1);
	assert.equal(hits[0]?.category, "vision-evidence");
});

test("export and import round-trip snapshot", () => {
	clearLongTermMemoryForTests();
	const ws = "ws-io";
	upsertMemoryRecord({ workspaceId: ws, category: "model-capability", key: "kimi", content: "moonshot v1 no keep" });
	const snap = exportMemorySnapshot(ws);
	clearLongTermMemoryForTests();
	const { imported, skipped } = importMemorySnapshot(snap);
	assert.equal(imported, 1);
	assert.equal(skipped, 0);
	assert.equal(listMemoryRecords(ws).length, 1);
});

test("dedupeMemoryByKey is no-op when keys are already canonical", () => {
	clearLongTermMemoryForTests();
	const ws = "ws-dedupe";
	upsertMemoryRecord({ workspaceId: ws, category: "user-preference", key: "theme", content: "dark" });
	assert.equal(dedupeMemoryByKey(ws), 0);
	upsertMemoryRecord({ workspaceId: ws, category: "user-preference", key: "theme", content: "light" });
	assert.equal(listMemoryRecords(ws).length, 1);
	assert.equal(dedupeMemoryByKey(ws), 0);
});
