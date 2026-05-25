import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function findReleaseVsix(): string | undefined {
	const entries = readdirSync(root).filter((name) => /^copilot-bro-.+\.vsix$/u.test(name) && !name.includes("-test."));
	if (entries.length === 0) {
		return undefined;
	}
	return path.join(root, entries.sort((a, b) => b.localeCompare(a))[0]);
}

test("release VSIX listing excludes all packaged e2e outputs", () => {
	const vsixPath = findReleaseVsix();
	if (!vsixPath || !existsSync(vsixPath)) {
		return;
	}
	const vsceCli = path.join(root, "node_modules", "@vscode", "vsce", "vsce");
	const listing = execFileSync(process.execPath, [vsceCli, "ls", vsixPath], {
		cwd: root,
		encoding: "utf8"
	});
	assert.doesNotMatch(listing, /out\/e2e\//u);
});

