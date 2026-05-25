import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const ignoreFile of [".vscodeignore", ".vscodeignore.test"]) {
	test(`${ignoreFile} keeps runtime dependencies packable`, () => {
		const content = readFileSync(resolve(__dirname, `../../${ignoreFile}`), "utf8");
		assert.doesNotMatch(content, /^node_modules\/\*\*$/m);
	});

	test(`${ignoreFile} excludes generated and source-only packaging noise`, () => {
		const content = readFileSync(resolve(__dirname, `../../${ignoreFile}`), "utf8");
		assert.match(content, /^src\/\*\*$/m);
		assert.match(content, /^scripts\/\*\*$/m);
		assert.match(content, /^docs\/\*\*$/m);
		assert.match(content, /^VISION_EXECUTION_ANALYSIS\.md$/m);
		assert.match(content, /^vision-artifacts\/\*\*$/m);
		assert.match(content, /^\*\.vsix$/m);
	});
}

test(".vscodeignore release excludes repo-root vision-artifacts and fixtures", () => {
	const content = readFileSync(resolve(__dirname, "../../.vscodeignore"), "utf8");
	assert.match(content, /^fixtures\/\*\*$/m);
});

test(".vscodeignore release excludes compiled test and all smoke e2e outputs", () => {
	const content = readFileSync(resolve(__dirname, "../../.vscodeignore"), "utf8");
	assert.match(content, /^out\/test\/\*\*$/m);
	assert.match(content, /^out\/e2e\/\*\*$/m);
	assert.match(content, /^out\/automation\/\*\*$/m);
});

test(".vscodeignore.test keeps smoke e2e driver but excludes compiled unit-test tree from VSIX", () => {
	const content = readFileSync(resolve(__dirname, "../../.vscodeignore.test"), "utf8");
	assert.doesNotMatch(content, /^out\/e2e\/driver\/\*\*$/m);
	assert.match(content, /^out\/test\/\*\*$/m);
	assert.doesNotMatch(content, /^!src\/test\/\*\*$/m);
	assert.doesNotMatch(content, /^!src\/e2e\/\*\*$/m);
});