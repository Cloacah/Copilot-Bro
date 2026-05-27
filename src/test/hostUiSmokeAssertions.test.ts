import test from "node:test";
import assert from "node:assert/strict";
import {
	assertHostUiSmokeConfigPanelEvidence,
	assertHostUiSmokeEvidence,
	validateAgentSmokeBudgetedEvidence,
	validateHostUiSmokeApiKeyEvidence,
	validateHostUiSmokeChatSuiteEvidence,
	validatePhase1SettingsExhaustiveEvidence,
	validatePresetCatalogEvidence,
	validateProviderProbeEvidence,
	validateVisionContractEvidence,
	validateScreenshotPageVisionEvidence,
	validateVisionChatProgressEvidence,
	validateVisionProbeEvidence,
	type HostUiSmokeEvidenceSummary
} from "../e2e/driver/hostUiSmokeAssertions";
import { QWEN_HOST_UI_CONTRACT } from "../config/qwenCatalogContract";
import { QWEN_MODEL_FAMILIES } from "../config/qwenModelFamilies";
import { getVisiblePhase1Sections } from "../ui/phase1ConfigUi";

function buildPhase1ExhaustiveGoodLog(): string {
	const lines: string[] = [];
	for (const section of getVisiblePhase1Sections()) {
		for (const field of section.fields) {
			lines.push(
				`[2020-01-01T00:00:00.000Z] [INFO] host-ui-smoke.phase1.settings.field ${JSON.stringify({
					sectionKey: section.key,
					fieldKey: field.key,
					kind: field.kind,
					present: true
				})}`
			);
		}
	}
	const sections = getVisiblePhase1Sections();
	const probeCount = sections.reduce((acc, s) => acc + s.fields.length, 0);
	lines.push(
		`[2020-01-01T00:00:00.000Z] [INFO] host-ui-smoke.phase1.settings.exhaustive.end ${JSON.stringify({
			ok: true,
			probeCount,
			sectionCount: sections.length,
			sectionKeys: sections.map((s) => s.key)
		})}`
	);
	return lines.join("\n");
}

function okEndLine(id: string): string {
	return `[INFO] host-ui-smoke.chat.scenario.end {"scenarioId":"${id}","ok":true,"ms":1}`;
}

test("chat suite evidence: passes when summary and all scenario ok lines exist", () => {
	const log = [
		'host-ui-smoke.chat.suite.summary {"ok":true,"count":2}',
		okEndLine("baseline"),
		okEndLine("unicode-prompt")
	].join("\n");
	assert.deepEqual(validateHostUiSmokeChatSuiteEvidence(log, ["baseline", "unicode-prompt"]), []);
});

test("chat suite evidence: missing suite summary", () => {
	const missing = validateHostUiSmokeChatSuiteEvidence(okEndLine("baseline"), ["baseline"]);
	assert.ok(missing.includes("log.chat.suite.summary"));
});

test("chat suite evidence: missing per-scenario ok line", () => {
	const log = ["host-ui-smoke.chat.suite.summary {}", okEndLine("baseline")].join("\n");
	const missing = validateHostUiSmokeChatSuiteEvidence(log, ["baseline", "unicode-prompt"]);
	assert.ok(missing.some((m) => m.startsWith("log.chat.scenario.end.ok:unicode-prompt")));
});

test("chat suite evidence: rejects ok:false scenario end", () => {
	const log = [
		"host-ui-smoke.chat.suite.summary {}",
		okEndLine("baseline"),
		'host-ui-smoke.chat.scenario.end {"scenarioId":"unicode-prompt","ok":false,"ms":1}'
	].join("\n");
	const missing = validateHostUiSmokeChatSuiteEvidence(log, ["baseline", "unicode-prompt"]);
	assert.ok(missing.includes("log.chat.scenario.end.has-failure"));
});

test("chat suite evidence: ok line must include literal ok:true JSON fragment", () => {
	const log = [
		"host-ui-smoke.chat.suite.summary {}",
		'host-ui-smoke.chat.scenario.end {"scenarioId":"baseline","ok":false}'
	].join("\n");
	const missing = validateHostUiSmokeChatSuiteEvidence(log, ["baseline"]);
	assert.ok(missing.some((m) => m.includes("baseline")));
});

function presetCatalogEndPayload() {
	return {
		promptPresetCount: 1,
		promptPresetIds: ["built-in:senior-engineer"],
		builtInModelCount: 0,
		qwenFamilyCount: QWEN_HOST_UI_CONTRACT.familyCount,
		qwenFamilyKeys: QWEN_MODEL_FAMILIES.map((family) => family.familyKey),
		qwenModelIdCount: QWEN_HOST_UI_CONTRACT.modelIdCount
	};
}

test("preset catalog evidence: accepts extension-shaped log line", () => {
	const log = `host-ui-smoke.preset.catalog.end ${JSON.stringify(presetCatalogEndPayload())}`;
	assert.deepEqual(validatePresetCatalogEvidence(log), []);
});

test("preset catalog evidence: wrong qwen model id count", () => {
	const payload = { ...presetCatalogEndPayload(), qwenModelIdCount: 1 };
	const log = `host-ui-smoke.preset.catalog.end ${JSON.stringify(payload)}`;
	const missing = validatePresetCatalogEvidence(log);
	assert.ok(missing.includes("log.preset.catalog.qwen-model-id-count"));
});

test("config panel evidence: happy path with model version + qwen catalog", () => {
	assertHostUiSmokeConfigPanelEvidence(
		{
			rowVisible: true,
			profileId: "dashscope-cn",
			baseUrlAfter: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			persistedProfileId: "dashscope-cn"
		},
		{
			rowVisible: true,
			familyKey: QWEN_HOST_UI_CONTRACT.qwen3MaxFamilyKey,
			versionAfter: QWEN_HOST_UI_CONTRACT.qwen3MaxDefaultVersionId,
			customAdded: true,
			customRemoved: true
		},
		{
			familyVisible: true,
			familyKey: QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey,
			versionCount: QWEN_HOST_UI_CONTRACT.vlOpenSourceVersionCount,
			defaultVersionId: QWEN_HOST_UI_CONTRACT.vlOpenSourceDefaultVersionId
		}
	);
});

test("config panel evidence: rejects wrong endpoint profile", () => {
	assert.throws(
		() =>
			assertHostUiSmokeConfigPanelEvidence({
				rowVisible: true,
				profileId: "dashscope-intl",
				baseUrlAfter: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
				persistedProfileId: "dashscope-intl"
			}),
		/dashscope-cn/
	);
});

test("provider probe evidence: requires matrix end and at least one outcome", () => {
	const log = [
		"host-ui-smoke.provider.matrix.end",
		"host-ui-smoke.provider.probe.ok {\"p\":\"x\"}"
	].join("\n");
	assert.deepEqual(validateProviderProbeEvidence(log), []);
});

test("provider probe evidence: fail marker is fatal", () => {
	const log = ["host-ui-smoke.provider.matrix.end", "host-ui-smoke.provider.probe.fail"].join("\n");
	const missing = validateProviderProbeEvidence(log);
	assert.ok(missing.includes("log.provider.probe.has-failure"));
});

test("vision contract evidence: minimal ok log", () => {
	const log = [
		'host-ui-smoke.vision.contract.end {"ok":true,"completedEvidenceIds":["a"],"proxyRoute":"proxy","nativeRoute":"native"}',
		"vision.native.structured.completed"
	].join("\n");
	assert.deepEqual(validateVisionContractEvidence(log), []);
});

test("vision contract evidence: missing native structured completion", () => {
	const log = 'host-ui-smoke.vision.contract.end {"ok":true,"completedEvidenceIds":["a"],"proxyRoute":"proxy","nativeRoute":"native"}';
	const missing = validateVisionContractEvidence(log);
	assert.ok(missing.includes("log.vision.native.structured.completed"));
});

function smokeSummary(overrides: Partial<HostUiSmokeEvidenceSummary>): HostUiSmokeEvidenceSummary {
	return {
		status: "passed",
		requestPath: "chat-ui",
		chatSubmitted: true,
		requestCommandStartSeen: false,
		requestCommandEndSeen: false,
		chatOpenSeen: true,
		chatPromptSubmittedViaUi: true,
		requestStartSeen: true,
		requestEndSeen: true,
		requestResponseVerified: true,
		screenshots: ["/tmp/host-ui-smoke.png"],
		...overrides
	};
}

const minimalChatUiLog = [
	"request.start",
	"request.end",
	"host-ui-smoke.chat.participant.request",
	"host-ui-smoke.chat.participant.end"
].join("\n");

test("assertHostUiSmokeEvidence: chat-ui baseline without post-chat LM palette", () => {
	assertHostUiSmokeEvidence(smokeSummary({ postChatLmApiPhase: false }), minimalChatUiLog);
});

test("assertHostUiSmokeEvidence: chat-ui rejects command palette flags when post-chat LM is off", () => {
	assert.throws(
		() => assertHostUiSmokeEvidence(smokeSummary({ requestCommandStartSeen: true, postChatLmApiPhase: false }), minimalChatUiLog),
		/no-lm-api-command-for-chat-ui/
	);
});

test("assertHostUiSmokeEvidence: chat-ui post-chat LM requires palette summary + run logs", () => {
	const log = [
		...minimalChatUiLog.split("\n"),
		"host-ui-smoke.request.run.start",
		"host-ui-smoke.request.run.end"
	].join("\n");
	assertHostUiSmokeEvidence(
		smokeSummary({
			postChatLmApiPhase: true,
			requestCommandStartSeen: true,
			requestCommandEndSeen: true
		}),
		log
	);
});

test("assertHostUiSmokeEvidence: lm-api requires palette command flags and run log markers", () => {
	const log = [
		"request.start",
		"request.end",
		"host-ui-smoke.request.run.start",
		"host-ui-smoke.request.run.end"
	].join("\n");
	assertHostUiSmokeEvidence(
		smokeSummary({
			requestPath: "lm-api",
			requestCommandStartSeen: true,
			requestCommandEndSeen: true,
			chatOpenSeen: false,
			chatPromptSubmittedViaUi: false
		}),
		log
	);
});

test("assertHostUiSmokeEvidence: lm-api fails when run.end log line missing", () => {
	const log = ["request.start", "request.end", "host-ui-smoke.request.run.start"].join("\n");
	assert.throws(
		() =>
			assertHostUiSmokeEvidence(
				smokeSummary({
					requestPath: "lm-api",
					requestCommandStartSeen: true,
					requestCommandEndSeen: true,
					chatOpenSeen: false,
					chatPromptSubmittedViaUi: false
				}),
				log
			),
		/log.request.run.end/
	);
});

test("assertHostUiSmokeEvidence: github-chat-login suite requires preflight end marker", () => {
	assert.throws(
		() => assertHostUiSmokeEvidence(smokeSummary({ githubChatLoginSuite: true }), minimalChatUiLog),
		/log.github-auth.preflight.end/
	);
	assertHostUiSmokeEvidence(
		smokeSummary({ githubChatLoginSuite: true }),
		`${minimalChatUiLog}\nhost-ui-smoke.github-auth.preflight.end`
	);
});

test("assertHostUiSmokeEvidence: apiKeysStatusRequired enforces api-keys status log", () => {
	assert.throws(
		() => assertHostUiSmokeEvidence(smokeSummary({ apiKeysStatusRequired: true }), minimalChatUiLog),
		/log.api-keys.status/
	);
	assert.deepEqual(validateHostUiSmokeApiKeyEvidence(minimalChatUiLog), ["log.api-keys.status"]);
	assert.deepEqual(
		validateHostUiSmokeApiKeyEvidence(`${minimalChatUiLog}\nhost-ui-smoke.api-keys.status {}`),
		[]
	);
	assertHostUiSmokeEvidence(
		smokeSummary({ apiKeysStatusRequired: true }),
		`${minimalChatUiLog}\nhost-ui-smoke.api-keys.status`
	);
});

test("assertHostUiSmokeEvidence: preset catalog phase delegates to preset validator", () => {
	const badLog = `${minimalChatUiLog}\nhost-ui-smoke.preset.catalog.end {"qwenFamilyCount":1}`;
	assert.throws(
		() => assertHostUiSmokeEvidence(smokeSummary({ presetCatalogPhase: true }), badLog),
		/log.preset.catalog/
	);
	const goodLog = `${minimalChatUiLog}\nhost-ui-smoke.preset.catalog.end ${JSON.stringify(presetCatalogEndPayload())}`;
	assertHostUiSmokeEvidence(smokeSummary({ presetCatalogPhase: true }), goodLog);
});

test("assertHostUiSmokeEvidence: vision contract phase delegates to vision validator", () => {
	const bad = `${minimalChatUiLog}\nhost-ui-smoke.vision.contract.end {"ok":false}`;
	assert.throws(
		() => assertHostUiSmokeEvidence(smokeSummary({ visionContractPhase: true }), bad),
		/log.vision.contract.not-ok|Host UI smoke evidence is incomplete/
	);
	const good = [
		minimalChatUiLog,
		'host-ui-smoke.vision.contract.end {"ok":true,"completedEvidenceIds":["x"],"proxyRoute":"proxy","nativeRoute":"native"}',
		"vision.native.structured.completed"
	].join("\n");
	assertHostUiSmokeEvidence(smokeSummary({ visionContractPhase: true }), good);
});

test("assertHostUiSmokeEvidence: provider probe phase delegates to probe validator", () => {
	const bad = `${minimalChatUiLog}\nhost-ui-smoke.provider.matrix.end`;
	assert.throws(
		() => assertHostUiSmokeEvidence(smokeSummary({ providerProbePhase: true }), bad),
		/log.provider.probe/
	);
	const good = `${minimalChatUiLog}\nhost-ui-smoke.provider.matrix.end\nhost-ui-smoke.provider.probe.ok`;
	assertHostUiSmokeEvidence(smokeSummary({ providerProbePhase: true }), good);
});

test("validatePhase1SettingsExhaustiveEvidence: requires every visible field + probeCount", () => {
	assert.deepEqual(validatePhase1SettingsExhaustiveEvidence(""), ["log.phase1.settings.exhaustive.end"]);
	const bad = '[2020-01-01T00:00:00.000Z] [INFO] host-ui-smoke.phase1.settings.exhaustive.end {"ok":false}';
	assert.deepEqual(validatePhase1SettingsExhaustiveEvidence(bad), ["log.phase1.settings.exhaustive.not-ok"]);
	const good = buildPhase1ExhaustiveGoodLog();
	assert.deepEqual(validatePhase1SettingsExhaustiveEvidence(good), []);
	const lines = good.split("\n");
	const missingOne = lines.slice(1).join("\n");
	assert.ok(
		validatePhase1SettingsExhaustiveEvidence(missingOne).some((m) => m.startsWith("log.phase1.field.missing:")),
		"expected missing field when first probe line dropped"
	);
});

test("validateVisionChatProgressEvidence: requires batched thinking flush for screenshot_page", () => {
	assert.deepEqual(validateVisionChatProgressEvidence(""), ["log.vision-chat-progress.end"]);
	const good = [
		'host-ui-smoke.vision-chat-progress.end {"ok":true,"toolName":"screenshot_page"}',
		'host-ui-smoke.vision.progress.flush {"chunkCount":3,"containsVisionPrefix":true,"usedThinkingPart":false,"hasVisionDetailsMarker":true}',
		'vision.input.bound {"toolName":"screenshot_page","sourceKind":"tool-screenshot"}'
	].join("\n");
	assert.deepEqual(validateVisionChatProgressEvidence(good), []);
});

test("validateScreenshotPageVisionEvidence: requires screenshot_page structured proxy chain", () => {
	assert.deepEqual(validateScreenshotPageVisionEvidence(""), ["log.screenshot-page.vision.end"]);
	const good = [
		'host-ui-smoke.screenshot-page.vision.end {"ok":true,"toolName":"screenshot_page","sourceKind":"tool-screenshot"}',
		'vision.input.bound {"toolName":"screenshot_page","sourceKind":"tool-screenshot"}',
		"vision.proxy.structured {}",
		"vision.proxy.cache.miss {}"
	].join("\n");
	assert.deepEqual(validateScreenshotPageVisionEvidence(good), []);
});

test("validateVisionProbeEvidence: requires proxy evidence chain", () => {
	assert.deepEqual(validateVisionProbeEvidence(""), ["log.vision.probe.end"]);
	const probeOnly = '[t] [INFO] host-ui-smoke.vision.probe.end {"ok":true}';
	assert.ok(validateVisionProbeEvidence(probeOnly).includes("log.vision.input.bound"));
	const good = [
		"[t] [INFO] vision.input.bound {}",
		"[t] [INFO] vision.proxy.cache.miss {}",
		'[t] [INFO] host-ui-smoke.vision.probe.end {"ok":true}'
	].join("\n");
	assert.deepEqual(validateVisionProbeEvidence(good), []);
});

test("validateAgentSmokeBudgetedEvidence: requires greedy-prefix budgeter", () => {
	const stub = 'host-ui-smoke.agent.smoke.budgeted.end {"ok":true,"budgeterKind":"stub"}';
	assert.ok(validateAgentSmokeBudgetedEvidence(stub).includes("log.agent.smoke.budgeted.stub-budgeter"));
	const good =
		'host-ui-smoke.agent.smoke.budgeted.end {"ok":true,"budgeterKind":"greedy-prefix","retainedCount":2}';
	assert.deepEqual(validateAgentSmokeBudgetedEvidence(good), []);
});

test("assertHostUiSmokeEvidence: optional suites stack on chat-ui log", () => {
	const log = [
		minimalChatUiLog,
		buildPhase1ExhaustiveGoodLog(),
		'[t] [INFO] host-ui-smoke.phase1.settings.roundtrip.end {"ok":true,"roundtripCount":12}',
		'[t] [INFO] host-ui-smoke.phase1.settings.roundtrip {"sectionKey":"visionAgent","fieldKey":"enabled","ok":true}',
		"[t] [INFO] vision.input.bound {}",
		"[t] [INFO] vision.proxy.cache.miss {}",
		'[t] [INFO] host-ui-smoke.vision.probe.end {"ok":true}',
		'host-ui-smoke.agent.smoke.budgeted.end {"ok":true,"budgeterKind":"greedy-prefix","retainedCount":1}'
	].join("\n");
	assertHostUiSmokeEvidence(
		smokeSummary({
			phase1SettingsExhaustivePhase: true,
			visionProbePhase: true,
			agentSmokeBudgetedPhase: true
		}),
		log
	);
});
