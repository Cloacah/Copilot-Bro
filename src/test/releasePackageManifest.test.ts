import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

/** Keep in sync with `scripts/build/stripReleaseContributes.mjs` → shouldStripScriptKey. */
function stripHostUiSmokeContributes<T extends {
	contributes: { commands: { command: string }[]; chatParticipants: { id: string }[] };
	scripts?: Record<string, string>;
}>(pkg: T): T {
	const copy = structuredClone(pkg);
	copy.contributes.commands = copy.contributes.commands.filter((entry) => !entry.command.includes("hostUiSmoke"));
	copy.contributes.chatParticipants = copy.contributes.chatParticipants.filter((entry) => entry.id !== "bro-smoke");
	if (copy.scripts) {
		for (const key of Object.keys(copy.scripts)) {
			if (
				key.startsWith("test:") ||
				key.includes("host-ui") ||
				key.startsWith("readme:") ||
				key === "package" ||
				key === "package:verify" ||
				key === "package:test" ||
				key === "package:release" ||
				key === "clean"
			) {
				delete copy.scripts[key];
			}
		}
	}
	return copy;
}

test("stripHostUiSmokeContributes removes smoke commands and chat participant", () => {
	const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
		contributes: { commands: { command: string }[]; chatParticipants: { id: string }[] };
		scripts?: Record<string, string>;
	};
	const stripped = stripHostUiSmokeContributes(pkg);
	assert.ok(stripped.contributes.commands.every((entry) => !entry.command.includes("hostUiSmoke")));
	assert.ok(stripped.contributes.commands.some((entry) => entry.command === "extendedModels.manage"));
	assert.ok(stripped.contributes.chatParticipants.every((entry) => entry.id !== "bro-smoke"));
	assert.ok(Object.keys(stripped.scripts ?? {}).every((key) => !key.startsWith("test:") && !key.includes("host-ui")));
	assert.ok(stripped.scripts?.compile, "release strip keeps compile for vscode:prepublish");
	assert.ok(stripped.scripts?.["vscode:prepublish"], "release strip keeps vscode:prepublish");
});
