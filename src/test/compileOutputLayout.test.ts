import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outRoot = path.join(root, "out");

test("compile output has no legacy hostUiSmoke files at out root or out/automation", () => {
	const staleRoot = readdirSync(outRoot).filter((name) => /^hostUiSmoke/u.test(name) && name.endsWith(".js"));
	assert.deepEqual(staleRoot, [], `stale out root smoke files: ${staleRoot.join(", ")}`);
	const automationDir = path.join(outRoot, "automation");
	assert.equal(existsSync(automationDir), false, "out/automation should not exist after clean compile");
	assert.ok(existsSync(path.join(outRoot, "smokeLogBridge", "smokeLogEvidence.js")));
	assert.ok(existsSync(path.join(outRoot, "e2e", "hostUi", "extensionSmokeChat.js")));
	assert.ok(existsSync(path.join(outRoot, "e2e", "hostUi", "env.js")));
	assert.ok(existsSync(path.join(outRoot, "e2e", "driver", "hostUiSmoke.js")));
});
