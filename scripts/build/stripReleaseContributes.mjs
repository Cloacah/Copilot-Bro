/**
 * Produce a package.json suitable for release VSIX (no smoke UI or dev test scripts).
 */

const RELEASE_STRIP_SCRIPT_KEYS = new Set([
	"package",
	"package:release",
	"package:test",
	"package:verify",
	"package:verify-release",
	"package:verify-release:build",
	"package:vsix",
	"package:check",
	"build:vsix",
	"release:vsix",
	"install:vscode",
	"publish:marketplace",
	"clean",
	"watch",
	"lint",
	"test",
	"prepare:benchmark-screenshot"
]);

function shouldStripScriptKey(key) {
	if (RELEASE_STRIP_SCRIPT_KEYS.has(key)) {
		return true;
	}
	if (key.startsWith("test:") || key.includes("host-ui") || key.startsWith("readme:")) {
		return true;
	}
	return false;
}

/**
 * @param {Record<string, unknown>} pkg
 * @returns {Record<string, unknown>}
 */
export function stripHostUiSmokeContributes(pkg) {
	const copy = structuredClone(pkg);
	const contributes = /** @type {{ commands?: { command: string }[]; chatParticipants?: { id: string }[] }} */ (
		copy.contributes ?? {}
	);
	if (Array.isArray(contributes.commands)) {
		contributes.commands = contributes.commands.filter((entry) => !entry.command.includes("hostUiSmoke"));
	}
	if (Array.isArray(contributes.chatParticipants)) {
		contributes.chatParticipants = contributes.chatParticipants.filter((entry) => entry.id !== "bro-smoke");
	}
	copy.contributes = contributes;
	if (copy.scripts && typeof copy.scripts === "object") {
		const scripts = /** @type {Record<string, string>} */ (copy.scripts);
		for (const key of Object.keys(scripts)) {
			if (shouldStripScriptKey(key)) {
				delete scripts[key];
			}
		}
		if (typeof scripts.compile === "string" && scripts.compile.includes("clean")) {
			scripts.compile = "tsc -p ./";
		}
		copy.scripts = scripts;
	}
	return copy;
}
