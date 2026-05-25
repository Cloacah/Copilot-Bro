import test from "node:test";
import assert from "node:assert/strict";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import { access } from "node:fs/promises";
import {
	assertHostUiSmokeChatScreenshotBenchmarkExists,
	resolveHostUiSmokeRepoRoot,
	resolveHostUiSmokeTestButtonPath,
	expandHostUiSmokeIntegrationPrompt,
	HOST_UI_SMOKE_BUTTON_PATH_PLACEHOLDER
} from "../e2e/hostUi/fixtures/vision";
import { runHostUiSmokeP7RestoreArtifactProbe } from "../e2e/hostUi/probes/p7RestoreProbe";
import { assertIntegrationScenarioCoversPlanPhases } from "../e2e/hostUi/chat/planCoverage";
import { HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL } from "../e2e/hostUi/chat/integration";

test("testButtons/按钮1.png exists in repo", async () => {
	const assetPath = resolveHostUiSmokeTestButtonPath({
		COPILOT_BRO_UI_SMOKE_REPO_ROOT: resolveHostUiSmokeRepoRoot()
	});
	await access(assetPath);
});

test("chat-screenshot-benchmark.png exists for p7 chat benchmark integration", async () => {
	const benchmarkPath = await assertHostUiSmokeChatScreenshotBenchmarkExists({
		COPILOT_BRO_UI_SMOKE_REPO_ROOT: resolveHostUiSmokeRepoRoot()
	});
	await access(benchmarkPath);
});

test("expandHostUiSmokeIntegrationPrompt replaces button path placeholder", () => {
	const repoRoot = resolveHostUiSmokeRepoRoot();
	const expanded = expandHostUiSmokeIntegrationPrompt(
		`path=${HOST_UI_SMOKE_BUTTON_PATH_PLACEHOLDER}`,
		{ COPILOT_BRO_UI_SMOKE_REPO_ROOT: repoRoot }
	);
	assert.ok(!expanded.includes(HOST_UI_SMOKE_BUTTON_PATH_PLACEHOLDER));
	assert.ok(expanded.includes("testButtons"));
	assert.ok(expanded.includes("按钮1.png"));
});

test("p7 restore artifact probe persists non-placeholder SVG with sha256", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const lines: string[] = [];
	const logger = {
		info: (message: string, data?: unknown) => {
			lines.push(`${message} ${JSON.stringify(data ?? {})}`);
		},
		warn: (message: string, data?: unknown) => {
			lines.push(`${message} ${JSON.stringify(data ?? {})}`);
		}
	};
	const result = await runHostUiSmokeP7RestoreArtifactProbe(logger);
	assert.equal(result.ok, true);
	assert.ok(result.svgBytes > 0);
	assert.equal(result.rejectedPlaceholder, false);
	assert.match(result.artifactSha256 ?? "", /^[a-f0-9]{64}$/u);
	assert.ok(result.artifactFilePath?.includes("vision-artifacts"));
	assert.match(lines.join("\n"), /host-ui-smoke\.p7\.restore-artifact\.probe\.end/u);
	assert.match(lines.join("\n"), /host-ui-smoke\.p7\.raster\.vectorize/u);
	assert.match(lines.join("\n"), /host-ui-smoke\.p7\.restore\.fidelity\.report/u);
	assert.equal(result.rasterEngine, "imagetracerjs");
	assert.ok((result.rasterPathCount ?? 0) > 0);
	assert.equal(result.restoreSimilarityPassed, true);
	assert.ok((result.restoreSsim ?? 0) >= 0.99);
	assert.match(lines.join("\n"), /host-ui-smoke\.p7\.restore\.similarity/u);
});

test("p6/p7 chat scenarios satisfy plan phase markers", () => {
	for (const id of [
		"p6-path-hydration-chat",
		"p7-restore-artifact-chat",
		"p7-chat-benchmark-web-restore"
	] as const) {
		const scenario = HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.find((entry) => entry.id === id);
		assert.ok(scenario, id);
		const issues = assertIntegrationScenarioCoversPlanPhases(scenario!);
		assert.deepEqual(issues, [], issues.join("; "));
	}
});
