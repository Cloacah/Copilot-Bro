import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

test("release extension entry imports hostUi env from packaged hostUi tree not driver", () => {
	const extensionJs = readFileSync(path.join(root, "out/extension.js"), "utf8");
	assert.match(extensionJs, /e2e\/hostUi\/env/u);
	assert.doesNotMatch(extensionJs, /e2e\/driver\/hostUiSmokeEnv/u);
});

test("release vscodeignore excludes all compiled e2e outputs", () => {
	const ignore = readFileSync(path.join(root, ".vscodeignore"), "utf8");
	assert.match(ignore, /^out\/e2e\/\*\*$/m);
	assert.doesNotMatch(ignore, /^out\/e2e\/driver\/\*\*$/m);
});
