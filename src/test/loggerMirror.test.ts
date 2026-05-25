import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendMirroredLogLine, resolveMirroredLogFilePath } from "../loggerMirror";

test("resolveMirroredLogFilePath returns undefined for missing or blank env values", () => {
	assert.equal(resolveMirroredLogFilePath({}), undefined);
	assert.equal(resolveMirroredLogFilePath({ COPILOT_BRO_LOG_FILE: "   " }), undefined);
});

test("resolveMirroredLogFilePath prefers configured workspace setting values", () => {
	const resolved = resolveMirroredLogFilePath({}, " ./artifacts/host-ui/workspace-log.txt ");
	assert.equal(resolved?.endsWith(path.join("artifacts", "host-ui", "workspace-log.txt")), true);
});

test("appendMirroredLogLine creates parent folders and appends lines", () => {
	const tempDir = mkdtempSync(path.join(os.tmpdir(), "copilot-bro-log-mirror-"));
	const filePath = path.join(tempDir, "nested", "automation.log");

	try {
		appendMirroredLogLine(filePath, "first line");
		appendMirroredLogLine(filePath, "second line");
		assert.equal(readFileSync(filePath, "utf8"), "first line\nsecond line\n");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});