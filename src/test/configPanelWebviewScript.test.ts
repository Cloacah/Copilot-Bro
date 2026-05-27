import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Webview script is embedded as a string in configPanel.ts — TypeScript-only syntax must not leak in.
 */
test("config panel embedded webview script must not contain TypeScript non-null assertions", () => {
	const sourcePath = path.join(__dirname, "..", "..", "src", "ui", "configPanel.ts");
	const source = readFileSync(sourcePath, "utf8");
	const scriptStart = source.indexOf("<script nonce=");
	const scriptEnd = source.indexOf("</script>", scriptStart);
	assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "config panel script block not found");
	const scriptBlock = source.slice(scriptStart, scriptEnd);
	assert.doesNotMatch(scriptBlock, /\[\d+\]!/u, "found TS non-null assertion in webview script");
	assert.match(scriptBlock, /modelVisionProxySelectionMode/, "model-level vision proxy mode select missing");
	assert.match(scriptBlock, /readModelVisionProxyPayload/, "model-level vision proxy payload reader missing");
});
