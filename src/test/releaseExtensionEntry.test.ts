import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

test("release extension entry does not statically bundle e2e hostUi modules", () => {
	const extensionJs = readFileSync(path.join(root, "out/extension.js"), "utf8");
	const staticE2eRequires = [...extensionJs.matchAll(/require\("\.\/e2e\/hostUi\/[^"]+"\)/gu)].map((match) => match[0]);
	assert.deepEqual(staticE2eRequires, [], `unexpected static e2e requires: ${staticE2eRequires.join(", ")}`);
	assert.doesNotMatch(extensionJs, /e2e\/driver\/hostUiSmokeEnv/u);
	assert.match(extensionJs, /extensionSmokeActivation/u);
});

test("release vscodeignore excludes all compiled e2e outputs", () => {
	const ignore = readFileSync(path.join(root, ".vscodeignore"), "utf8");
	assert.match(ignore, /^out\/e2e\/\*\*$/m);
	assert.doesNotMatch(ignore, /^out\/e2e\/driver\/\*\*$/m);
});
