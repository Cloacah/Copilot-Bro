import test from "node:test";
import assert from "node:assert/strict";
import {
	applyLongTermMemoryBudget,
	selectMemoryForPromptBudget
} from "../memory/memoryTokenBudget";
import { clearLongTermMemoryForTests, upsertMemoryRecord } from "../memory/longTermMemory";
import type { ModelConfig } from "../types";

const model: ModelConfig = {
	id: "deepseek-v4-flash",
	displayName: "DeepSeek v4 Flash",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	contextLength: 100_000,
	maxCompletionTokens: 8000,
	maxOutputTokens: 8000,
	temperature: 1,
	topP: 1,
	toolCalling: false,
	vision: false,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: [],
	family: "oai-compatible"
};

test("selectMemoryForPromptBudget retains prefix within memory share", () => {
	clearLongTermMemoryForTests();
	const ws = "ws-budget";
	for (let i = 0; i < 12; i += 1) {
		upsertMemoryRecord({
			workspaceId: ws,
			category: "project-fact",
			key: `fact-${i}`,
			content: `fact number ${i} `.repeat(40),
			estimatedTokens: 400
		});
	}
	const selection = selectMemoryForPromptBudget({
		workspaceId: ws,
		model,
		reservedPromptTokens: 0,
		maxMemoryShare: 0.02
	});
	assert.ok(selection.retained.length > 0);
	assert.ok(selection.dropped.length > 0, "expected greedy drop when memory share is tight");
	assert.ok(selection.totalRetainedTokens <= selection.memoryTokenBudget + 1);
});

test("applyLongTermMemoryBudget prepends system memory block without dropping user messages", () => {
	clearLongTermMemoryForTests();
	const ws = "ws-inject";
	upsertMemoryRecord({
		workspaceId: ws,
		category: "user-preference",
		key: "reply",
		content: "Prefer concise answers",
		estimatedTokens: 10
	});
	const { messages, selection } = applyLongTermMemoryBudget(
		[{ role: "user", content: "hello" }],
		model,
		ws,
		100
	);
	assert.ok(selection.injectionText.includes("copilot-bro-memory"));
	assert.equal(messages.length, 2);
	assert.equal(messages[0]?.role, "system");
	assert.ok(String(messages[0]?.content).includes("concise"));
	assert.equal(messages[1]?.role, "user");
});

test("selectMemoryForPromptBudget is stable for same model and records", () => {
	clearLongTermMemoryForTests();
	const ws = "ws-stable";
	upsertMemoryRecord({ workspaceId: ws, category: "long-task", key: "a", content: "alpha", estimatedTokens: 50 });
	upsertMemoryRecord({ workspaceId: ws, category: "long-task", key: "b", content: "beta", estimatedTokens: 50 });
	const a = selectMemoryForPromptBudget({ workspaceId: ws, model, reservedPromptTokens: 500 });
	const b = selectMemoryForPromptBudget({ workspaceId: ws, model, reservedPromptTokens: 500 });
	assert.deepEqual(
		a.retained.map((r) => r.id),
		b.retained.map((r) => r.id)
	);
});
