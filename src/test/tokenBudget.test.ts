import test from "node:test";
import assert from "node:assert/strict";
import {
	computeEffectiveInputTokenBudget,
	promptToContextPressure,
	selectGreedyPrefixWithinTokenBudget
} from "../tokenBudget";
import type { ModelConfig } from "../types";

const baseModel: ModelConfig = {
	id: "m",
	displayName: "m",
	provider: "deepseek",
	baseUrl: "https://example.com",
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

test("computeEffectiveInputTokenBudget subtracts capped max output", () => {
	const budget = computeEffectiveInputTokenBudget(baseModel);
	assert.ok(budget > 0);
	assert.ok(budget < baseModel.contextLength);
});

test("promptToContextPressure crosses warn threshold near budget", () => {
	const budget = computeEffectiveInputTokenBudget(baseModel);
	const low = promptToContextPressure(Math.floor(budget * 0.5), baseModel);
	const high = promptToContextPressure(Math.floor(budget * 0.95), baseModel);
	assert.ok(low < 0.88);
	assert.ok(high >= 0.88);
});

test("selectGreedyPrefixWithinTokenBudget retains ordered prefix within ceiling", () => {
	const { retained, dropped, totalRetainedTokens } = selectGreedyPrefixWithinTokenBudget(
		[
			{ id: "a", estimatedTokens: 10 },
			{ id: "b", estimatedTokens: 20 },
			{ id: "c", estimatedTokens: 5 }
		],
		30
	);
	assert.deepEqual(
		retained.map((s) => s.id),
		["a", "b"]
	);
	assert.deepEqual(
		dropped.map((s) => s.id),
		["c"]
	);
	assert.equal(totalRetainedTokens, 30);
});

test("selectGreedyPrefixWithinTokenBudget empty input", () => {
	const r = selectGreedyPrefixWithinTokenBudget([], 100);
	assert.deepEqual(r.retained, []);
	assert.deepEqual(r.dropped, []);
	assert.equal(r.totalRetainedTokens, 0);
});

test("selectGreedyPrefixWithinTokenBudget zero budget retains nothing", () => {
	const r = selectGreedyPrefixWithinTokenBudget([{ id: "x", estimatedTokens: 1 }], 0);
	assert.deepEqual(r.retained, []);
	assert.deepEqual(r.dropped.map((s) => s.id), ["x"]);
	assert.equal(r.totalRetainedTokens, 0);
});

test("selectGreedyPrefixWithinTokenBudget rejects invalid maxTokens", () => {
	assert.throws(() => selectGreedyPrefixWithinTokenBudget([], -1), RangeError);
	assert.throws(() => selectGreedyPrefixWithinTokenBudget([], Number.NaN), RangeError);
});

test("selectGreedyPrefixWithinTokenBudget rejects invalid slice size", () => {
	assert.throws(
		() =>
			selectGreedyPrefixWithinTokenBudget(
				[
					{ id: "bad", estimatedTokens: -1 }
				],
				10
			),
		RangeError
	);
});
