#!/usr/bin/env node
/**
 * Verify release VSIX: no test/smoke artifacts, manifest clean, extension entry loadable paths.
 *
 * Usage:
 *   node scripts/verify-release-vsix.mjs [path/to/copilot-bro-x.y.z.vsix]
 *   node scripts/verify-release-vsix.mjs --build   # compile + package:release first
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { stripHostUiSmokeContributes } from "./stripReleaseContributes.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const shouldBuild = args.includes("--build");
const vsixArg = args.find((entry) => entry.endsWith(".vsix"));

function fail(message) {
	console.error(`verify-release-vsix: FAIL — ${message}`);
	process.exit(1);
}

function ok(message) {
	console.log(`verify-release-vsix: OK — ${message}`);
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

function findReleaseVsix() {
	if (vsixArg && existsSync(vsixArg)) {
		return path.resolve(vsixArg);
	}
	if (vsixArg) {
		fail(`VSIX not found: ${vsixArg}`);
	}
	const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
	const expected = path.join(root, `${pkg.name}-${pkg.version}.vsix`);
	if (existsSync(expected)) {
		return expected;
	}
	const entries = readdirSync(root).filter((name) => /^copilot-bro-.+\.vsix$/u.test(name) && !name.includes("-test."));
	if (entries.length === 0) {
		fail("no release VSIX found; run: npm run package:release");
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

function readZipEntry(vsixPath, entryName) {
	const escaped = vsixPath.replace(/'/g, "''");
	if (process.platform === "win32") {
		const ps = [
			"$ErrorActionPreference='Stop'",
			"Add-Type -AssemblyName System.IO.Compression.FileSystem",
			`$z=[IO.Compression.ZipFile]::OpenRead('${escaped}')`,
			`$e=$z.GetEntry('${entryName}')`,
			"if ($null -eq $e) { $z.Dispose(); exit 2 }",
			"$r=New-Object IO.StreamReader($e.Open())",
			"$r.ReadToEnd()",
			"$r.Close()",
			"$z.Dispose()"
		].join("; ");
		try {
			return execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
		} catch (error) {
			const status = /** @type {{ status?: number }} */ (error).status;
			if (status === 2) {
				return undefined;
			}
			throw error;
		}
	}
	try {
		return execFileSync("unzip", ["-p", vsixPath, entryName], { encoding: "utf8" });
	} catch {
		return undefined;
	}
}

function readPackagedManifest(vsixPath) {
	const candidates = ["extension/package.json", "package.json"];
	for (const entry of candidates) {
		const text = readZipEntry(vsixPath, entry);
		if (text) {
			return JSON.parse(text);
		}
	}
	fail("package.json missing inside VSIX");
}

/** Extension-owned paths only (ignore dependency test folders under node_modules). */
const FORBIDDEN_LINE_PATTERNS = [
	{ re: /^out\/test\//u, label: "compiled unit tests" },
	{ re: /^out\/e2e\//u, label: "E2E outputs" },
	{ re: /^out\/automation\//u, label: "legacy automation output" },
	{ re: /^out\/hostUiSmoke/u, label: "legacy hostUiSmoke at out root" },
	{ re: /^fixtures\//u, label: "repo fixtures directory" },
	{ re: /^vision-artifacts\//u, label: "vision-artifacts" },
	{ re: /^artifacts\//u, label: "artifacts" },
	{ re: /^src\//u, label: "TypeScript sources" },
	{ re: /^test\//u, label: "test tree at package root" },
	{ re: /^scripts\//u, label: "scripts" },
	{ re: /^docs\//u, label: "docs" },
	{ re: /^plan\//u, label: "plan" },
	{ re: /^\.tools\//u, label: ".tools" }
];

const REQUIRED_LINES = [/^out\/extension\.js$/u];

function assertListingClean(listing) {
	const lines = listing.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
	const hits = [];
	for (const line of lines) {
		for (const rule of FORBIDDEN_LINE_PATTERNS) {
			if (rule.re.test(line)) {
				hits.push({ line, label: rule.label });
			}
		}
	}
	if (hits.length > 0) {
		const sample = hits.slice(0, 12).map((h) => `  [${h.label}] ${h.line}`).join("\n");
		fail(`forbidden paths in VSIX (${hits.length} hits):\n${sample}`);
	}
	for (const required of REQUIRED_LINES) {
		if (!lines.some((line) => required.test(line))) {
			fail(`missing required file in VSIX listing: ${String(required)}`);
		}
	}
}

function assertManifestClean(manifest) {
	const commands = manifest.contributes?.commands ?? [];
	const smokeCommands = commands.filter((c) => String(c.command).includes("hostUiSmoke"));
	if (smokeCommands.length > 0) {
		fail(`contributes.commands still lists smoke: ${smokeCommands.map((c) => c.command).join(", ")}`);
	}
	const participants = manifest.contributes?.chatParticipants ?? [];
	if (participants.some((p) => p.id === "bro-smoke")) {
		fail("contributes.chatParticipants still lists bro-smoke");
	}
	const scripts = manifest.scripts ?? {};
	const badScriptKeys = Object.keys(scripts).filter((key) => {
		if (key.startsWith("test:") || key.includes("host-ui") || key.startsWith("readme:")) {
			return true;
		}
		return (
			key === "package" ||
			key === "package:verify" ||
			key === "package:test" ||
			key === "package:release" ||
			key === "package:verify-release" ||
			key === "package:verify-release:build" ||
			key === "clean"
		);
	});
	if (badScriptKeys.length > 0) {
		fail(`package.json scripts still contain test/smoke entries: ${badScriptKeys.join(", ")}`);
	}
	const stripped = stripHostUiSmokeContributes(
		JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
	);
	const strippedScriptKeys = Object.keys(stripped.scripts ?? {}).filter(
		(key) => key.startsWith("test:") || key.includes("host-ui")
	);
	if (strippedScriptKeys.length > 0) {
		fail(`stripReleaseContributes failed to remove scripts: ${strippedScriptKeys.join(", ")}`);
	}
}

function assertWorkspaceExtensionEntry() {
	const extensionJs = path.join(root, "out", "extension.js");
	if (!existsSync(extensionJs)) {
		fail("out/extension.js missing; run: npm run compile");
	}
	const text = readFileSync(extensionJs, "utf8");
	if (/e2e\/driver\/hostUiSmokeEnv/u.test(text)) {
		fail("out/extension.js still requires e2e/driver/hostUiSmokeEnv");
	}
	const staticE2eRequires = [...text.matchAll(/require\("\.\/e2e\/hostUi\/[^"]+"\)/gu)].map((match) => match[0]);
	if (staticE2eRequires.length > 0) {
		fail(`out/extension.js statically requires e2e hostUi: ${staticE2eRequires.join(", ")}`);
	}
	if (!/extensionSmokeActivation/u.test(text)) {
		fail("out/extension.js must dynamically load extensionSmokeActivation when smoke mode is enabled");
	}
}

function assertCompileLayout() {
	const outRoot = path.join(root, "out");
	if (!existsSync(outRoot)) {
		fail("out/ missing; run: npm run compile");
	}
	const staleRoot = readdirSync(outRoot).filter((name) => /^hostUiSmoke/u.test(name) && name.endsWith(".js"));
	if (staleRoot.length > 0) {
		fail(`stale out/*.js smoke files: ${staleRoot.join(", ")}`);
	}
	if (existsSync(path.join(outRoot, "automation"))) {
		fail("stale out/automation/ still exists after clean compile");
	}
}

function main() {
	if (shouldBuild) {
		runNpm("package:release");
	}
	const vsixPath = findReleaseVsix();
	if (/-test\.vsix$/u.test(vsixPath)) {
		fail(`refusing test VSIX: ${path.basename(vsixPath)}`);
	}

	console.log(`verify-release-vsix: checking ${path.basename(vsixPath)}`);

	assertCompileLayout();
	assertWorkspaceExtensionEntry();

	execFileSync(process.execPath, [path.join(root, "scripts", "build", "check-vsix-contents.mjs"), vsixPath], {
		cwd: root,
		stdio: "inherit"
	});

	const listing = listVsix(vsixPath);
	assertListingClean(listing);

	const manifest = readPackagedManifest(vsixPath);
	assertManifestClean(manifest);

	ok(`release VSIX ${path.basename(vsixPath)} — listing, manifest, and extension entry checks passed`);
}

main();
