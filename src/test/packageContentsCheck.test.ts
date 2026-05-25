import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

test("package:check passes on latest test VSIX when present", () => {
	const root = path.resolve(__dirname, "..", "..");
	const script = path.join(root, "scripts", "build", "check-vsix-contents.mjs");
	const vsix = path.join(root, "copilot-bro-0.1.9-test.vsix");
	if (!existsSync(vsix)) {
		return;
	}
	const output = execFileSync(process.execPath, [script, vsix], {
		cwd: root,
		encoding: "utf8"
	});
	assert.match(output, /check-vsix-contents: OK/);
});
