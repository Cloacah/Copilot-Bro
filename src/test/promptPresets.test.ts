import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("built-in senior-engineer preset file exists and matches documented semantics", async () => {
	const presetPath = join(
		__dirname,
		"../../resources/prompts/senior-engineer.copilot-bro.prompt.md"
	);
	const content = await readFile(presetPath, "utf8");
	assert.match(content, /senior software engineer/i);
	assert.match(content, /architecture and conventions/i);
});
