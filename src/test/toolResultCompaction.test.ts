import test from "node:test";
import assert from "node:assert/strict";
import {
	compactToolResultText,
	shouldPreserveToolResultVerbatim
} from "../openaiCompat/toolResultCompaction";

test("compactToolResultText leaves small output unchanged", () => {
	const raw = "ok\nline2\n";
	const result = compactToolResultText(raw, { minCharsToCompact: 100 });
	assert.equal(result.compacted, false);
	assert.equal(result.text, raw);
});

test("shouldPreserveToolResultVerbatim keeps valid JSON tool payloads", () => {
	const json = JSON.stringify({ ok: true, items: [{ id: 1, name: "tile" }] });
	assert.equal(shouldPreserveToolResultVerbatim(json), true);
	assert.equal(shouldPreserveToolResultVerbatim('{"broken":'), false);
});

test("compactToolResultText preserves errors and tail for large terminal spam", () => {
	const lines = [
		"[unity] INFO: dismissing dialog",
		"[unity] INFO: dismissing dialog",
		"[unity] INFO: dismissing dialog",
		"ERROR: build failed with exit code 1",
		"... middle noise ...",
		"final command completed"
	];
	const filler = Array.from({ length: 400 }, (_, i) => `log line ${i}`).join("\n");
	const raw = `${lines.join("\n")}\n${filler}\n${lines.join("\n")}`;
	const result = compactToolResultText(raw, { minCharsToCompact: 200, maxChars: 8000 });
	assert.equal(result.compacted, true);
	assert.match(result.text, /ERROR: build failed/);
	assert.match(result.text, /final command completed/);
	assert.match(result.text, /repeated 3×/);
	assert.ok(result.text.length < raw.length);
});
