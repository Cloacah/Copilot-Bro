#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function findLatestVsix() {
	const entries = existsSync(root)
		? readdirSync(root).filter((name) => /^copilot-bro-.+\.vsix$/u.test(name))
		: [];
	if (entries.length === 0) {
		return undefined;
	}
	const test = entries.filter((name) => name.includes("-test."));
	if (test.length > 0) {
		return path.join(root, test.sort((a, b) => b.localeCompare(a))[0]);
	}
	return path.join(root, entries.sort((a, b) => b.localeCompare(a))[0]);
}

function listVsix(vsixPath) {
	const vsceCli = path.join(root, "node_modules", "@vscode", "vsce", "vsce");
	return execFileSync(process.execPath, [vsceCli, "ls", vsixPath], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"]
	});
}

function assertDenyAbsent(listing, patterns, label) {
	for (const pattern of patterns) {
		const hit = listing.split(/\r?\n/).find((line) => pattern.test(line));
		if (hit) {
			throw new Error(`${label}: forbidden path matched ${pattern}: ${hit.trim()}`);
		}
	}
}

const vsixPath = process.argv[2] || findLatestVsix();
if (!vsixPath || !existsSync(vsixPath)) {
	console.error("check-vsix-contents: no VSIX found (pass path or package first).");
	process.exit(2);
}

const listing = listVsix(vsixPath);
const isTest = /-test\.vsix$/u.test(vsixPath);

const denyRelease = [
	/\bout\/test\//u,
	/\bout\/e2e\//u,
	/extension\/src\//u,
	/extension\/docs\//u,
	/VISION_EXECUTION_ANALYSIS/u
];

const denyTest = [
	/extension\/src\//u,
	/extension\/docs\//u,
	/VISION_EXECUTION_ANALYSIS/u
];

if (isTest) {
	assertDenyAbsent(listing, denyTest, "test VSIX");
} else {
	assertDenyAbsent(listing, denyRelease, "release VSIX");
}

console.log(`check-vsix-contents: OK (${path.basename(vsixPath)}, ${isTest ? "test" : "release"})`);
