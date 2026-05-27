import type { HostUiSmokeRequestPath } from "./hostUiSmokeFlow";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../../config/highFidelityRestoreImagePipelineSuspended";
import { QWEN_HOST_UI_CONTRACT } from "../../config/qwenCatalogContract";
import { getVisiblePhase1Sections } from "../../ui/phase1ConfigUi";
import { validateHostUiSmokeChatIntegrationConsistency } from "../hostUi/chat/consistency";
import { HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS } from "../hostUi/chat/acceptance";

export interface HostUiSmokeEvidenceSummary {
	status: "passed" | "failed";
	requestPath: HostUiSmokeRequestPath;
	chatSubmitted: boolean;
	requestCommandStartSeen: boolean;
	requestCommandEndSeen: boolean;
	chatOpenSeen: boolean;
	chatPromptSubmittedViaUi: boolean;
	requestStartSeen: boolean;
	requestEndSeen: boolean;
	requestResponseVerified: boolean;
	screenshots: readonly string[];
	/** When set, log must contain matching suite evidence (Chat UI multi-scenario). */
	chatScenarioIds?: readonly string[];
	/** Real Chat integration suite (vision proxy, cache hit, model switch, multi-turn). */
	chatIntegrationScenarioIds?: readonly string[];
	chatIntegrationPhase?: boolean;
	/** E2E suite ids selected for this run. */
	e2eSuites?: readonly string[];
	/** Copilot Chat GitHub sign-in preflight ran (template-driven flow; may skip if already signed in). */
	githubChatLoginSuite?: boolean;
	/** Preset inventory command completed. */
	presetCatalogPhase?: boolean;
	/** Per-provider LM probe matrix completed. */
	providerProbePhase?: boolean;
	/** Chat UI run followed by optional LM API palette command (second provider round-trip). */
	postChatLmApiPhase?: boolean;
	/** Full run must log extension API key inventory (host-ui-smoke.api-keys.status). */
	apiKeysStatusRequired?: boolean;
	/** Vision protocol contract dry-run (no external vision API). */
	visionContractPhase?: boolean;
	visionJsonRepairPhase?: boolean;
	/** Optional suite: Phase 1 every visible field + merged settings contract. */
	phase1SettingsExhaustivePhase?: boolean;
	/** Optional suite: real vision-proxy path (12×12 probe PNG) with cache + input-bound evidence. */
	visionProbePhase?: boolean;
	/** Optional suite: screenshot_page tool-result image through structured proxy route. */
	screenshotPageVisionPhase?: boolean;
	/** Optional suite: provider path batches [Vision] into thinking block (screenshot_page). */
	visionChatProgressPhase?: boolean;
	/** Optional suite: agent + token budget placeholder contract. */
	agentSmokeBudgetedPhase?: boolean;
	/** Optional suite: real testButtons PNG path hydration + restore artifact probe. */
	p6P7RealAssetsPhase?: boolean;
}

export function validateP6P7RealAssetsEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.p6-p7.real-assets.probe.end")) {
		missing.push("log.p6-p7.real-assets.probe.end");
		return missing;
	}
	const endLine = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.p6-p7.real-assets.probe.end"));
	if (!endLine?.includes('"ok":true')) {
		missing.push("log.p6-p7.real-assets.probe.not-ok");
	}
	if (!logText.includes("host-ui-smoke.p6.path-hydration.probe.end")) {
		missing.push("log.p6.path-hydration.probe.end");
	}
	if (!logText.includes("host-ui-smoke.p7.restore-artifact.probe.end")) {
		missing.push("log.p7.restore-artifact.probe.end");
	}
	const p6Line = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.p6.path-hydration.probe.end"));
	if (!p6Line?.includes('"hydratedCount":') || !/"hydratedCount":\s*[1-9]/u.test(p6Line)) {
		missing.push("log.p6.path-hydration.hydrated-count");
	}
	const p7Line = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.p7.restore-artifact.probe.end"));
	if (HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED) {
		if (!p7Line?.includes('"imagePipelineSuspended":true')) {
			missing.push("log.p7.restore-artifact.suspended-flag");
		}
	} else if (!p7Line?.includes('"artifactSha256":"') || !/"artifactSha256":"[a-f0-9]{64}"/u.test(p7Line)) {
		missing.push("log.p7.restore-artifact.sha256");
	}
	return missing;
}

export function validateVisionJsonRepairEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.vision.json.repair.end")) {
		missing.push("log.vision.json.repair.end");
		return missing;
	}
	const endLine = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.vision.json.repair.end"));
	if (!endLine?.includes('"ok":true')) {
		missing.push("log.vision.json.repair.not-ok");
	}
	for (const sampleId of ["trailing-comma", "prose-wrapped", "unclosed-brace", "fenced-json"]) {
		if (!logText.includes(`"id":"${sampleId}"`) && !logText.includes(`"id": "${sampleId}"`)) {
			missing.push(`log.vision.json.repair.sample.${sampleId}`);
		}
	}
	return missing;
}

export function validateVisionContractEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.vision.contract.end")) {
		missing.push("log.vision.contract.end");
		return missing;
	}
	const line = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.vision.contract.end"));
	if (!line?.includes('"ok":true')) {
		missing.push("log.vision.contract.not-ok");
	}
	if (!line?.includes("completedEvidenceIds")) {
		missing.push("log.vision.contract.missing-completed-ids");
	}
	if (!line?.includes('"proxyRoute":"proxy"')) {
		missing.push("log.vision.contract.proxy-route");
	}
	if (!line?.includes('"nativeRoute":"native"')) {
		missing.push("log.vision.contract.native-route");
	}
	if (!logText.includes("vision.native.structured.completed")) {
		missing.push("log.vision.native.structured.completed");
	}
	return missing;
}

/** Optional Host UI suite: Phase 1 settings exhaustive snapshot (extension log contract). */
export function validatePhase1SettingsExhaustiveEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.phase1.settings.exhaustive.end")) {
		missing.push("log.phase1.settings.exhaustive.end");
		return missing;
	}
	const line = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.phase1.settings.exhaustive.end"));
	if (!line?.includes('"ok":true')) {
		missing.push("log.phase1.settings.exhaustive.not-ok");
		return missing;
	}
	const jsonStart = line.indexOf("{");
	if (jsonStart < 0) {
		missing.push("log.phase1.settings.exhaustive.payload");
		return missing;
	}
	let endPayload: { probeCount?: number };
	try {
		endPayload = JSON.parse(line.slice(jsonStart)) as { probeCount?: number };
	} catch {
		missing.push("log.phase1.settings.exhaustive.payload-parse");
		return missing;
	}
	const expectedProbeCount = getVisiblePhase1Sections().reduce((acc, s) => acc + s.fields.length, 0);
	if (typeof endPayload.probeCount !== "number" || endPayload.probeCount !== expectedProbeCount) {
		missing.push(`log.phase1.probeCount mismatch (want ${expectedProbeCount})`);
	}
	const seen = new Set<string>();
	const marker = "host-ui-smoke.phase1.settings.field ";
	for (const entry of logText.split(/\r?\n/u)) {
		const idx = entry.indexOf(marker);
		if (idx < 0) {
			continue;
		}
		const brace = entry.indexOf("{", idx);
		if (brace < 0) {
			continue;
		}
		try {
			const payload = JSON.parse(entry.slice(brace)) as {
				sectionKey?: string;
				fieldKey?: string;
				present?: boolean;
			};
			if (payload.present === true && payload.sectionKey && payload.fieldKey) {
				seen.add(`${payload.sectionKey}.${payload.fieldKey}`);
			}
		} catch {
			// ignore malformed lines
		}
	}
	for (const section of getVisiblePhase1Sections()) {
		for (const field of section.fields) {
			const key = `${section.key}.${field.key}`;
			if (!seen.has(key)) {
				missing.push(`log.phase1.field.missing:${key}`);
			}
		}
	}
	return missing;
}

/** Optional Host UI suite: screenshot_page tool result must bind and run structured proxy. */
export function validateVisionChatProgressEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.vision-chat-progress.end")) {
		missing.push("log.vision-chat-progress.end");
		return missing;
	}
	const endLine = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.vision-chat-progress.end"));
	if (!endLine?.includes('"ok":true')) {
		missing.push("log.vision-chat-progress.not-ok");
	}
	if (!logText.includes("host-ui-smoke.vision.progress.flush")) {
		missing.push("log.vision.progress.flush");
		return missing;
	}
	const flushLine = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.vision.progress.flush"));
	if (!flushLine?.includes('"chunkCount":') || !/"chunkCount":\s*[1-9]/u.test(flushLine)) {
		missing.push("log.vision.progress.flush.chunk-count");
	}
	if (!flushLine?.includes('"containsVisionPrefix":true')) {
		missing.push("log.vision.progress.flush.vision-prefix");
	}
	if (
		!flushLine?.includes('"usedThinkingPart":true')
		&& !flushLine?.includes('"hasVisionDetailsMarker":true')
	) {
		missing.push("log.vision.progress.flush.thinking-or-details");
	}
	if (!logText.includes("screenshot_page")) {
		missing.push("log.vision-chat-progress.tool-name");
	}
	if (!logText.includes("vision.input.bound")) {
		missing.push("log.vision-chat-progress.input-bound");
	}
	return missing;
}

export function validateScreenshotPageVisionEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.screenshot-page.vision.end")) {
		missing.push("log.screenshot-page.vision.end");
		return missing;
	}
	const endLine = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.screenshot-page.vision.end"));
	if (!endLine?.includes('"ok":true')) {
		missing.push("log.screenshot-page.vision.not-ok");
		return missing;
	}
	if (!logText.includes("screenshot_page")) {
		missing.push("log.screenshot-page.tool-name");
	}
	if (!logText.includes("tool-screenshot")) {
		missing.push("log.screenshot-page.source-kind");
	}
	if (!logText.includes("vision.input.bound")) {
		missing.push("log.vision.input.bound");
	}
	if (!logText.includes("vision.proxy.structured") && !logText.includes("vision.proxy.cache.")) {
		missing.push("log.vision.proxy.structured-or-cache");
	}
	return missing;
}

/** Optional Host UI suite: real vision-proxy round-trip (evidence + cache + end marker). */
export function validateVisionProbeEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.vision.probe.end")) {
		missing.push("log.vision.probe.end");
		return missing;
	}
	const probeLine = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.vision.probe.end"));
	if (!probeLine?.includes('"ok":true')) {
		missing.push("log.vision.probe.not-ok");
		return missing;
	}
	if (!logText.includes("vision.input.bound")) {
		missing.push("log.vision.input.bound");
	}
	if (!logText.includes("vision.proxy.cache.miss") && !logText.includes("vision.proxy.cache.hit")) {
		missing.push("log.vision.proxy.cache");
	}
	return missing;
}

/** Optional Host UI suite: agent smoke exercises real greedy-prefix memory budgeter. */
export function validateAgentSmokeBudgetedEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.agent.smoke.budgeted.end")) {
		missing.push("log.agent.smoke.budgeted.end");
		return missing;
	}
	const line = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.agent.smoke.budgeted.end"));
	if (!line?.includes('"ok":true')) {
		missing.push("log.agent.smoke.budgeted.not-ok");
		return missing;
	}
	if (line.includes('"budgeterKind":"stub"') || line.includes('"tokenBudgeter":"stub"')) {
		missing.push("log.agent.smoke.budgeted.stub-budgeter");
	}
	if (!line.includes('"budgeterKind":"greedy-prefix"')) {
		missing.push("log.agent.smoke.budgeted.budgeter-kind");
	}
	if (!line.includes("retainedCount")) {
		missing.push("log.agent.smoke.budgeted.retained-count");
	}
	return missing;
}

export interface HostUiSmokeProviderEndpointUiEvidence {
	rowVisible: boolean;
	profileId: string;
	baseUrlAfter: string;
	persistedProfileId?: string;
	savedViaSaveButton?: boolean;
	savedViaProfileChange?: boolean;
}

export interface HostUiSmokeModelVersionUiEvidence {
	rowVisible: boolean;
	familyKey: string;
	versionAfter: string;
	customAdded: boolean;
	customRemoved: boolean;
}

export interface HostUiSmokeQwenCatalogUiEvidence {
	familyVisible: boolean;
	familyKey: string;
	versionCount: number;
	defaultVersionId: string;
}

export interface HostUiSmokeVisionProxyUiEvidence {
	enabled: boolean;
	selectionMode: string;
	customModelIds: readonly string[];
	persistedSelectionMode?: string;
	persistedCustomModelIds?: readonly string[];
	savedViaBaseButton?: boolean;
}

/** @deprecated Use {@link QWEN_HOST_UI_CONTRACT} from `qwenCatalogContract` (kept for external grep stability). */
export const HOST_UI_SMOKE_QWEN_FAMILY_COUNT = QWEN_HOST_UI_CONTRACT.familyCount;
/** @deprecated Use {@link QWEN_HOST_UI_CONTRACT}. */
export const HOST_UI_SMOKE_QWEN_MODEL_ID_COUNT = QWEN_HOST_UI_CONTRACT.modelIdCount;
/** @deprecated Use {@link QWEN_HOST_UI_CONTRACT}. */
export const HOST_UI_SMOKE_QWEN_VL_OPEN_SOURCE_FAMILY = QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey;
/** @deprecated Use {@link QWEN_HOST_UI_CONTRACT}. */
export const HOST_UI_SMOKE_QWEN_VL_OPEN_SOURCE_VERSION_COUNT = QWEN_HOST_UI_CONTRACT.vlOpenSourceVersionCount;
/** @deprecated Use {@link QWEN_HOST_UI_CONTRACT}. */
export const HOST_UI_SMOKE_QWEN_VL_DEFAULT_VERSION = QWEN_HOST_UI_CONTRACT.vlOpenSourceDefaultVersionId;

export function validatePresetCatalogEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.preset.catalog.end")) {
		missing.push("log.preset.catalog.end");
		return missing;
	}
	const line = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.preset.catalog.end"));
	if (!line) {
		missing.push("log.preset.catalog.end-line");
		return missing;
	}
	if (!line.includes(QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey)) {
		missing.push(`log.preset.catalog.${QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey}`);
	}
	if (!line.includes(`"qwenFamilyCount":${QWEN_HOST_UI_CONTRACT.familyCount}`)) {
		missing.push("log.preset.catalog.qwen-family-count");
	}
	if (!line.includes(`"qwenModelIdCount":${QWEN_HOST_UI_CONTRACT.modelIdCount}`)) {
		missing.push("log.preset.catalog.qwen-model-id-count");
	}
	if (!line.includes("built-in:senior-engineer")) {
		missing.push("log.preset.catalog.senior-engineer-preset");
	}
	return missing;
}

/**
 * Provider matrix: probe.fail is fatal; probe.skip (e.g. invalid-api-key) is allowed.
 * At least one probe.ok or probe.skip must appear when the matrix completed.
 */
export function validateProviderProbeEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.provider.matrix.end")) {
		missing.push("log.provider.matrix.end");
	}
	if (logText.includes("host-ui-smoke.provider.probe.fail")) {
		missing.push("log.provider.probe.has-failure");
	}
	const hasOk = logText.includes("host-ui-smoke.provider.probe.ok");
	const hasSkip = logText.includes("host-ui-smoke.provider.probe.skip");
	if (!hasOk && !hasSkip) {
		missing.push("log.provider.probe.no-outcome");
	}
	return missing;
}

/** Requires extension log line listing keyed / missing / seeded providers. */
export function validateHostUiSmokeApiKeyEvidence(logText: string): string[] {
	if (!logText.includes("host-ui-smoke.api-keys.status")) {
		return ["log.api-keys.status"];
	}
	return [];
}

export function assertHostUiSmokeConfigPanelEvidence(
	endpointUi: HostUiSmokeProviderEndpointUiEvidence | undefined,
	modelVersionUi?: HostUiSmokeModelVersionUiEvidence,
	qwenCatalogUi?: HostUiSmokeQwenCatalogUiEvidence,
	visionProxyUi?: HostUiSmokeVisionProxyUiEvidence
): void {
	if (!endpointUi) {
		throw new Error("config panel smoke must include providerEndpointUi evidence");
	}
	if (!endpointUi.rowVisible) {
		throw new Error("qwen provider endpoint row must be visible");
	}
	if (endpointUi.profileId !== "dashscope-cn") {
		throw new Error(`endpoint profile must be dashscope-cn, got ${endpointUi.profileId}`);
	}
	if (!/dashscope\.aliyuncs\.com\/compatible-mode\/v1/i.test(endpointUi.baseUrlAfter)) {
		throw new Error("base URL must reflect China DashScope gateway");
	}
	if (endpointUi.persistedProfileId !== "dashscope-cn") {
		throw new Error("providerEndpoints setting must persist dashscope-cn for qwen");
	}
	if (modelVersionUi) {
		if (!modelVersionUi.rowVisible) {
			throw new Error("qwen-max model version row must be visible");
		}
		if (modelVersionUi.familyKey !== QWEN_HOST_UI_CONTRACT.qwen3MaxFamilyKey) {
			throw new Error(`model version family must be ${QWEN_HOST_UI_CONTRACT.qwen3MaxFamilyKey}, got ${modelVersionUi.familyKey}`);
		}
		if (modelVersionUi.versionAfter !== QWEN_HOST_UI_CONTRACT.qwen3MaxDefaultVersionId) {
			throw new Error(`model version must be ${QWEN_HOST_UI_CONTRACT.qwen3MaxDefaultVersionId}, got ${modelVersionUi.versionAfter}`);
		}
		if (!modelVersionUi.customAdded || !modelVersionUi.customRemoved) {
			throw new Error("model version UI must add and remove a custom version id");
		}
	}
	if (qwenCatalogUi) {
		if (!qwenCatalogUi.familyVisible) {
			throw new Error("qwen3-vl-open-source family must be visible in model picker");
		}
		if (qwenCatalogUi.familyKey !== QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey) {
			throw new Error(`qwen catalog family must be ${QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey}`);
		}
		if (qwenCatalogUi.versionCount !== QWEN_HOST_UI_CONTRACT.vlOpenSourceVersionCount) {
			throw new Error(`qwen3-vl-open-source must expose ${QWEN_HOST_UI_CONTRACT.vlOpenSourceVersionCount} versions`);
		}
		if (qwenCatalogUi.defaultVersionId !== QWEN_HOST_UI_CONTRACT.vlOpenSourceDefaultVersionId) {
			throw new Error(`default qwen3-vl version must be ${QWEN_HOST_UI_CONTRACT.vlOpenSourceDefaultVersionId}`);
		}
	}
	if (visionProxyUi) {
		if (visionProxyUi.selectionMode !== "custom-list") {
			throw new Error(`visionProxy selectionMode must be custom-list, got ${visionProxyUi.selectionMode}`);
		}
		if (!visionProxyUi.customModelIds || visionProxyUi.customModelIds.length < 1) {
			throw new Error("visionProxy customModelIds must include at least one entry");
		}
		if (visionProxyUi.persistedSelectionMode && visionProxyUi.persistedSelectionMode !== "custom-list") {
			throw new Error(`visionProxy persisted selectionMode must be custom-list, got ${visionProxyUi.persistedSelectionMode}`);
		}
		if (visionProxyUi.persistedCustomModelIds && visionProxyUi.persistedCustomModelIds.length < 1) {
			throw new Error("visionProxy persisted customModelIds must include at least one entry");
		}
	}
}

export function assertHostUiSmokeEvidence(summary: HostUiSmokeEvidenceSummary, logText: string): void {
	const missing: string[] = [];
	if (!summary.chatSubmitted) {
		missing.push("summary.chatSubmitted");
	}
	if (!summary.requestStartSeen) {
		missing.push("summary.requestStartSeen");
	}
	if (!summary.requestEndSeen) {
		missing.push("summary.requestEndSeen");
	}
	if (!summary.requestResponseVerified) {
		missing.push("summary.requestResponseVerified");
	}
	if (summary.screenshots.length === 0) {
		missing.push("summary.screenshots");
	}
	if (!logText.includes("request.start")) {
		missing.push("log.request.start");
	}
	if (!logText.includes("request.end")) {
		missing.push("log.request.end");
	}
	if (summary.requestPath === "chat-ui") {
		if (!summary.chatOpenSeen) {
			missing.push("summary.chatOpenSeen");
		}
		if (!summary.chatPromptSubmittedViaUi) {
			missing.push("summary.chatPromptSubmittedViaUi");
		}
		const allowLmApiPalette = summary.postChatLmApiPhase === true;
		if (!allowLmApiPalette && (summary.requestCommandStartSeen || summary.requestCommandEndSeen)) {
			missing.push("summary.no-lm-api-command-for-chat-ui");
		}
		if (allowLmApiPalette) {
			if (!summary.requestCommandStartSeen || !summary.requestCommandEndSeen) {
				missing.push("summary.post-chat-lm-api-command");
			}
			if (!logText.includes("host-ui-smoke.request.run.start")) {
				missing.push("log.request.run.start");
			}
			if (!logText.includes("host-ui-smoke.request.run.end")) {
				missing.push("log.request.run.end");
			}
		}
		if (!logText.includes("host-ui-smoke.chat.participant.request")) {
			missing.push("log.chat.participant.request");
		}
		if (
			!logText.includes("host-ui-smoke.chat.participant.finished")
			&& !logText.includes("host-ui-smoke.chat.participant.end")
		) {
			missing.push("log.chat.participant.finished");
		}
		if (summary.githubChatLoginSuite) {
			if (!logText.includes("host-ui-smoke.github-auth.preflight.end")) {
				missing.push("log.github-auth.preflight.end");
			}
		}
		if (summary.presetCatalogPhase) {
			missing.push(...validatePresetCatalogEvidence(logText));
		}
		if (summary.visionContractPhase) {
			missing.push(...validateVisionContractEvidence(logText));
		}
		if (summary.visionJsonRepairPhase) {
			missing.push(...validateVisionJsonRepairEvidence(logText));
		}
		if (summary.phase1SettingsExhaustivePhase) {
			missing.push(...validatePhase1SettingsExhaustiveEvidence(logText));
			missing.push(...validatePhase1SettingsRoundtripEvidence(logText));
		}
		if (summary.visionProbePhase) {
			missing.push(...validateVisionProbeEvidence(logText));
		}
		if (summary.screenshotPageVisionPhase) {
			missing.push(...validateScreenshotPageVisionEvidence(logText));
		}
		if (summary.visionChatProgressPhase) {
			missing.push(...validateVisionChatProgressEvidence(logText));
		}
		if (summary.agentSmokeBudgetedPhase) {
			missing.push(...validateAgentSmokeBudgetedEvidence(logText));
		}
		if (summary.p6P7RealAssetsPhase) {
			missing.push(...validateP6P7RealAssetsEvidence(logText));
		}
		if (summary.providerProbePhase) {
			missing.push(...validateProviderProbeEvidence(logText));
		}
		if (summary.apiKeysStatusRequired) {
			missing.push(...validateHostUiSmokeApiKeyEvidence(logText));
		}
		const scenarioIds = summary.chatScenarioIds;
		if (scenarioIds && scenarioIds.length > 0) {
			const suiteMissing = validateHostUiSmokeChatSuiteEvidence(logText, scenarioIds);
			missing.push(...suiteMissing);
		}
		if (summary.chatIntegrationPhase) {
			const integrationIds = summary.chatIntegrationScenarioIds ?? [];
			missing.push(...validateHostUiSmokeChatIntegrationEvidence(logText, integrationIds));
		}
	}
	if (summary.requestPath === "lm-api") {
		if (!summary.requestCommandStartSeen) {
			missing.push("summary.requestCommandStartSeen");
		}
		if (!summary.requestCommandEndSeen) {
			missing.push("summary.requestCommandEndSeen");
		}
		if (!logText.includes("host-ui-smoke.request.run.start")) {
			missing.push("log.request.run.start");
		}
		if (!logText.includes("host-ui-smoke.request.run.end")) {
			missing.push("log.request.run.end");
		}
	}
	if (missing.length > 0) {
		throw new Error(`Host UI smoke evidence is incomplete: ${missing.join(", ")}`);
	}
	if (summary.requestPath === "chat-ui") {
		const participantFailLine = logText.split(/\r?\n/u).find(
			(entry) => entry.includes("host-ui-smoke.chat.participant.end") && entry.includes('"ok":false')
		);
		if (participantFailLine) {
			const snippet = participantFailLine.length > 800 ? `${participantFailLine.slice(0, 800)}…` : participantFailLine;
			throw new Error(`Host UI smoke chat participant failed (evidence complete): ${snippet}`);
		}
	}
}

/**
 * Validates integration scenario end lines (ok, skipped, or explicit ok:false) plus suite summary.
 */
export function validateHostUiSmokeChatIntegrationEvidence(
	logText: string,
	scenarioIds: readonly string[]
): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.chat.integration.suite.summary")) {
		missing.push("log.chat.integration.suite.summary");
	}
	for (const id of scenarioIds) {
		const line = logText.split(/\r?\n/u).find((entry) =>
			entry.includes("host-ui-smoke.chat.integration.scenario.end")
			&& entry.includes(`"scenarioId":"${id}"`)
			&& (entry.includes('"ok":true') || entry.includes('"skipped":true')));
		if (!line) {
			const failedLine = logText.split(/\r?\n/u).find((entry) =>
				entry.includes("host-ui-smoke.chat.integration.scenario.end")
				&& entry.includes(`"scenarioId":"${id}"`)
				&& entry.includes('"ok":false'));
			if (failedLine) {
				missing.push(`log.chat.integration.scenario.end.failed:${id}`);
			} else {
				missing.push(`log.chat.integration.scenario.end.terminal:${id}`);
			}
		}
	}
	const visionScenarioIds = scenarioIds.filter((id) =>
		id.startsWith("vision-")
		|| id.includes("multi-turn")
		|| id.startsWith("p5-")
		|| id.startsWith("p6-")
		|| id.startsWith("p7-")
		|| id.startsWith("p3-")
		|| id.startsWith("native-")
		|| id.startsWith("provider-")
		|| id === "multi-provider-switch-context");
	const visionExecuted = visionScenarioIds.some((id) => {
		const line = logText.split(/\r?\n/u).find((entry) =>
			entry.includes("host-ui-smoke.chat.integration.scenario.end")
			&& entry.includes(`"scenarioId":"${id}"`)
			&& entry.includes('"ok":true')
			&& !entry.includes('"skipped":true'));
		return Boolean(line);
	});
	if (visionExecuted && !logText.includes("vision.input.bound")) {
		missing.push("log.vision.input.bound.from-chat-integration");
	}
	const p5Id = "p5-qwen-vl-native-chat";
	if (scenarioIds.includes(p5Id)) {
		const p5Line = logText.split(/\r?\n/u).find((entry) =>
			entry.includes("host-ui-smoke.chat.integration.scenario.end")
			&& entry.includes(`"scenarioId":"${p5Id}"`));
		const p5Skipped = p5Line?.includes('"skipped":true') ?? false;
		const dashscopePresent = /DASHSCOPE_API_KEY["\s:]*present/u.test(logText)
			|| process.env.DASHSCOPE_API_KEY?.trim();
		if (dashscopePresent && p5Skipped) {
			missing.push("log.chat.integration.p5-should-not-skip-when-dashscope-key-present");
		}
		if (!p5Skipped && !logText.includes("qwen3-vl-open-source::qwen")) {
			missing.push("log.chat.integration.p5-qwen-runtime-request");
		}
	}
	if (scenarioIds.includes("multi-provider-switch-context")) {
		const consistency = validateHostUiSmokeChatIntegrationConsistency(logText, scenarioIds);
		if (!consistency.ok) {
			missing.push("log.chat.integration.consistency.failed");
		}
		if (!logText.includes("host-ui-smoke.chat.consistency.end")) {
			missing.push("log.chat.integration.consistency.end");
		}
	}
	return missing;
}

export function validatePhase1SettingsRoundtripEvidence(logText: string): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.phase1.settings.roundtrip.end")) {
		missing.push("log.phase1.settings.roundtrip.end");
		return missing;
	}
	const endLine = logText.split(/\r?\n/u).find((entry) => entry.includes("host-ui-smoke.phase1.settings.roundtrip.end"));
	if (!endLine?.includes('"ok":true')) {
		missing.push("log.phase1.settings.roundtrip.not-ok");
	}
	const fieldLines = logText.split(/\r?\n/u).filter((entry) => entry.includes("host-ui-smoke.phase1.settings.roundtrip"));
	if (fieldLines.length < 2) {
		missing.push("log.phase1.settings.roundtrip.field-lines");
	}
	return missing;
}

/** Default chat integration scenario ids for evidence validation when env list is unset. */
export function defaultHostUiSmokeChatIntegrationScenarioIds(): readonly string[] {
	return HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS;
}

export function validateHostUiSmokeChatSuiteEvidence(logText: string, scenarioIds: readonly string[]): string[] {
	const missing: string[] = [];
	if (!logText.includes("host-ui-smoke.chat.suite.summary")) {
		missing.push("log.chat.suite.summary");
	}
	for (const id of scenarioIds) {
		const okLine = logText.split(/\r?\n/).find((line) =>
			line.includes("host-ui-smoke.chat.scenario.end")
			&& line.includes(`"scenarioId":"${id}"`)
			&& line.includes('"ok":true'));
		if (!okLine) {
			missing.push(`log.chat.scenario.end.ok:${id}`);
		}
	}
	const badLine = logText.split(/\r?\n/).find((line) =>
		line.includes("host-ui-smoke.chat.scenario.end") && line.includes('"ok":false'));
	if (badLine) {
		missing.push("log.chat.scenario.end.has-failure");
	}
	return missing;
}
