import test from "node:test";
import assert from "node:assert/strict";
import { collectAndCompactToolResultPartText } from "../openaiCompat/toolResultContent";

/** Shared by OpenAI-compat convertMessages and vscode LM wrapper transport. */
test("collectAndCompactToolResultPartText compacts oversized tool results", () => {
	const huge = `${"INFO: step\n".repeat(800)}ERROR: wrapped failed\n${"tail line\n".repeat(200)}`;
	const text = collectAndCompactToolResultPartText([{ value: huge }]);
	assert.match(text, /ERROR: wrapped failed/);
	assert.match(text, /Tool output was compacted/);
	assert.ok(text.length < huge.length);
});

test("collectAndCompactToolResultPartText preserves valid JSON tool payloads", () => {
	const payload = JSON.stringify({ ok: true, paths: ["a.ts"] });
	const text = collectAndCompactToolResultPartText([{ value: payload }]);
	assert.equal(text, payload);
});
