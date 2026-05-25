#!/usr/bin/env node
/**
 * Build release + test VSIX and run contents deny checks on both artifacts.
 * Release VSIX excludes out/e2e/driver (and out/test); smoke commands may still
 * be compiled into out/extension.js — that is intentional (see src/e2e/README.md).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const releaseVsix = path.join(root, `${pkg.name}-${pkg.version}.vsix`);
const testVsix = path.join(root, `${pkg.name}-${pkg.version}-test.vsix`);

function runNode(script, args = []) {
	execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
}

function runNpm(script) {
	if (process.platform === "win32") {
		execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm run ${script}`], {
			cwd: root,
			stdio: "inherit"
		});
		return;
	}
	execFileSync("npm", ["run", script], { cwd: root, stdio: "inherit" });
}

runNpm("compile");
runNode(path.join(root, "scripts", "build", "package-vsix.mjs"), ["release"]);
runNode(path.join(root, "scripts", "build", "check-vsix-contents.mjs"), [releaseVsix]);
runNode(path.join(root, "scripts", "build", "verify-release-vsix.mjs"), [releaseVsix]);
runNode(path.join(root, "scripts", "build", "package-vsix.mjs"), ["test"]);
runNode(path.join(root, "scripts", "build", "check-vsix-contents.mjs"), [testVsix]);
console.log("verify-vsix-packages: OK (release + test VSIX contents verified)");
