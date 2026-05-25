const { spawnSync } = require("node:child_process");

const variableName = process.argv[2];
const sentinel = process.argv[3] ?? "__COPILOT_BRO_UI_SMOKE_ENV_MISSING__";

if (!variableName) {
	process.exit(1);
}

const value = process.env[variableName] || sentinel;
const result = spawnSync("clip", {
	input: value,
	encoding: "utf8",
	stdio: ["pipe", "ignore", "ignore"]
});

if (typeof result.status === "number") {
	process.exit(result.status);
}

if (result.error) {
	throw result.error;
}