import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const tag = `v${pkg.version}`;
const vsix = path.join(root, `${pkg.name}-${pkg.version}.vsix`);

// Fail fast before a long pack; gh on Windows breaks with stdio: "ignore" (keyring).
ensureGh();

runNpm(["run", "package:vsix"]);

if (!existsSync(vsix)) {
	throw new Error(`VSIX not found: ${vsix}`);
}

const notes = releaseNotes(tag);
const hasRelease = commandSucceeds("gh", ["release", "view", tag]);

if (!hasRelease) {
	const notesFile = path.join(
		os.tmpdir(),
		`${pkg.name}-release-notes-${pkg.version}-${process.pid}.md`
	);
	writeFileSync(notesFile, notes, "utf8");
	try {
		run("gh", [
			"release",
			"create",
			tag,
			vsix,
			"--title",
			`${pkg.displayName ?? pkg.name} ${tag}`,
			"--notes-file",
			notesFile
		]);
	} finally {
		try {
			unlinkSync(notesFile);
		} catch {
			// ignore
		}
	}
} else {
	run("gh", ["release", "upload", tag, vsix, "--clobber"]);
}

console.log(`Published ${path.basename(vsix)} to GitHub Release ${tag}.`);

function runNpm(args) {
	// On Windows (including Git Bash), spawning npm without a shell often fails (ENOENT/EINVAL).
	// User-supplied text never flows through this call, so shell: true here is safe.
	const opts = { stdio: "inherit" };
	if (process.platform === "win32") {
		opts.shell = true;
	}
	execFileSync("npm", args, opts);
}

function run(command, args) {
	// Never use shell: true for gh on Windows — cmd.exe treats backticks in argv as command substitution.
	execFileSync(command, args, { stdio: "inherit" });
}

function commandSucceeds(command, args) {
	try {
		// Windows + GitHub CLI: stdio "ignore" (fd null) prevents keyring-backed auth; use "pipe".
		execFileSync(command, args, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

function ensureGh() {
	if (!commandSucceeds("gh", ["--version"])) {
		throw new Error("GitHub CLI is required. Install gh and run `gh auth login` first.");
	}
	if (!commandSucceeds("gh", ["auth", "status"])) {
		throw new Error("GitHub CLI is not authenticated. Run `gh auth login` first.");
	}
}

function releaseNotes(currentTag) {
	const changelogPath = path.join(root, "CHANGELOG.md");
	if (!existsSync(changelogPath)) {
		return fallbackNotes(currentTag);
	}

	const changelog = readFileSync(changelogPath, "utf8");
	const versionHeading = new RegExp(`^## \\[?${escapeRegExp(pkg.version)}\\]?.*$`, "m");
	const match = changelog.match(versionHeading);
	if (!match || match.index === undefined) {
		return fallbackNotes(currentTag);
	}

	const start = match.index + match[0].length;
	const rest = changelog.slice(start);
	const next = rest.search(/^## /m);
	const section = (next >= 0 ? rest.slice(0, next) : rest).trim();
	return section || fallbackNotes(currentTag);
}

function fallbackNotes(currentTag) {
	return [
		`# ${pkg.displayName ?? pkg.name} ${currentTag}`,
		"",
		"Packaged VSIX release.",
		"",
		"## Install",
		"",
		"Download the `.vsix` asset and run:",
		"",
		"```bash",
		`code --install-extension ${pkg.name}-${pkg.version}.vsix --force`,
		"```"
	].join("\n");
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
