import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

/** p11: critical plan artifacts must exist and reference live modules. */
const REQUIRED_PATHS = [
	"plan/VISION_FLOW_MASTER.plan.md",
	"docs/PLAN_COVERAGE.md",
	"src/memory/longTermMemory.ts",
	"src/memory/memoryTokenBudget.ts",
	"src/tokenBudget.ts",
	"src/visionProtocol/visionEvidenceStore.ts",
	"src/visionProtocol/visionTaskStack.ts",
	"src/visionProtocol/nativeVisionStructuredHandoff.ts",
	"src/visionProtocol/structuredVisionMessageBatch.ts",
	"src/visionProtocol/visionLogEvents.ts",
	"src/visionProtocol/hostUiSmokeLogEvents.ts",
	"src/smokeLogBridge/smokeLogEvidence.ts",
	"src/e2e/hostUi/logMarkers.ts",
	"src/providerVisionBranch.ts",
	"src/e2e/hostUi/registerSmokeCommands.ts",
	"src/e2e/hostUi/extensionSmokeRuntime.ts",
	"src/e2e/hostUi/extensionSmokeChat.ts",
	"src/e2e/hostUi/extensionSmokeActivation.ts",
	"src/visionOrchestrationContext.ts",
	"src/toolCooperation/visionArtifactStore.ts",
	"src/toolCooperation/rasterVectorizer.ts",
	"src/toolCooperation/visionRestoreFidelityReport.ts",
	"src/toolCooperation/visionSvgFidelity.ts",
	"src/e2e/hostUi/env.ts",
	"src/e2e/driver/hostUiSmoke.ts",
	"src/e2e/driver/hostUiSmokePaletteContract.ts",
	"src/e2e/hostUi/suites/e2eSuites.ts",
	"src/e2e/hostUi/chat/integration.ts",
	"src/e2e/hostUi/chat/planCoverage.ts",
	"src/e2e/hostUi/chat/p4Route.ts",
	"src/e2e/hostUi/modelOverlay.ts",
	"tsconfig.base.json",
	"tsconfig.extension.json",
	"tsconfig.test.json",
	"scripts/build/check-vsix-contents.mjs",
	"scripts/readme/generate-readme.mjs",
	"scripts/host-ui/run-host-ui-chat-acceptance.mjs",
	"scripts/README.md"
] as const;

const REQUIRED_TESTS = [
	"src/test/longTermMemory.test.ts",
	"src/test/memoryTokenBudget.test.ts",
	"src/test/visionLogReplay.test.ts",
	"src/test/visionSvgFidelity.test.ts",
	"src/test/visionArtifactStore.test.ts",
	"src/test/rasterVectorizer.test.ts",
	"src/test/visionRestoreFidelityReport.test.ts",
	"src/test/runProcessingChainRasterVectorize.test.ts",
	"src/test/hostUiSmokeAssertions.test.ts",
	"src/test/hostUiSmokeChatIntegration.test.ts",
	"src/test/hostUiSmokeChatPlanCoverage.test.ts",
	"src/test/hostUiSmokeP4RouteChat.test.ts",
	"src/test/vsixPackagePolicy.test.ts",
	"src/test/visionProgressReporter.test.ts",
	"src/test/visionJsonExtract.test.ts",
	"src/visionProtocol/visionBatchToProxyStructured.ts",
	"src/visionProtocol/visionJsonExtract.ts",
	"src/e2e/hostUi/settingsChecklist.ts",
	"src/e2e/hostUi/chat/acceptance.ts",
	"src/e2e/hostUi/chat/consistency.ts",
	"src/test/hostUiSmokeSettingsChecklist.test.ts",
	"src/test/hostUiSmokeChatAcceptance.test.ts",
	"src/test/hostUiSmokeChatConsistency.test.ts",
	"src/test/structuredVisionMessageBatch.test.ts"
] as const;

test("plan coverage doc lists p0-p11 rows", () => {
	const doc = readFileSync(path.join(root, "plan/VISION_FLOW_MASTER.plan.md"), "utf8");
	for (const stage of ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11"]) {
		assert.ok(doc.includes(stage), `PLAN_COVERAGE missing ${stage}`);
	}
	assert.ok(doc.includes("test:host-ui:full"), "PLAN_COVERAGE should document full host-ui script");
});

test("PLAN_COVERAGE index references host-ui chat acceptance launcher", () => {
	const doc = readFileSync(path.join(root, "docs/PLAN_COVERAGE.md"), "utf8");
	assert.ok(doc.includes("test:host-ui:chat-acceptance"));
	assert.ok(doc.includes("run-host-ui-chat-acceptance"));
});

test("plan-required implementation paths exist", () => {
	for (const rel of REQUIRED_PATHS) {
		assert.ok(existsSync(path.join(root, rel)), `missing required path: ${rel}`);
	}
});

test("plan-required test files exist", () => {
	for (const rel of REQUIRED_TESTS) {
		assert.ok(existsSync(path.join(root, rel)), `missing required test: ${rel}`);
	}
});
