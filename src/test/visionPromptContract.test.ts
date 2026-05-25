import test from "node:test";
import assert from "node:assert/strict";
import { buildVisionPromptContract, prependVisionPromptContract } from "../toolCooperation/visionPromptContract";

test("F.2 vision prompt contract contains all required fields", () => {
	const contract = buildVisionPromptContract("v2");
	assert.match(contract, /\[vision-prompt-contract-v1\]/);
	assert.match(contract, /spatialSchemaVersion=v2/);
	assert.match(contract, /## Post-Proxy Handoff \[required\]/);
	assert.match(contract, /\[vision-proxy-evidence\]/);
	assert.match(contract, /\[text-fallback\], \[plan-only\], or \[disabled\]/);
	assert.match(contract, /call view_image/);
	assert.match(contract, /## Step 2: ROI Localization \[required\]/);
	assert.match(contract, /roiLocalization:/);
	assert.match(contract, /maskGuidance:/);
	assert.match(contract, /edgeIssues:/);
	assert.match(contract, /transformHints:/);
	assert.match(contract, /styleConstraints:/);
});

test("F.2 prependVisionPromptContract injects once only when vision is needed", () => {
	const base = [{ role: "user", content: "describe screenshot" }] as const;
	const injected = prependVisionPromptContract([...base], { spatialSchemaVersion: "v1" }, true);
	assert.equal(injected.length, 2);
	assert.equal(injected[0].role, "system");
	assert.match(String(injected[0].content), /vision-prompt-contract-v1/);

	const reinjected = prependVisionPromptContract(injected, { spatialSchemaVersion: "v1" }, true);
	assert.equal(reinjected.length, 2);

	const skipped = prependVisionPromptContract([...base], { spatialSchemaVersion: "v1" }, false);
	assert.deepEqual(skipped, base);
});
