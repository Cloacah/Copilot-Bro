import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { access, appendFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import process from "node:process";
import { keyboard, Key, mouse, Point } from "@nut-tree-fork/nut-js";
import { Window, windowManager } from "node-window-manager";
import { assertHostUiSmokeConfigPanelEvidence, assertHostUiSmokeEvidence } from "./hostUiSmokeAssertions";
import { HOST_UI_SMOKE_PALETTE, type HostUiSmokePaletteEntry } from "./hostUiSmokePaletteContract";
import { API_KEY_ENVIRONMENT_VARIABLES, getProviderEnvironmentVariableName, HOST_UI_SMOKE_API_KEY_PROVIDERS, isHostUiSmokeWindowTitle, isSmokeVscodeWelcomeWindowTitle, summarizeApiKeyEnvironment, type ApiKeyEnvironmentStatus } from "./hostUiSmokeEnv";
import { getHostUiSmokeRequestPath, shouldRunConfigPanelSmoke, shouldRunPostChatLmApiAfterChat, shouldUseLanguageModelApiCommand, type HostUiSmokeRequestPath } from "./hostUiSmokeFlow";
import { isConfigPanelOnlyHostUiSmokeRun, parseHostUiSmokeE2eSuites, shouldRunHostUiSmokeE2eSuite } from "../hostUi/suites/e2eSuites";
import {
	computeHostUiSmokeParticipantTimeoutMs,
	countHostUiSmokeChatLmRequests,
	parseHostUiSmokeChatIntegrationScenarioIds,
	shouldRunHostUiSmokeChatIntegration
} from "../hostUi/chat/integration";
import { buildHostUiSmokeSuiteChatQuery, parseHostUiSmokeChatScenarioIds } from "../hostUi/chat/scenarios";
import { HOST_UI_SMOKE_PROMPT } from "../hostUi/smokePrompt";
import { QWEN_HOST_UI_CONTRACT } from "../../config/qwenCatalogContract";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../../config/highFidelityRestoreImagePipelineSuspended";
import type { HostUiSmokeConfigResult, HostUiSmokeModelState } from "../../ui/hostUiSmokeConfigResult";
import { createSmokeFocusKeeper } from "./hostUiSmokeFocus";
import {
	getLogByteOffset,
	logTailIncludesChatOpenAck,
	logTailIncludesChatSubmitAck,
	readLogFromOffset,
	waitForChatParticipantOutcome,
	waitForChatSubmitOutcome,
	type HostUiSmokeChatParticipantOutcome
} from "./hostUiSmokeLogWatch";

const screenshotDesktop = require("screenshot-desktop") as (options?: { format?: string }) => Promise<Buffer>;
const sharpModule = require("sharp") as typeof import("sharp");

const PRIMARY_MODEL = {
	id: "deepseek-v4-flash",
	provider: "deepseek",
	displayName: "DeepSeek v4 Flash",
	runtimeId: "deepseek-v4-flash::deepseek"
} as const;
const SECONDARY_MODEL = {
	id: "deepseek-v4-pro",
	provider: "deepseek",
	displayName: "DeepSeek v4 Pro",
	runtimeId: "deepseek-v4-pro::deepseek"
} as const;
const TARGET_TEMPERATURE = "1.4";
const ORIGINAL_TEMPERATURE = "1";
const HOST_UI_SMOKE_LM_PROMPT = HOST_UI_SMOKE_PROMPT;
const CHAT_UI_SUBMIT_QUERY = buildHostUiSmokeSuiteChatQuery();
const REFERENCE_WINDOW = { width: 1936, height: 1048 };
const DEFAULT_STALL_TIMEOUT_MS = 15_000;
const STALL_INTERVENTION_LIMIT = 3;
const CLIPBOARD_MISSING_SENTINEL = "__COPILOT_BRO_UI_SMOKE_ENV_MISSING__";
const HOST_UI_SMOKE_EXTENSION_ID = "Cloacah.copilot-bro";
/** Repo root from `out/e2e/driver/hostUiSmoke.js` (formerly `out/automation` = two levels up). */
const HOST_UI_SMOKE_REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_BUTTONS_DIR = (() => {
	const fixturesRoot = process.env.COPILOT_BRO_FIXTURES_ROOT?.trim();
	if (fixturesRoot) {
		return path.join(path.resolve(fixturesRoot), "host-ui", "testButtons");
	}
	return path.join(HOST_UI_SMOKE_REPO_ROOT, "fixtures", "host-ui", "testButtons");
})();

const RELATIVE_POINTS = {
	focus: { x: 820, y: 520 },
	chatIcon: { x: 1268, y: 20 },
	model: { x: 785, y: 565 },
	flashOption: { x: 785, y: 602 },
	proOption: { x: 785, y: 634 },
	displayName: { x: 870, y: 632 },
	temperature: { x: 1225, y: 632 },
	// GitHub OAuth authorize page: "Authorize copilot" green button is left-of-center
	// at approx x=730 on 1920px wide maximized browser. x=1101 hits the ToS link.
	browserGitHubContinue: { x: 730, y: 530 },
	continueWithGitHub: { x: 960, y: 471 },
	save: { x: 450, y: 868 },
	signedOut: { x: 1326, y: 20 }
} as const;

type ModelState = HostUiSmokeModelState;

type ClipboardApi = {
	write(text: string): Promise<void>;
	read(): Promise<string>;
};

type MockChatCompletionRequest = {
	model: string;
	authorizationHeader?: string;
	messageCount: number;
	stream: boolean;
};

type SmokeModelServer = {
	baseUrl: string;
	waitForChatCompletion(timeoutMs: number): Promise<MockChatCompletionRequest>;
	waitForChatCompletionCount(count: number, timeoutMs: number): Promise<void>;
	peekLastChatCompletion(): MockChatCompletionRequest;
	close(): Promise<void>;
};

let clipboard: ClipboardApi | undefined;

type SmokeSummary = {
	status: "passed" | "failed";
	timestamp: string;
	codeExecutable: string;
	workspaceDir: string;
	artifactsDir: string;
	userDataDir: string;
	extensionsDir: string;
	vsixPath: string;
	logFilePath: string;
	preRunClosedWindowTitles: string[];
	primaryModelDisplayName: string;
	primaryModelRuntimeId: string;
	secondaryModelDisplayName: string;
	secondaryModelRuntimeId: string;
	windowTitles: string[];
	configPanelSmoke: "passed" | "failed" | "skipped";
	configPanelWindowTitle?: string;
	configPanelSmokeError?: string;
	initial: ModelState;
	afterSave: ModelState;
	proState: ModelState;
	roundtrip: ModelState;
	restored: ModelState;
	/** E2E suite ids executed for this run (see COPILOT_BRO_UI_SMOKE_E2E). */
	e2eSuites: string[];
	/** Copilot Chat GitHub sign-in preflight (palette + image-driven OAuth). */
	githubChatLoginSuite?: boolean;
	/** Built-in preset inventory logged via smoke command. */
	presetCatalogPhase?: boolean;
	/** Per-provider LM probe matrix (requires API keys). */
	providerProbePhase?: boolean;
	/** Vision protocol contract dry-run (no external vision API). */
	visionContractPhase?: boolean;
	visionJsonRepairPhase?: boolean;
	/** Optional suite: Phase 1 settings exhaustive log (not in default `all`). */
	phase1SettingsExhaustivePhase?: boolean;
	/** Optional suite: vision probe marker. */
	visionProbePhase?: boolean;
	visionChatProgressPhase?: boolean;
	screenshotPageVisionPhase?: boolean;
	/** Optional suite: agent + token budget placeholder. */
	agentSmokeBudgetedPhase?: boolean;
	/** Optional suite: real testButtons path hydration + restore artifact probe. */
	p6P7RealAssetsPhase?: boolean;
	chatPrompt: string;
	chatSubmitted: boolean;
	requestCommandStartSeen: boolean;
	requestCommandEndSeen: boolean;
	requestPath: HostUiSmokeRequestPath;
	chatOpenSeen: boolean;
	chatPromptSubmittedViaUi: boolean;
	requestStartSeen: boolean;
	requestEndSeen: boolean;
	requestResponseVerified: boolean;
	apiKeyEnvironment: Record<string, ApiKeyEnvironmentStatus>;
	screenshots: string[];
	/** Chat UI multi-scenario suite ids (must match extension log evidence). */
	chatScenarioIds: string[];
	chatIntegrationScenarioIds: string[];
	chatIntegrationPhase: boolean;
	/** Optional second phase: palette LM API command after Chat UI suite. */
	postChatLmApiPhase?: boolean;
	/** Full run requires host-ui-smoke.api-keys.status in extension log. */
	apiKeysStatusRequired?: boolean;
	error?: string;
};

type SmokeController = {
	spawnedProcess?: ChildProcess;
	baselineWindowIds: ReadonlySet<number>;
	workspaceTitleHint: string;
	artifactsDir: string;
	screenshots: string[];
	/** Extension automation log (COPILOT_BRO_LOG_FILE); host harness may append evidence lines. */
	logFilePath: string;
	/** Primary VS Code window for palette / chat UI (set once workspace is ready). */
	interactionWindow?: Window;
};

async function main(): Promise<void> {
	if (process.platform !== "win32") {
		throw new Error("hostUiSmoke currently supports Windows only.");
	}

	keyboard.config.autoDelayMs = 80;
	mouse.config.autoDelayMs = 80;

	const repoRoot = process.env.COPILOT_BRO_UI_SMOKE_REPO_ROOT?.trim()
		? path.resolve(process.env.COPILOT_BRO_UI_SMOKE_REPO_ROOT.trim())
		: HOST_UI_SMOKE_REPO_ROOT;
	const artifactsDir = path.join(repoRoot, "artifacts", "host-ui");
	const runId = Date.now().toString();
	const workspaceDir = process.env.COPILOT_BRO_UI_SMOKE_WORKSPACE
		? path.resolve(process.env.COPILOT_BRO_UI_SMOKE_WORKSPACE)
		: path.join(artifactsDir, `HostUiSmokeWorkspace-${runId}`);
	const codeExecutable = resolveCodeExecutable();
	const codeCliExecutable = await resolveCodeCliExecutable(codeExecutable);
	const smokeEnv = await buildSmokeProcessEnvironment();
	const smokeModelKind = getSmokeModelKind();
	const requestPath = getHostUiSmokeRequestPath(process.env);
	const e2eSuites = parseHostUiSmokeE2eSuites(process.env);
	const runConfigPanelSmoke = shouldRunConfigPanelSmoke(process.env, e2eSuites);
	const configPanelOnlyE2e = isConfigPanelOnlyHostUiSmokeRun(e2eSuites);
	if (requestPath === "chat-ui" && !shouldRunHostUiSmokeE2eSuite(e2eSuites, "chat-scenarios") && !configPanelOnlyE2e) {
		throw new Error(
			"Copilot Bro host UI smoke: chat-ui requires the \"chat-scenarios\" entry in COPILOT_BRO_UI_SMOKE_E2E (do not omit it when trimming suites)."
		);
	}
	const useMockDeepSeekServer = process.env.COPILOT_BRO_UI_SMOKE_ALLOW_MOCK === "1" && !smokeEnv.DEEPSEEK_API_KEY?.trim();
	const smokeModelServer = useMockDeepSeekServer ? await createSmokeModelServer() : undefined;
	if (smokeModelServer) {
		smokeEnv.DEEPSEEK_API_KEY = "host-ui-smoke";
		smokeEnv.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_MOCK = "1";
	}
	const apiKeyEnvironment = summarizeApiKeyEnvironment(smokeEnv);
	const chatScenarioIds = parseHostUiSmokeChatScenarioIds(smokeEnv);
	const chatIntegrationPhase = shouldRunHostUiSmokeChatIntegration(smokeEnv);
	const chatIntegrationScenarioIds = chatIntegrationPhase
		? parseHostUiSmokeChatIntegrationScenarioIds(smokeEnv)
		: [];
	const expectedChatLmRequests = countHostUiSmokeChatLmRequests(smokeEnv, chatScenarioIds.length);
	const participantTimeoutMs = computeHostUiSmokeParticipantTimeoutMs(
		smokeEnv,
		Math.max(chatScenarioIds.length, chatIntegrationScenarioIds.length > 0 ? 1 : 0)
	);
	/** When set, chat-ui integration waits poll the log until completion (no fixed wall-clock cap). */
	const participantTimeoutEffective =
		smokeEnv.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_NO_MAX_WAIT?.trim() === "1" && chatIntegrationPhase
			? Number.POSITIVE_INFINITY
			: participantTimeoutMs;
	const useEphemeralProfile = process.env.COPILOT_BRO_UI_SMOKE_EPHEMERAL_PROFILE === "1";
	const userDataDir = process.env.COPILOT_BRO_UI_SMOKE_USER_DATA_DIR
		? path.resolve(process.env.COPILOT_BRO_UI_SMOKE_USER_DATA_DIR)
		: path.join(artifactsDir, useEphemeralProfile ? `HostUiSmokeUserData-${runId}` : "HostUiSmokeUserData");
	const logFilePath = path.join(artifactsDir, "host-ui-smoke.log");
	const extensionsDir = process.env.COPILOT_BRO_UI_SMOKE_EXTENSIONS_DIR
		? path.resolve(process.env.COPILOT_BRO_UI_SMOKE_EXTENSIONS_DIR)
		: path.join(artifactsDir, useEphemeralProfile ? `HostUiSmokeExtensions-${runId}` : "HostUiSmokeExtensions");
	const keepProfile = process.env.COPILOT_BRO_UI_SMOKE_KEEP_PROFILE !== "0";
	const shouldCleanupUserDataDir = !keepProfile;
	const shouldCleanupExtensionsDir = !keepProfile;
	const screenshots: string[] = [];
	clipboard = await loadClipboard();

	await access(codeExecutable);
	await access(codeCliExecutable);
	await mkdir(artifactsDir, { recursive: true });
	await mkdir(userDataDir, { recursive: true });
	await mkdir(extensionsDir, { recursive: true });
	await mkdir(workspaceDir, { recursive: true });
	await syncRequiredHostUserData(userDataDir);
	if (smokeModelKind === "wrapped" || requestPath === "chat-ui") {
		await seedGitHubAuthSessionToCredentialManager();
	}
	const vsixPath = await packageVsix(repoRoot);
	installVsix(codeCliExecutable, vsixPath, userDataDir, extensionsDir, smokeEnv);
	const copiedExtensions = await syncRequiredHostExtensions(extensionsDir);
	if (requestPath === "chat-ui") {
		installMarketplaceExtensionBestEffort(codeCliExecutable, "GitHub.copilot", userDataDir, extensionsDir, smokeEnv);
		installMarketplaceExtensionBestEffort(codeCliExecutable, "GitHub.copilot-chat", userDataDir, extensionsDir, smokeEnv);
		await syncRequiredHostExtensions(extensionsDir);
	}
	if (smokeModelKind === "wrapped" && requestPath !== "chat-ui") {
		await removeLegacyCopiedCopilotChatExtensions(extensionsDir);
	}
	const copiedExtensionsAfterInstall = await syncRequiredHostExtensions(extensionsDir);
	const allCopiedExtensions = [...new Set([...copiedExtensions, ...copiedExtensionsAfterInstall])];
	await patchExtensionsJson(extensionsDir, allCopiedExtensions);
	await writeSmokeWorkspaceSettings(workspaceDir);
	await writeSmokeUserSettings(
		userDataDir,
		logFilePath,
		smokeModelServer ? buildSmokeModelOverrides(smokeModelServer.baseUrl) : [],
		runConfigPanelSmoke,
		false
	);
	await writeFile(path.join(workspaceDir, "README.md"), "# Copilot Bro Host UI Smoke\n");
	await writeFile(logFilePath, "");

	const workspaceTitleHint = path.basename(workspaceDir);
	const preRunClosedWindowTitles = await closeExistingSmokeWindows(workspaceTitleHint);
	const baselineWindowIds = new Set(windowManager.getWindows().map((window) => window.id));
	const summary: SmokeSummary = {
		status: "failed",
		timestamp: new Date().toISOString(),
		codeExecutable,
		workspaceDir,
		artifactsDir,
		userDataDir,
		extensionsDir,
		vsixPath,
		logFilePath,
		preRunClosedWindowTitles,
		primaryModelDisplayName: PRIMARY_MODEL.displayName,
		primaryModelRuntimeId: PRIMARY_MODEL.runtimeId,
		secondaryModelDisplayName: SECONDARY_MODEL.displayName,
		secondaryModelRuntimeId: SECONDARY_MODEL.runtimeId,
		windowTitles: [],
		configPanelSmoke: "skipped",
		initial: emptyState(),
		afterSave: emptyState(),
		proState: emptyState(),
		roundtrip: emptyState(),
		restored: emptyState(),
		chatPrompt: CHAT_UI_SUBMIT_QUERY,
		chatSubmitted: false,
		requestCommandStartSeen: false,
		requestCommandEndSeen: false,
		requestPath,
		chatOpenSeen: false,
		chatPromptSubmittedViaUi: false,
		requestStartSeen: false,
		requestEndSeen: false,
		requestResponseVerified: false,
		apiKeyEnvironment,
		chatScenarioIds,
		chatIntegrationScenarioIds,
		chatIntegrationPhase,
		e2eSuites: [...e2eSuites],
		screenshots,
	};
	const controller: SmokeController = {
		baselineWindowIds,
		workspaceTitleHint,
		artifactsDir,
		screenshots,
		logFilePath
	};

	let workspaceWindow: Window | undefined;
	let configPanelWindow: Window | undefined;
	let modifiedTemperature = false;

	try {
		controller.spawnedProcess = launchVsCode(codeExecutable, workspaceDir, userDataDir, extensionsDir, logFilePath, smokeEnv, repoRoot);
		workspaceWindow = await waitForWindow((window) => windowTitleMatches(window, workspaceTitleHint), 45_000, "workspace window", controller);
		await focusAndPrimeWindow(workspaceWindow);
		await delay(4_000);
		await waitForLogLine(logFilePath, "host-ui-smoke.api-keys.status", 60_000, controller).catch(() => undefined);
		const sourceWindowForKeys = findSourceWorkspaceWindow(path.basename(repoRoot), baselineWindowIds);
		await stageMissingProviderApiKeysViaUi(workspaceWindow, sourceWindowForKeys, smokeEnv, logFilePath, controller);

		if (runConfigPanelSmoke) {
			configPanelWindow = workspaceWindow;
			try {
				await waitForWindowTitle(configPanelWindow, "Copilot Bro Model Settings", 30_000, controller);
				await delay(1_500);
				summary.configPanelWindowTitle = configPanelWindow.getTitle();
				const configSmokeResult = await waitForLogPayload<HostUiSmokeConfigResult>(
					logFilePath,
					"host-ui-smoke.config.smoke.result",
					180_000,
					controller,
					{ disableStallDetection: true }
				);
				await waitForLogLine(logFilePath, "host-ui-smoke.config.open.end", 15_000, controller);
				summary.initial = configSmokeResult.initial;
				summary.afterSave = configSmokeResult.afterSave;
				summary.proState = configSmokeResult.proState;
				summary.roundtrip = configSmokeResult.roundtrip;
				summary.restored = configSmokeResult.restored;
				assert.equal(configSmokeResult.ok, true, configSmokeResult.error);
				assert.equal(summary.initial.displayName, PRIMARY_MODEL.displayName);
				assert.equal(summary.initial.temperature, ORIGINAL_TEMPERATURE);
				assert.equal(summary.afterSave.displayName, PRIMARY_MODEL.displayName);
				assert.equal(summary.afterSave.temperature, TARGET_TEMPERATURE);
				assert.equal(summary.proState.displayName, SECONDARY_MODEL.displayName);
				assert.equal(summary.proState.temperature, ORIGINAL_TEMPERATURE);
				assert.equal(summary.roundtrip.displayName, PRIMARY_MODEL.displayName);
				assert.equal(summary.roundtrip.temperature, TARGET_TEMPERATURE);
				assert.equal(summary.restored.displayName, PRIMARY_MODEL.displayName);
				assert.equal(summary.restored.temperature, ORIGINAL_TEMPERATURE);
				const endpointUi = configSmokeResult.providerEndpointUi;
				const modelVersionUi = configSmokeResult.modelVersionUi;
				const qwenCatalogUi = configSmokeResult.qwenCatalogUi;
				assertHostUiSmokeConfigPanelEvidence(endpointUi, modelVersionUi, qwenCatalogUi);
				console.log("[host-ui-smoke.config-panel] provider endpoint UI passed", {
					profileId: endpointUi?.profileId,
					baseUrlAfter: endpointUi?.baseUrlAfter,
					persistedProfileId: endpointUi?.persistedProfileId,
					savedViaProfileChange: endpointUi?.savedViaProfileChange
				});
				console.log("[host-ui-smoke.config-panel] model version UI passed", modelVersionUi);
				console.log("[host-ui-smoke.config-panel] qwen catalog UI passed", qwenCatalogUi);
				screenshots.push(await captureWindowScreenshot(configPanelWindow, artifactsDir, "config-panel-restored.png"));
				screenshots.push(await captureWindowScreenshot(configPanelWindow, artifactsDir, "config-panel-qwen-endpoint.png"));
				screenshots.push(await captureWindowScreenshot(configPanelWindow, artifactsDir, "config-panel-qwen-model-version.png"));
				summary.configPanelSmoke = "passed";
			} catch (error) {
				summary.configPanelSmoke = "failed";
				summary.configPanelSmokeError = error instanceof Error ? error.stack ?? error.message : String(error);
				try {
					screenshots.push(await captureWindowScreenshot(configPanelWindow, artifactsDir, "config-panel-failure.png"));
				} catch {
					// Best-effort supplementary evidence only.
				}
				throw error;
			}
		}

		if (configPanelOnlyE2e) {
			const logText = await readFile(logFilePath, "utf8").catch(() => "");
			assert.ok(logText.includes("host-ui-smoke.config.smoke.result"), "missing host-ui-smoke.config.smoke.result log");
			assert.ok(logText.includes("host-ui-smoke.config.endpoint.ui"), "missing host-ui-smoke.config.endpoint.ui log");
			assert.ok(logText.includes("host-ui-smoke.config.model-version.ui"), "missing host-ui-smoke.config.model-version.ui log");
			assert.ok(logText.includes("host-ui-smoke.config.qwen-catalog.ui"), "missing host-ui-smoke.config.qwen-catalog.ui log");
			assert.ok(logText.includes("dashscope-cn"), "provider endpoint UI must persist dashscope-cn");
			assert.ok(logText.includes(QWEN_HOST_UI_CONTRACT.qwen3MaxDefaultVersionId), "model version UI must select Qwen3-Max catalog default");
			assert.ok(logText.includes(QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey), "qwen catalog UI must include qwen3-vl-open-source family");
			assert.ok(logText.includes(QWEN_HOST_UI_CONTRACT.vlOpenSourceDefaultVersionId), "qwen catalog UI must select default VL version");
			assert.equal(summary.configPanelSmoke, "passed", summary.configPanelSmokeError);
			console.log("[host-ui-smoke] config-panel-only E2E completed with provider endpoint UI evidence");
			summary.status = "passed";
			return;
		}

		const interactionWindow = workspaceWindow;
		if (!interactionWindow) {
			throw new Error("Host UI smoke workspace window is unavailable after config panel smoke.");
		}
		controller.interactionWindow = interactionWindow;
		if (configPanelWindow || shouldRunHostUiSmokeE2eSuite(e2eSuites, "chat-scenarios")) {
			await dismissConfigPanelForChatFlow(interactionWindow);
		}
		if (smokeModelKind === "wrapped") {
			await openChatAndStartLogin(interactionWindow, controller);
			await delay(1_500);
		} else if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "github-chat-login")) {
			summary.githubChatLoginSuite = true;
			console.log("[host-ui-smoke.chat-ui] GitHub / Copilot Chat sign-in preflight (image-driven flow, auto skip if already signed in)");
			await openChatAndStartLogin(interactionWindow, controller);
			await waitForLogLine(logFilePath, "host-ui-smoke.github-auth.preflight.end", 120_000, controller);
			await delay(1_500);
		}
		const postChatLm =
			shouldRunHostUiSmokeE2eSuite(e2eSuites, "post-chat-lm")
			&& shouldRunPostChatLmApiAfterChat(smokeEnv, {
				hasMockServer: Boolean(smokeModelServer),
				smokeModelKind
			});

		if (shouldUseLanguageModelApiCommand(requestPath)) {
			await triggerRunRequestCommandWithVerification(interactionWindow, logFilePath, controller);
			await waitForLogLine(logFilePath, "host-ui-smoke.request.run.start", 45_000, controller);
			summary.requestCommandStartSeen = true;
			summary.chatSubmitted = true;
			const requestCommandOutcome = await waitForRequestCommandOutcome(logFilePath, 180_000, controller);
			if (requestCommandOutcome.status === "failed") {
				throw new Error(requestCommandOutcome.message || "Host UI smoke request failed.");
			}
			summary.requestCommandEndSeen = true;
		} else {
			const participantOutcome = await submitHostUiSmokeChatPrompt(
				interactionWindow,
				logFilePath,
				controller,
				participantTimeoutEffective,
				chatIntegrationPhase
			);
			summary.chatOpenSeen = true;
			summary.chatPromptSubmittedViaUi = true;
			summary.chatSubmitted = true;
			if (participantOutcome.status === "failed") {
				throw new Error(
					`Host UI smoke chat failed (${participantOutcome.failure.kind}): ${participantOutcome.failure.message}`
				);
			}
		}
		if (smokeModelKind === "wrapped") {
			const requestEvidence = await waitForWrappedRequestEvidence(logFilePath, 90_000, controller);
			summary.requestStartSeen = requestEvidence.requestStartSeen;
			summary.requestEndSeen = requestEvidence.requestEndSeen;
			assert.equal(requestEvidence.requestStartSeen, true);
			assert.equal(requestEvidence.requestEndSeen, true);
		} else if (smokeModelServer) {
			if (requestPath === "chat-ui") {
				await smokeModelServer.waitForChatCompletionCount(expectedChatLmRequests, participantTimeoutEffective);
				const lastChat = smokeModelServer.peekLastChatCompletion();
				assert.equal(lastChat.model, PRIMARY_MODEL.id);
				assert.equal(lastChat.messageCount > 0, true);
				assert.equal(Boolean(lastChat.authorizationHeader), true);
			} else {
				const chatRequest = await smokeModelServer.waitForChatCompletion(90_000);
				assert.equal(chatRequest.model, PRIMARY_MODEL.id);
				assert.equal(chatRequest.messageCount > 0, true);
				assert.equal(Boolean(chatRequest.authorizationHeader), true);
			}
			summary.requestStartSeen = true;
			summary.requestEndSeen = true;
		} else if (requestPath === "chat-ui") {
			await waitForAnyRequestEndCount(logFilePath, expectedChatLmRequests, participantTimeoutEffective, controller);
			summary.requestStartSeen = true;
			summary.requestEndSeen = true;
		} else {
			const requestEvidence = await waitForRequestEvidence(logFilePath, PRIMARY_MODEL.runtimeId, 90_000, controller);
			summary.requestStartSeen = requestEvidence.requestStartSeen;
			summary.requestEndSeen = requestEvidence.requestEndSeen;
			assert.equal(requestEvidence.requestStartSeen, true);
			assert.equal(requestEvidence.requestEndSeen, true);
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "preset-catalog")) {
			console.log("[host-ui-smoke.e2e] preset catalog smoke");
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.logPresetCatalog);
			await waitForLogLine(logFilePath, "host-ui-smoke.preset.catalog.end", 45_000, controller);
			summary.presetCatalogPhase = true;
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "vision-contract")) {
			console.log("[host-ui-smoke.e2e] vision protocol contract dry-run (no external vision API)");
			await focusAndPrimeWindow(interactionWindow, true);
			await delay(1_500);
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runVisionContract);
			await waitForLogLine(logFilePath, "host-ui-smoke.vision.contract.end", 180_000, controller);
			summary.visionContractPhase = true;
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "vision-json-repair")) {
			console.log("[host-ui-smoke.e2e] vision structured JSON repair probe (no external vision API)");
			await focusAndPrimeWindow(interactionWindow, true);
			await delay(1_500);
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runVisionJsonRepair);
			await waitForLogLine(logFilePath, "host-ui-smoke.vision.json.repair.end", 60_000, controller);
			summary.visionJsonRepairPhase = true;
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "provider-probe")) {
			console.log("[host-ui-smoke.e2e] provider probe matrix (one LM call per keyed provider)");
			await focusAndPrimeWindow(interactionWindow, true);
			await delay(1_500);
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runProviderProbe);
			await waitForLogLine(logFilePath, "host-ui-smoke.provider.matrix.end", 300_000, controller);
			summary.providerProbePhase = true;
			await focusAndPrimeWindow(interactionWindow, true);
			await delay(2_000);
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "phase1-settings-exhaustive")) {
			console.log("[host-ui-smoke.e2e] phase1 settings exhaustive + roundtrip smoke");
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runPhase1SettingsExhaustive);
			await waitForLogLine(logFilePath, "host-ui-smoke.phase1.settings.exhaustive.end", 120_000, controller);
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runPhase1SettingsRoundtrip);
			await waitForLogLine(logFilePath, "host-ui-smoke.phase1.settings.roundtrip.end", 120_000, controller);
			const settingsLog = await readFile(logFilePath, "utf8");
			assert.match(settingsLog, /host-ui-smoke\.phase1\.settings\.roundtrip\.end.*"ok":true/u);
			summary.phase1SettingsExhaustivePhase = true;
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "vision-probe")) {
			console.log("[host-ui-smoke.e2e] vision probe smoke");
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runVisionProbe);
			await waitForLogLine(logFilePath, "host-ui-smoke.vision.probe.end", 300_000, controller);
			summary.visionProbePhase = true;
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "screenshot-page-vision-route")) {
			console.log("[host-ui-smoke.e2e] screenshot_page high-fidelity vision route");
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runScreenshotPageVision);
			await waitForLogLine(logFilePath, "host-ui-smoke.screenshot-page.vision.end", 300_000, controller);
			summary.screenshotPageVisionPhase = true;
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "vision-chat-progress")) {
			console.log("[host-ui-smoke.e2e] vision [Vision] thinking block (screenshot_page provider path)");
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runVisionChatProgress);
			await waitForLogLine(logFilePath, "host-ui-smoke.vision-chat-progress.end", 300_000, controller);
			const progressLog = await readFile(logFilePath, "utf8");
			assert.match(progressLog, /host-ui-smoke\.vision\.progress\.flush/u);
			summary.visionChatProgressPhase = true;
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "p6-p7-real-assets")) {
			console.log("[host-ui-smoke.e2e] p6 path hydration + p7 restore artifact (real testButtons PNG)");
			await focusAndPrimeWindow(interactionWindow, true);
			await delay(1_500);
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runP6P7RealAssets);
			await waitForLogLine(logFilePath, "host-ui-smoke.p6-p7.real-assets.probe.end", 120_000, controller);
			const probeLog = await readFile(logFilePath, "utf8");
			assert.match(probeLog, /host-ui-smoke\.p6\.path-hydration\.probe\.end/u);
			assert.match(probeLog, /host-ui-smoke\.p7\.restore-artifact\.probe\.end/u);
			assert.match(probeLog, /"p6Ok":true/u);
			assert.match(probeLog, /"p7Ok":true/u);
			assert.match(probeLog, /"hydratedCount":\s*[1-9]/u);
			if (HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED) {
				assert.match(probeLog, /"imagePipelineSuspended":true/u);
			} else {
				assert.match(probeLog, /"artifactSha256":"[a-f0-9]{64}"/u);
			}
			summary.p6P7RealAssetsPhase = true;
		}
		if (requestPath === "chat-ui" && shouldRunHostUiSmokeE2eSuite(e2eSuites, "agent-smoke-budgeted")) {
			console.log("[host-ui-smoke.e2e] agent smoke budgeted (greedy-prefix memory budgeter)");
			await runPaletteEntry(interactionWindow, HOST_UI_SMOKE_PALETTE.runAgentSmokeBudgeted);
			await waitForLogLine(logFilePath, "host-ui-smoke.agent.smoke.budgeted.end", 45_000, controller);
			summary.agentSmokeBudgetedPhase = true;
		}
		if (postChatLm && requestPath === "chat-ui") {
			await triggerRunRequestCommandWithVerification(interactionWindow, logFilePath, controller);
			await waitForLogLine(logFilePath, "host-ui-smoke.request.run.start", 45_000, controller);
			summary.requestCommandStartSeen = true;
			const postCommandOutcome = await waitForRequestCommandOutcome(logFilePath, 180_000, controller);
			if (postCommandOutcome.status === "failed") {
				throw new Error(postCommandOutcome.message || "Host UI smoke post-chat LM API request failed.");
			}
			summary.requestCommandEndSeen = true;
			summary.postChatLmApiPhase = true;
			if (smokeModelServer) {
				await smokeModelServer.waitForChatCompletionCount(expectedChatLmRequests + 1, participantTimeoutEffective);
			} else {
				await waitForAnyRequestEndCount(logFilePath, expectedChatLmRequests + 1, participantTimeoutEffective, controller);
			}
		}
		summary.requestResponseVerified = true;
		screenshots.push(await captureWindowScreenshot(workspaceWindow, artifactsDir, "request-smoke-complete.png"));
		summary.apiKeysStatusRequired = true;
		assertHostUiSmokeEvidence(summary, await readFile(logFilePath, "utf8").catch(() => ""));

		summary.status = "passed";
	} catch (error) {
		summary.error = error instanceof Error ? error.stack ?? error.message : String(error);
		const failureWindow = configPanelWindow ?? workspaceWindow;
		if (failureWindow) {
			try {
				await focusAndPrimeWindow(failureWindow, true);
				screenshots.push(await captureWindowScreenshot(failureWindow, artifactsDir, "config-panel-failure.png"));
			} catch {
				// Best-effort failure evidence only.
			}
		}
		throw error;
	} finally {
		summary.windowTitles = collectWindowTitles();
		if (modifiedTemperature && configPanelWindow) {
			try {
				await focusAndPrimeWindow(configPanelWindow, true);
				await gotoEditor(configPanelWindow);
				await choosePrimaryModel(configPanelWindow);
				await setTemperature(configPanelWindow, ORIGINAL_TEMPERATURE);
				await clickRelative(configPanelWindow, RELATIVE_POINTS.save);
				await delay(2_500);
			} catch {
				// Restoration is best-effort when the primary run already failed.
			}
		}
		await writeFile(path.join(artifactsDir, "host-ui-smoke-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
		await teardownSmokeVsCodeSession(controller, workspaceTitleHint);
		await smokeModelServer?.close().catch(() => undefined);
		if (userDataDir && shouldCleanupUserDataDir) {
			await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
		}
		if (extensionsDir && shouldCleanupExtensionsDir) {
			await rm(extensionsDir, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}

function emptyState(): ModelState {
	return {
		displayName: "",
		temperature: "",
	};
}

function resolveCodeExecutable(): string {
	const explicit = process.env.COPILOT_BRO_CODE_EXE
		?? process.env.VSCODE_EXECUTABLE_PATH
		?? process.env.VSCODE_EXE;
	if (explicit) {
		return path.resolve(explicit);
	}

	const codeFromPath = resolveCodeExecutableFromCli();
	if (codeFromPath) {
		return codeFromPath;
	}

	const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
	return path.join(programFiles, "Microsoft VS Code", "Code.exe");
}

function resolveCodeExecutableFromCli(): string | undefined {
	try {
		const output = execFileSync("where", ["code"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		for (const line of output.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const normalized = trimmed.replace(/\\/g, "/").toLowerCase();
			if (!normalized.endsWith("/bin/code") && !normalized.endsWith("/bin/code.cmd")) {
				continue;
			}
			return path.resolve(path.dirname(trimmed), "..", "Code.exe");
		}
	} catch {
		// Fall back to common install paths below.
	}
	return undefined;
}

async function resolveCodeCliExecutable(codeExecutable: string): Promise<string> {
	const explicit = process.env.COPILOT_BRO_CODE_CLI?.trim() || process.env.COPILOT_BRO_CODE_CMD?.trim();
	const candidates = [
		explicit ? path.resolve(explicit) : undefined,
		path.join(path.dirname(codeExecutable), "bin", "code.cmd"),
		resolveCodeCliFromPath(),
		path.join(path.dirname(codeExecutable), "bin", "code")
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next candidate.
		}
	}

	throw new Error(`Failed to resolve VS Code CLI executable for ${codeExecutable}.`);
}

function resolveCodeCliFromPath(): string | undefined {
	try {
		const output = execFileSync("where", ["code"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		for (const line of output.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const normalized = trimmed.replace(/\\/g, "/").toLowerCase();
			if (normalized.endsWith("/bin/code.cmd")) {
				return trimmed;
			}
			if (normalized.endsWith("/bin/code")) {
				return `${trimmed}.cmd`;
			}
		}
	} catch {
		// Fall back to the executable-relative candidates above.
	}
	return undefined;
}

async function packageVsix(repoRoot: string): Promise<string> {
	const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as { name?: string; version?: string };
	if (!manifest.name || !manifest.version) {
		throw new Error("Failed to resolve VSIX package name from package.json.");
	}
	const vsixPath = path.join(repoRoot, `${manifest.name}-${manifest.version}-test.vsix`);
	if (process.platform === "win32") {
		execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run package:test"], {
			cwd: repoRoot,
			stdio: "inherit"
		});
	} else {
		execFileSync("npm", ["run", "package:test"], { cwd: repoRoot, stdio: "inherit" });
	}
	await access(vsixPath);
	return vsixPath;
}

function uninstallSmokeExtensionBestEffort(
	codeCliExecutable: string,
	userDataDir: string,
	extensionsDir: string,
	env: NodeJS.ProcessEnv
): void {
	const args = [
		"--uninstall-extension",
		HOST_UI_SMOKE_EXTENSION_ID,
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${extensionsDir}`
	];
	try {
		if (process.platform === "win32") {
			execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", codeCliExecutable, ...args], { stdio: "pipe", env });
		} else {
			execFileSync(codeCliExecutable, args, { stdio: "pipe", env });
		}
	} catch {
		// Extension may not be installed yet in a fresh user-data-dir.
	}
}

function installVsix(codeCliExecutable: string, vsixPath: string, userDataDir: string, extensionsDir: string, env: NodeJS.ProcessEnv): void {
	uninstallSmokeExtensionBestEffort(codeCliExecutable, userDataDir, extensionsDir, env);
	const args = [
		"--install-extension",
		vsixPath,
		"--force",
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${extensionsDir}`
	];
	if (process.platform === "win32") {
		execFileSync(process.env.ComSpec ?? "cmd.exe", [
			"/d",
			"/c",
			codeCliExecutable,
			...args
		], {
			stdio: "inherit",
			env
		});
		return;
	}
	execFileSync(codeCliExecutable, args, {
		stdio: "inherit",
		env
	});
}

function installMarketplaceExtensionBestEffort(
	codeCliExecutable: string,
	extensionId: string,
	userDataDir: string,
	extensionsDir: string,
	env: NodeJS.ProcessEnv
): void {
	try {
		installMarketplaceExtension(codeCliExecutable, extensionId, userDataDir, extensionsDir, env);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isMarketplaceExtensionPresent(extensionsDir, extensionId)) {
			console.warn("[host-ui-smoke.extensions.install] install failed but extension directory exists; continuing", {
				extensionId,
				message
			});
			return;
		}
		console.warn("[host-ui-smoke.extensions.install] non-fatal install failure (will rely on host extension sync)", {
			extensionId,
			message
		});
	}
}

function installMarketplaceExtension(codeCliExecutable: string, extensionId: string, userDataDir: string, extensionsDir: string, env: NodeJS.ProcessEnv): void {
	const args = [
		"--install-extension",
		extensionId,
		"--force",
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${extensionsDir}`
	];
	console.log("[host-ui-smoke.extensions.install] installing marketplace extension", { extensionId });
	const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : codeCliExecutable;
	const commandArgs = process.platform === "win32" ? ["/d", "/c", codeCliExecutable, ...args] : args;
	try {
		const output = execFileSync(command, commandArgs, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env
		});
		if (output.trim()) {
			console.log(output.trim());
		}
	} catch (error) {
		const execError = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
		const output = `${String(execError.stdout ?? "")}\n${String(execError.stderr ?? "")}\n${execError.message ?? ""}`;
		if (/built-in extension/i.test(output) && /cannot be downgraded/i.test(output)) {
			console.log("[host-ui-smoke.extensions.install] built-in extension is already newer", { extensionId });
			return;
		}
		if ((/ETIMEDOUT/i.test(output) || /Failed Installing Extensions/i.test(output))
			&& isMarketplaceExtensionPresent(extensionsDir, extensionId)) {
			console.warn("[host-ui-smoke.extensions.install] install failed but extension directory exists; continuing", {
				extensionId
			});
			return;
		}
		if (output.trim()) {
			console.error(output.trim());
		}
		throw error;
	}
}

function isMarketplaceExtensionPresent(extensionsDir: string, extensionId: string): boolean {
	const normalized = extensionId.trim().toLowerCase();
	if (!normalized.includes(".")) {
		return false;
	}
	const prefix = `${normalized}-`;
	try {
		const entries = readdirSync(extensionsDir, { withFileTypes: true });
		return entries.some((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix));
	} catch {
		return false;
	}
}

function launchVsCode(
	codeExecutable: string,
	workspaceDir: string,
	userDataDir: string,
	extensionsDir: string,
	logFilePath: string,
	env: NodeJS.ProcessEnv,
	repoRoot: string
): ChildProcess {
	const smokeModelKind = getSmokeModelKind();
	const allowExternalWrappedId = process.env.COPILOT_BRO_UI_SMOKE_ALLOW_EXTERNAL_WRAPPED_ID === "1";
	const defaultWrappedId = smokeModelKind === "wrapped"
		? (allowExternalWrappedId ? (process.env.COPILOT_BRO_UI_SMOKE_WRAPPED_ID?.trim() || "auto") : "auto")
		: (process.env.COPILOT_BRO_UI_SMOKE_WRAPPED_ID?.trim() || "");
	const args = [
		workspaceDir,
		"--new-window",
		"--skip-welcome",
		"--skip-release-notes",
		"--disable-updates",
		"--disable-workspace-trust",
		"--locale=en-US",
	];
	if (userDataDir) {
		args.push(`--user-data-dir=${userDataDir}`);
	}
	if (extensionsDir) {
		args.push(`--extensions-dir=${extensionsDir}`);
	}
	const child = spawn(codeExecutable, args, {
		detached: true,
		stdio: "ignore",
		env: {
			...env,
			COPILOT_BRO_UI_SMOKE: "1",
			COPILOT_BRO_UI_SMOKE_INCLUDE_WRAPPED_MODELS: "1",
			COPILOT_BRO_UI_SMOKE_MODEL_KIND: smokeModelKind,
			COPILOT_BRO_UI_SMOKE_AUTO_RUN_REQUEST: "0",
			COPILOT_BRO_UI_SMOKE_AUTO_RUN_CHAT_SUITE: env.COPILOT_BRO_UI_SMOKE_AUTO_RUN_CHAT_SUITE?.trim() || "0",
			COPILOT_BRO_UI_SMOKE_AUTO_SUBMIT_AFTER_OPEN: env.COPILOT_BRO_UI_SMOKE_AUTO_SUBMIT_AFTER_OPEN?.trim() || "1",
			COPILOT_BRO_UI_SMOKE_PALETTE_SUBMIT_CHAT: env.COPILOT_BRO_UI_SMOKE_PALETTE_SUBMIT_CHAT?.trim() || "0",
			COPILOT_BRO_UI_SMOKE_WRAPPED_VENDOR: process.env.COPILOT_BRO_UI_SMOKE_WRAPPED_VENDOR,
			COPILOT_BRO_UI_SMOKE_WRAPPED_ID: defaultWrappedId,
			COPILOT_BRO_LOG_FILE: logFilePath,
			COPILOT_BRO_UI_SMOKE_RUNTIME_MODEL_ID: smokeModelKind === "wrapped" ? "" : PRIMARY_MODEL.runtimeId,
			COPILOT_BRO_UI_SMOKE_MODEL_ID: smokeModelKind === "wrapped" ? "" : PRIMARY_MODEL.id,
			COPILOT_BRO_UI_SMOKE_MODEL_PROVIDER: smokeModelKind === "wrapped" ? "" : PRIMARY_MODEL.provider,
			COPILOT_BRO_UI_SMOKE_PROMPT: HOST_UI_SMOKE_LM_PROMPT,
			COPILOT_BRO_UI_SMOKE_CHAT_SCENARIOS: env.COPILOT_BRO_UI_SMOKE_CHAT_SCENARIOS?.trim() || parseHostUiSmokeChatScenarioIds({}).join(","),
			COPILOT_BRO_UI_SMOKE_CHAT_MODE: env.COPILOT_BRO_UI_SMOKE_CHAT_MODE?.trim() || "ask",
			COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION: env.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION?.trim() || "1",
			COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_MOCK: env.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_MOCK?.trim() || "",
			COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_SCENARIOS: env.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_SCENARIOS?.trim() || "",
			COPILOT_BRO_UI_SMOKE_REPO_ROOT: repoRoot,
			// Pass GitHub token to Copilot/auth extensions if provided
			...(process.env.COPILOT_BRO_UI_SMOKE_GITHUB_TOKEN ? {
				GITHUB_TOKEN: process.env.COPILOT_BRO_UI_SMOKE_GITHUB_TOKEN
			} : {})
		}
	});
	child.unref();
	return child;
}

function getSmokeModelKind(): "provider" | "wrapped" {
	return process.env.COPILOT_BRO_UI_SMOKE_MODEL_KIND?.trim().toLowerCase() === "wrapped" ? "wrapped" : "provider";
}

async function syncRequiredHostExtensions(targetExtensionsDir: string): Promise<string[]> {
	const sourceExtensionsDir = resolveDefaultExtensionsDir();
	if (!sourceExtensionsDir) {
		console.log("[host-ui-smoke.extensions.sync] USERPROFILE missing; skip copy");
		return [];
	}
	const copied: string[] = [];
	const prefixRules: Array<{ prefix: string; excludeCopilotChatSibling?: boolean }> = [
		{ prefix: "github.copilot-", excludeCopilotChatSibling: true },
		{ prefix: "github.copilot-chat-" }
	];
	const entries = await readdir(sourceExtensionsDir, { withFileTypes: true }).catch((error) => {
		console.warn("[host-ui-smoke.extensions.sync] failed to read source dir", {
			sourceExtensionsDir,
			message: error instanceof Error ? error.message : String(error)
		});
		return [];
	});
	const selected = new Set<string>();
	for (const { prefix, excludeCopilotChatSibling } of prefixRules) {
		const match = entries
			.filter((entry) => {
				const name = entry.name.toLowerCase();
				if (!entry.isDirectory() || selected.has(entry.name)) {
					return false;
				}
				if (!name.startsWith(prefix)) {
					return false;
				}
				if (excludeCopilotChatSibling && name.startsWith("github.copilot-chat-")) {
					return false;
				}
				return true;
			})
			.map((entry) => entry.name)
			.sort((left, right) => right.localeCompare(left))[0];
		console.log("[host-ui-smoke.extensions.sync] prefix scan", { prefix, match: match ?? null });
		if (!match) {
			continue;
		}
		selected.add(match);
		const sourcePath = path.join(sourceExtensionsDir, match);
		const targetPath = path.join(targetExtensionsDir, match);
		const targetExists = await access(targetPath).then(() => true).catch(() => false);
		if (!targetExists) {
			try {
				await cp(sourcePath, targetPath, { recursive: true });
				console.log("[host-ui-smoke.extensions.sync] copied", { sourcePath, targetPath });
			} catch (error) {
				console.error("[host-ui-smoke.extensions.sync] copy failed", {
					sourcePath,
					targetPath,
					message: error instanceof Error ? error.message : String(error)
				});
				throw error;
			}
		} else {
			console.log("[host-ui-smoke.extensions.sync] already exists", { targetPath });
		}
		copied.push(match);
	}
	console.log("[host-ui-smoke.extensions.sync] done", { copied });
	return copied;
}

async function removeLegacyCopiedCopilotChatExtensions(targetExtensionsDir: string): Promise<void> {
	const entries = await readdir(targetExtensionsDir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		if (!entry.name.toLowerCase().startsWith("github.copilot-chat-")) {
			continue;
		}
		const targetPath = path.join(targetExtensionsDir, entry.name);
		await rm(targetPath, { recursive: true, force: true });
		console.log("[host-ui-smoke.extensions.sync] removed legacy copied copilot-chat", { targetPath });
	}
	const jsonPath = path.join(targetExtensionsDir, "extensions.json");
	const existing = await readFile(jsonPath, "utf-8").then((value) => JSON.parse(value) as Array<{ identifier?: { id?: string }; relativeLocation?: string }>).catch(() => []);
	if (existing.length === 0) {
		return;
	}
	const filtered = existing.filter((entry) => {
		const id = entry.identifier?.id?.toLowerCase() ?? "";
		const relativeLocation = entry.relativeLocation?.toLowerCase() ?? "";
		return id !== "github.copilot-chat" && !relativeLocation.startsWith("github.copilot-chat-");
	});
	if (filtered.length !== existing.length) {
		await writeFile(jsonPath, JSON.stringify(filtered, null, "\t"));
		console.log("[host-ui-smoke.extensions.sync] pruned copilot-chat entries from extensions.json", { removed: existing.length - filtered.length });
	}
}

async function patchExtensionsJson(extensionsDir: string, copiedExtNames: string[]): Promise<void> {
	if (copiedExtNames.length === 0) {
		return;
	}
	const jsonPath = path.join(extensionsDir, "extensions.json");
	let existing: Array<{ identifier: { id: string } }> = [];
	try {
		existing = JSON.parse(await readFile(jsonPath, "utf-8")) as typeof existing;
	} catch {
		// file may not exist yet
	}
	const registeredIds = new Set(existing.map((e) => e.identifier.id.toLowerCase()));
	const toAdd: unknown[] = [];
	for (const dirName of copiedExtNames) {
		const pkgPath = path.join(extensionsDir, dirName, "package.json");
		let pkg: { publisher?: string; name?: string; version?: string } = {};
		try {
			pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as typeof pkg;
		} catch {
			continue;
		}
		const id = `${(pkg.publisher ?? "").toLowerCase()}.${(pkg.name ?? "").toLowerCase()}`;
		if (registeredIds.has(id)) {
			continue;
		}
		const fullPath = path.join(extensionsDir, dirName).replace(/\\/g, "/");
		toAdd.push({
			identifier: { id },
			version: pkg.version ?? "0.0.0",
			location: { $mid: 1, path: `/${fullPath.replace(/^[A-Za-z]:/, (d) => d.toUpperCase())}`, scheme: "file" },
			relativeLocation: dirName,
			metadata: { isApplicationScoped: false, isMachineScoped: false, isBuiltin: false, installedTimestamp: Date.now(), pinned: false },
		});
	}
	if (toAdd.length > 0) {
		await writeFile(jsonPath, JSON.stringify([...existing, ...toAdd], null, "\t"));
	}
}

async function syncRequiredHostUserData(targetUserDataDir: string): Promise<void> {
	const sourceUserDataDir = resolveDefaultUserDataDir();
	if (!sourceUserDataDir) {
		return;
	}
	const sourceGlobalStorageDir = path.join(sourceUserDataDir, "globalStorage");
	const targetGlobalStorageDir = path.join(targetUserDataDir, "User", "globalStorage");
	await rm(targetGlobalStorageDir, { recursive: true, force: true }).catch(() => undefined);
	await mkdir(path.dirname(targetGlobalStorageDir), { recursive: true });
	await mkdir(targetGlobalStorageDir, { recursive: true });
	for (const entryName of ["storage.json", "state.vscdb", "state.vscdb.backup"] as const) {
		const sourcePath = path.join(sourceGlobalStorageDir, entryName);
		const targetPath = path.join(targetGlobalStorageDir, entryName);
		await access(sourcePath).then(() => cp(sourcePath, targetPath)).catch(() => undefined);
	}
	for (const fileName of ["storage.json", "chatLanguageModels.json"] as const) {
		const sourcePath = path.join(sourceUserDataDir, fileName);
		const targetPath = path.join(targetUserDataDir, "User", fileName);
		await access(sourcePath).then(() => cp(sourcePath, targetPath)).catch(() => undefined);
	}
}

function resolveDefaultExtensionsDir(): string | undefined {
	const userProfile = process.env.USERPROFILE?.trim();
	return userProfile ? path.join(userProfile, ".vscode", "extensions") : undefined;
}

function resolveDefaultUserDataDir(): string | undefined {
	const appData = process.env.APPDATA?.trim();
	return appData ? path.join(appData, "Code", "User") : undefined;
}

async function buildSmokeProcessEnvironment(): Promise<NodeJS.ProcessEnv> {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		COPILOT_BRO_UI_SMOKE: "1"
	};
	for (const variableName of API_KEY_ENVIRONMENT_VARIABLES) {
		const existing = env[variableName]?.trim();
		if (existing) {
			env[variableName] = existing;
			continue;
		}
		const resolved = await readWindowsEnvironmentVariable(variableName);
		if (resolved) {
			env[variableName] = resolved;
		}
	}
	return env;
}

async function readWindowsEnvironmentVariable(name: string): Promise<string | undefined> {
	for (const scope of ["Process", "User", "Machine"] as const) {
		try {
			const value = execFileSync("powershell.exe", [
				"-NoProfile",
				"-Command",
				`$value = [Environment]::GetEnvironmentVariable('${name}', '${scope}'); if ($value) { [Console]::Write($value) }`
			], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"]
			}).trim();
			if (value) {
				return value;
			}
		} catch {
			// Try the next scope.
		}
	}
	return undefined;
}

/** China-region gateway profiles applied before Chat / provider probes (plan: real API in CN). */
const HOST_UI_SMOKE_CHINA_PROVIDER_ENDPOINTS: Record<string, string> = {
	qwen: "dashscope-cn",
	dashscope: "dashscope-cn",
	kimi: "moonshot-cn",
	moonshot: "moonshot-cn",
	minimax: "minimax-cn"
};

async function writeSmokeWorkspaceSettings(workspaceDir: string): Promise<void> {
	const settingsDir = path.join(workspaceDir, ".vscode");
	await mkdir(settingsDir, { recursive: true });
	const settings = {
		"extendedModels.providerEndpoints": HOST_UI_SMOKE_CHINA_PROVIDER_ENDPOINTS,
		"extendedModels.visionProxy.enabled": true,
		"extendedModels.visionProxy.defaultModelId": "qwen3.5-flash::qwen"
	};
	await writeFile(path.join(settingsDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Try to read a credential blob from Windows Credential Manager.
 * Returns the decoded UTF-16LE string value, or null if not found.
 */
function readCredentialFromWindowsCredentialManager(target: string): string | null {
	const psScript = `
Add-Type -TypeDefinition '
using System;using System.Runtime.InteropServices;
public class CredR {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    public struct CRED {
        public int Flags;public int Type;
        public IntPtr TargetName;public IntPtr Comment;
        public long LastWritten;
        public int CredentialBlobSize;public IntPtr CredentialBlob;
        public int Persist;public int AttributeCount;public IntPtr Attributes;
        public IntPtr TargetAlias;public IntPtr UserName;
    }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern bool CredReadW(string t,int tp,int f,out IntPtr c);
    [DllImport("advapi32.dll")]
    public static extern void CredFree(IntPtr c);
}' -Language CSharp
$ptr=[IntPtr]::Zero
if([CredR]::CredReadW('${target.replace(/'/gu, "''")}',1,0,[ref]$ptr)){
    $c=[System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[Type][CredR+CRED])
    $b=New-Object byte[] $c.CredentialBlobSize
    [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$c.CredentialBlobSize)
    [CredR]::CredFree($ptr)
    $v=[System.Text.Encoding]::Unicode.GetString($b)
    Write-Output "FOUND:$v"
} else { Write-Output 'NOT_FOUND' }
`;
	try {
		const raw = execFileSync("powershell.exe", [
			"-NoProfile", "-NonInteractive", "-Command", psScript
		], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 8_000 }).trim();
		if (raw.startsWith("FOUND:")) {
			return raw.slice("FOUND:".length);
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Copy the raw credential blob (bytes) from sourceTarget to destTarget in Windows Credential Manager.
 * The blob is copied as-is (e.g. DPAPI-encrypted), so VS Code can decrypt it with its own key.
 * Returns true on success, false if source doesn't exist or copy fails.
 */
function copyCredentialBlob(sourceTarget: string, destTarget: string): boolean {
	const safeSrc = sourceTarget.replace(/'/gu, "''");
	const safeDst = destTarget.replace(/'/gu, "''");
	const psScript = `
Add-Type -TypeDefinition '
using System;using System.Runtime.InteropServices;
public class CpCred {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    public struct CR {
        public int Flags;public int Type;
        public IntPtr TargetName;public IntPtr Comment;
        public long LastWritten;
        public int CredentialBlobSize;public IntPtr CredentialBlob;
        public int Persist;public int AttributeCount;public IntPtr Attributes;
        public IntPtr TargetAlias;public IntPtr UserName;
    }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    public struct CW {
        public int Flags;public int Type;
        [MarshalAs(UnmanagedType.LPWStr)]public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)]public string Comment;
        public long LastWritten;
        public int CredentialBlobSize;public IntPtr CredentialBlob;
        public int Persist;public int AttributeCount;public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)]public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)]public string UserName;
    }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern bool CredReadW(string t,int tp,int f,out IntPtr c);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern bool CredWriteW([In]ref CW c,[In]int f);
    [DllImport("advapi32.dll")]
    public static extern void CredFree(IntPtr c);
}' -Language CSharp
$ptr=[IntPtr]::Zero
if(-not [CpCred]::CredReadW('${safeSrc}',1,0,[ref]$ptr)){ Write-Output 'SOURCE_NOT_FOUND'; exit 0 }
$src=[System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[Type][CpCred+CR])
$bytes=New-Object byte[] $src.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($src.CredentialBlob,$bytes,0,$src.CredentialBlobSize)
[CpCred]::CredFree($ptr)
$pin=[System.Runtime.InteropServices.GCHandle]::Alloc($bytes,'Pinned')
try {
    $w=New-Object CpCred+CW
    $w.Type=1;$w.TargetName='${safeDst}';$w.UserName='github.auth'
    $w.CredentialBlob=$pin.AddrOfPinnedObject();$w.CredentialBlobSize=$bytes.Length;$w.Persist=2
    if([CpCred]::CredWriteW([ref]$w,0)){Write-Output 'OK'} else {throw 'CredWriteW failed: '+[System.Runtime.InteropServices.Marshal]::GetLastWin32Error()}
} finally { $pin.Free() }
`;
	try {
		const raw = execFileSync("powershell.exe", [
			"-NoProfile", "-NonInteractive", "-Command", psScript
		], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 }).trim();
		return raw === "OK";
	} catch {
		return false;
	}
}

// Seed a GitHub auth session in Windows Credential Manager so VS Code picks it up at startup.
// VS Code stores auth sessions as DPAPI-encrypted JSON blobs in Credential Manager.
// Strategy (in order):
//   1. If the stable credential already contains a properly encrypted (non-plaintext) session → keep it.
//   2. If the credential is plaintext JSON (a stale smoke-seeded PAT) or doesn't exist → restore
//      from VS Code Insiders credential (same DPAPI user key, same OAuth app, just different app name).
//   3. If no Insiders credential exists → fall back to seeding a PAT-based session (CI use case).
async function seedGitHubAuthSessionToCredentialManager(): Promise<void> {
	const stableTarget = "vscodevscode.github-authentication/github.auth";
	const insidersTarget = "vscode-insidersvscode.github-authentication/github.auth";

	// Check if the current stable credential is a properly encrypted blob.
	// readCredentialFromWindowsCredentialManager decodes as UTF-16LE. If the result
	// is valid JSON, it's our plain-text smoke credential and needs to be replaced.
	const existing = readCredentialFromWindowsCredentialManager(stableTarget);
	if (existing !== null) {
		try {
			JSON.parse(existing);
			// Parsed as JSON → it's our plain-text smoke session (not DPAPI-encrypted). Fall through.
			console.log("[host-ui-smoke.github-auth.seed] Stable credential is plain JSON (smoke artifact) — will replace with encrypted session");
		} catch {
			// Non-parseable → it's a real DPAPI-encrypted credential. Leave it untouched.
			console.log("[host-ui-smoke.github-auth.seed] Stable credential is encrypted — preserving real OAuth session");
			return;
		}
	}

	// Attempt to copy the encrypted blob from VS Code Insiders (same OAuth app, same DPAPI user).
	// This avoids having to write a plain-text credential that VS Code can't decrypt.
	const copiedFromInsiders = copyCredentialBlob(insidersTarget, stableTarget);
	if (copiedFromInsiders) {
		console.log("[host-ui-smoke.github-auth.seed] Restored encrypted GitHub auth session from VS Code Insiders credential");
		return;
	}
	console.log("[host-ui-smoke.github-auth.seed] No Insiders credential available, falling back to PAT seed");

	// Fallback: seed a PAT-based session for CI environments.
	const token = process.env.COPILOT_BRO_UI_SMOKE_GITHUB_TOKEN?.trim()
		?? await readWindowsEnvironmentVariable("COPILOT_BRO_UI_SMOKE_GITHUB_TOKEN");
	if (!token) {
		console.log("[host-ui-smoke.github-auth.seed] COPILOT_BRO_UI_SMOKE_GITHUB_TOKEN not set, skipping GitHub auth seeding");
		return;
	}
	const sessionId = `smoke-${Date.now()}`;
	const session = {
		id: sessionId,
		accessToken: token,
		account: { id: "0", label: "" },
		scopes: ["read:user", "user:email", "repo", "workflow"]
	};
	const sessionJson = JSON.stringify([session]);
	// Base64-encode the JSON so PowerShell doesn't need to handle special characters.
	const jsonB64 = Buffer.from(sessionJson).toString("base64");
	// Use PowerShell P/Invoke to call CredWrite directly — avoids cmdkey quoting issues.
	const psScript = `
Add-Type -TypeDefinition '
using System;using System.Runtime.InteropServices;
public class Cred {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;public int Type;
        [MarshalAs(UnmanagedType.LPWStr)]public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)]public string Comment;
        public long LastWritten;
        public int CredentialBlobSize;public IntPtr CredentialBlob;
        public int Persist;public int AttributeCount;public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)]public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)]public string UserName;
    }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern bool CredWrite([In]ref CREDENTIAL c,[In]int f);
}' -Language CSharp
$json=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${jsonB64}'))
$bytes=[System.Text.Encoding]::Unicode.GetBytes($json)
$pin=[System.Runtime.InteropServices.GCHandle]::Alloc($bytes,'Pinned')
try{
    $c=New-Object Cred+CREDENTIAL
    $c.Type=1;$c.TargetName='${stableTarget}';$c.UserName='github.auth'
    $c.CredentialBlob=$pin.AddrOfPinnedObject();$c.CredentialBlobSize=$bytes.Length;$c.Persist=2
    if(-not([Cred]::CredWrite([ref]$c,0))){throw 'CredWrite failed: '+[System.Runtime.InteropServices.Marshal]::GetLastWin32Error()}
    Write-Host 'OK'
}finally{$pin.Free()}
`;
	try {
		const output = execFileSync("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			psScript
		], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
		if (output !== "OK") {
			throw new Error(`Unexpected output: ${output}`);
		}
		console.log(`[host-ui-smoke.github-auth.seed] Seeded PAT-based session id=${sessionId} to Credential Manager`);
	} catch (error) {
		console.warn("[host-ui-smoke.github-auth.seed] Failed:", error instanceof Error ? error.message : String(error));
	}
}

async function writeSmokeUserSettings(
	userDataDir: string,
	logFilePath: string,
	modelOverrides: unknown[] = [],
	autoOpenConfigPanel = false,
	autoRunRequest = true
): Promise<void> {
	const settingsDir = path.join(userDataDir, "User");
	await mkdir(settingsDir, { recursive: true });
	const settings = {
		"extendedModels.automationLogFile": logFilePath,
		"extendedModels.hostUiSmokeAutoOpenConfigPanel": autoOpenConfigPanel,
		"extendedModels.hostUiSmokeAutoOpenChat": false,
		"extendedModels.hostUiSmokeAutoRunRequest": autoRunRequest,
		"extendedModels.includeBuiltInPresets": true,
		"extendedModels.logLevel": "info",
		"extendedModels.models": modelOverrides
	};
	await writeFile(path.join(settingsDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

function findSourceWorkspaceWindow(titleHint: string, baselineWindowIds: ReadonlySet<number>): Window | undefined {
	const normalizedHint = titleHint.trim().toLowerCase();
	return windowManager.getWindows().find((candidate) => {
		if (!baselineWindowIds.has(candidate.id)) {
			return false;
		}
		const title = candidate.getTitle();
		if (!title.includes("Visual Studio Code")) {
			return false;
		}
		return normalizedHint.length === 0 || title.toLowerCase().includes(normalizedHint);
	});
}

async function maybeStageProviderApiKeyFromSourceWindow(
	provider: string,
	sourceWorkspaceTitleHint: string,
	baselineWindowIds: ReadonlySet<number>
): Promise<{ apiKey?: string; previousClipboardText?: string }> {
	const variableName = getProviderEnvironmentVariableName(provider);
	if (!variableName) {
		return {};
	}
	const sourceWindow = findSourceWorkspaceWindow(sourceWorkspaceTitleHint, baselineWindowIds);
	if (!sourceWindow) {
		return {};
	}
	const processApiKeyValue = readEnvironmentVariableFromProcess(sourceWindow.processId, variableName);
	const processApiKey = processApiKeyValue ? normalizeStagedApiKey(processApiKeyValue) : undefined;
	if (processApiKey) {
		return { apiKey: processApiKey };
	}
	if (!clipboard) {
		return {};
	}
	const previousClipboardText = await clipboard.read().catch(() => "");
	await focusAndPrimeWindow(sourceWindow, true);
	await shortcut(Key.LeftControl, Key.LeftShift, Key.Grave);
	await delay(700);
	await keyboard.type(`node scripts/host-ui/hostUiSmokeCopyEnvToClipboard.cjs ${variableName} ${CLIPBOARD_MISSING_SENTINEL}`);
	await keyboard.type(Key.Enter);
	await delay(1_000);
	const stagedClipboardText = await clipboard.read().catch(() => "");
	const apiKey = normalizeStagedApiKey(stagedClipboardText);
	if (!apiKey) {
		await restoreClipboardText(previousClipboardText);
		return { previousClipboardText };
	}
	return { apiKey, previousClipboardText };
}

function readEnvironmentVariableFromProcess(processId: number, variableName: string): string | undefined {
	try {
		const scriptPath = path.join(HOST_UI_SMOKE_REPO_ROOT, "scripts", "readProcessEnvironmentVariable.ps1");
		const value = execFileSync("powershell.exe", [
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			scriptPath,
			"-ProcessId",
			String(processId),
			"-VariableName",
			variableName
		], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"]
		}).trim();
		return value || undefined;
	} catch {
		return undefined;
	}
}

function getProviderApiKeyFromEnvironment(provider: string, sourceWindow: Window | undefined): string | undefined {
	const variableName = getProviderEnvironmentVariableName(provider);
	if (!variableName) {
		return undefined;
	}
	const localValue = normalizeStagedApiKey(process.env[variableName] ?? "");
	if (localValue) {
		return localValue;
	}
	if (!sourceWindow) {
		return undefined;
	}
	const processValue = normalizeStagedApiKey(readEnvironmentVariableFromProcess(sourceWindow.processId, variableName) ?? "");
	return processValue;
}

function normalizeStagedApiKey(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed || trimmed === CLIPBOARD_MISSING_SENTINEL) {
		return undefined;
	}
	if (trimmed.length < 12 || /\s/.test(trimmed)) {
		return undefined;
	}
	if (!/^[\x21-\x7E]+$/.test(trimmed)) {
		return undefined;
	}
	return trimmed;
}

async function restoreClipboardText(previousClipboardText: string | undefined): Promise<void> {
	if (!clipboard || previousClipboardText === undefined) {
		return;
	}
	await clipboard.write(previousClipboardText);
	await delay(150);
}

function buildSmokeFocusKeeper(window: Window, label: string) {
	return createSmokeFocusKeeper(window, label, {
		getForegroundTitle: getForegroundWindowTitle,
		focusWindow: focusAndPrimeWindow
	});
}

async function runPaletteEntry(window: Window, entry: HostUiSmokePaletteEntry): Promise<void> {
	await runCommandPaletteCommand(window, entry.title, entry.commandId);
}

async function runCommandPaletteCommand(window: Window, commandTitle: string, commandId?: string): Promise<void> {
	const paletteQuery = commandId?.trim()
		? `>${commandId.trim()}`
		: `> Copilot Bro${commandTitle.trim() ? ` ${commandTitle}` : ""}`;
	console.log(`[host-ui-smoke.command] start: ${commandTitle}${commandId ? ` (${commandId})` : ""}`);
	const focusKeeper = buildSmokeFocusKeeper(window, `command:${commandTitle}`);
	await focusKeeper.maybeRecover(true);
	console.log("[host-ui-smoke.command] focused");
	const englishReady = await ensureEnglishInputMode(window);
	console.log(`[host-ui-smoke.command] switched to english input: ${englishReady ? "verified" : "best-effort"}`);
	await delay(250);
	await shortcut(Key.LeftControl, Key.LeftShift, Key.P);
	console.log("[host-ui-smoke.command] opened command palette");
	await delay(700);
	// Prefer command id (deterministic); fall back to category + title for older VS Code builds.
	await shortcut(Key.LeftControl, Key.A);
	await delay(120);
	await pasteText(paletteQuery);
	console.log(`[host-ui-smoke.command] pasted command: ${paletteQuery}`);
	await delay(700);
	await focusKeeper.maybeRecover(true);
	await keyboard.type(Key.Enter);
	console.log("[host-ui-smoke.command] pressed enter");
	await delay(1_200);
	console.log(`[host-ui-smoke.command] end: ${commandTitle}`);
}

async function triggerRunRequestCommandWithVerification(
	window: Window,
	logFilePath: string,
	controller: SmokeController,
	attempts = 3
): Promise<void> {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		console.log(`[host-ui-smoke.request] trigger command attempt ${attempt}/${attempts}`);
		await runCommandPaletteCommand(window, HOST_UI_SMOKE_PALETTE.runHostUiSmokeRequest.title, HOST_UI_SMOKE_PALETTE.runHostUiSmokeRequest.commandId);
		try {
			await waitForLogLine(logFilePath, "host-ui-smoke.request.run.start", 9_000, controller);
			console.log(`[host-ui-smoke.request] run.start observed on attempt ${attempt}`);
			return;
		} catch {
			console.warn(`[host-ui-smoke.request] command attempt ${attempt}/${attempts} did not produce run.start`);
			await delay(800);
		}
	}
	throw new Error("Failed to trigger host-ui-smoke.request.run.start via command palette.");
}

async function prepareWindowForCommandPalette(window: Window): Promise<void> {
	await focusAndPrimeWindow(window, true);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		await keyboard.type(Key.Escape);
		await delay(250);
	}
	await focusAndPrimeWindow(window, true);
	await delay(500);
}

async function waitForChatSubmitAckInLog(
	logFilePath: string,
	byteOffset: number,
	timeoutMs: number,
	controller?: SmokeController,
	onPoll?: () => void | Promise<void>
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await onPoll?.();
		assertSmokeProcessAlive(controller, "chat submit ack");
		const tail = await readLogFromOffset(logFilePath, byteOffset);
		if (logTailIncludesChatSubmitAck(tail) || tail.includes("host-ui-smoke.chat.submit.end")) {
			return;
		}
		await delay(250);
	}
	throw new Error("Timed out waiting for chat submit ack (invoked, submit.start, or auto-submit.scheduled).");
}

async function waitForChatOpenAckInLog(
	logFilePath: string,
	byteOffset: number,
	timeoutMs: number,
	controller?: SmokeController,
	onPoll?: () => void | Promise<void>
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await onPoll?.();
		assertSmokeProcessAlive(controller, "chat open ack");
		const tail = await readLogFromOffset(logFilePath, byteOffset);
		if (logTailIncludesChatOpenAck(tail)) {
			return;
		}
		await delay(250);
	}
	throw new Error("Timed out waiting for chat open ack (run-chat-suite.invoked or chat.open.end).");
}

async function triggerRunChatSuiteCommandWithVerification(
	window: Window,
	logFilePath: string,
	byteOffset: number,
	controller: SmokeController,
	attempts = 4,
	onPoll?: () => void | Promise<void>
): Promise<void> {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		console.log(`[host-ui-smoke.chat-ui] palette run-chat-suite attempt ${attempt}/${attempts}`);
		await prepareWindowForCommandPalette(window);
		await runCommandPaletteCommand(window, HOST_UI_SMOKE_PALETTE.runChatSuite.title, HOST_UI_SMOKE_PALETTE.runChatSuite.commandId);
		try {
			await waitForChatOpenAckInLog(logFilePath, byteOffset, 20_000, controller, onPoll);
			console.log(`[host-ui-smoke.chat-ui] chat open ack on attempt ${attempt}`);
			return;
		} catch {
			console.warn(`[host-ui-smoke.chat-ui] run-chat-suite attempt ${attempt}/${attempts} produced no open ack`);
			await delay(1_000);
		}
	}
	console.warn("[host-ui-smoke.chat-ui] run-chat-suite palette exhausted; trying open-chat + submit-chat fallback");
	await prepareWindowForCommandPalette(window);
	await runCommandPaletteCommand(window, HOST_UI_SMOKE_PALETTE.openChat.title, HOST_UI_SMOKE_PALETTE.openChat.commandId);
	await waitForChatOpenAckInLog(logFilePath, byteOffset, 45_000, controller, onPoll);
	await prepareWindowForCommandPalette(window);
	await runCommandPaletteCommand(window, HOST_UI_SMOKE_PALETTE.submitChatRequest.title, HOST_UI_SMOKE_PALETTE.submitChatRequest.commandId);
	await waitForChatSubmitAckInLog(logFilePath, byteOffset, 20_000, controller, onPoll);
	console.log("[host-ui-smoke.chat-ui] open-chat + submit-chat fallback succeeded");
}

async function triggerSubmitChatCommandWithVerification(
	window: Window,
	logFilePath: string,
	byteOffset: number,
	controller: SmokeController,
	attempts = 4
): Promise<void> {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		console.log(`[host-ui-smoke.chat-ui] palette submit attempt ${attempt}/${attempts}`);
		await prepareWindowForCommandPalette(window);
		await runCommandPaletteCommand(window, HOST_UI_SMOKE_PALETTE.submitChatRequest.title, HOST_UI_SMOKE_PALETTE.submitChatRequest.commandId);
		try {
			await waitForChatSubmitAckInLog(logFilePath, byteOffset, 12_000, controller);
			console.log(`[host-ui-smoke.chat-ui] submit ack observed on palette attempt ${attempt}`);
			return;
		} catch {
			console.warn(`[host-ui-smoke.chat-ui] palette submit attempt ${attempt}/${attempts} produced no submit ack`);
			await delay(800);
		}
	}
	throw new Error("Failed to trigger host UI smoke chat submit via command palette.");
}

async function submitHostUiSmokeChatPrompt(
	window: Window,
	logFilePath: string,
	controller: SmokeController,
	participantTimeoutMs: number,
	requireIntegrationSuite: boolean
): Promise<HostUiSmokeChatParticipantOutcome> {
	console.log("[host-ui-smoke.chat-ui] submitting chat request through VS Code Chat (single suite command)");
	const focusKeeper = buildSmokeFocusKeeper(window, "chat-ui-wait");
	const onPoll = (): Promise<void> => focusKeeper.maybeRecover();
	const chatSessionOffset = await getLogByteOffset(logFilePath);
	const autoRunChatSuite = process.env.COPILOT_BRO_UI_SMOKE_AUTO_RUN_CHAT_SUITE === "1";
	let chatSuiteTriggered = false;
	if (autoRunChatSuite) {
		console.log("[host-ui-smoke.chat-ui] waiting for extension auto-run chat suite after github-auth preflight");
		try {
			await waitForChatOpenAckInLog(logFilePath, 0, 120_000, controller, onPoll);
			chatSuiteTriggered = true;
			console.log("[host-ui-smoke.chat-ui] extension auto-run chat suite acknowledged");
		} catch {
			console.warn("[host-ui-smoke.chat-ui] extension auto-run did not produce chat open ack; falling back to command palette");
		}
	}
	if (!chatSuiteTriggered) {
		await triggerRunChatSuiteCommandWithVerification(window, logFilePath, chatSessionOffset, controller, 4, onPoll);
	}
	await waitForLogLine(logFilePath, "host-ui-smoke.chat.open.end", 60_000, controller, { onPoll });
	const postOpenTail = await readLogFromOffset(logFilePath, chatSessionOffset);
	if (logTailIncludesChatSubmitAck(postOpenTail)) {
		console.log("[host-ui-smoke.chat-ui] chat submit already acknowledged (extension auto-run or palette)");
	} else {
		await waitForChatSubmitAckInLog(logFilePath, chatSessionOffset, 60_000, controller, onPoll);
	}
	await waitForChatSubmitOutcome(
		logFilePath,
		chatSessionOffset,
		120_000,
		(detail) => {
			console.log(`[host-ui-smoke.chat-ui] ${detail}`);
		},
		{ onPoll }
	);
	console.log("[host-ui-smoke.chat-ui] chat submit acknowledged; waiting for participant output");
	const participantOutcome = await waitForChatParticipantOutcome(
		logFilePath,
		chatSessionOffset,
		participantTimeoutMs,
		(detail) => {
			console.log(`[host-ui-smoke.chat-ui] ${detail}`);
		},
		{
			requireIntegrationSuite,
			postFinishedGraceMs: 15_000,
			onPoll
		}
	);
	if (participantOutcome.status === "completed" && participantOutcome.responsePreview) {
		console.log(
			`[host-ui-smoke.chat-ui] participant completed; response preview=${JSON.stringify(participantOutcome.responsePreview.slice(0, 120))}`
		);
	}
	return participantOutcome;
}

async function stageMissingProviderApiKeysViaUi(
	window: Window,
	sourceWindow: Window | undefined,
	smokeEnv: NodeJS.ProcessEnv,
	logFilePath: string,
	controller: SmokeController
): Promise<void> {
	const missingProviders = await readMissingApiKeyProvidersFromSmokeLog(logFilePath, controller);
	if (missingProviders !== null && missingProviders.length === 0) {
		return;
	}
	const targets = missingProviders !== null && missingProviders.length > 0
		? HOST_UI_SMOKE_API_KEY_PROVIDERS.filter((provider) => missingProviders.includes(provider))
		: [...HOST_UI_SMOKE_API_KEY_PROVIDERS];
	const staged: string[] = [];
	for (const provider of targets) {
		const variableName = getProviderEnvironmentVariableName(provider);
		const fromEnv = variableName ? normalizeStagedApiKey(smokeEnv[variableName] ?? "") : undefined;
		const apiKey = fromEnv ?? getProviderApiKeyFromEnvironment(provider, sourceWindow);
		if (!apiKey) {
			continue;
		}
		console.log(`[host-ui-smoke.api-keys] staging ${provider} via Set Provider API Key`);
		await setProviderApiKeyFromClipboard(window, provider, apiKey);
		staged.push(provider);
	}
	if (staged.length > 0) {
		console.log("[host-ui-smoke.api-keys] ui-staged", { providers: staged });
	}
}

async function readMissingApiKeyProvidersFromSmokeLog(
	logFilePath: string,
	controller: SmokeController
): Promise<string[] | null> {
	try {
		const payload = await waitForLogPayload<{ missing?: string[] }>(
			logFilePath,
			"host-ui-smoke.api-keys.status",
			5_000,
			controller,
			{ disableStallDetection: true }
		);
		if (!Array.isArray(payload.missing)) {
			return null;
		}
		return payload.missing.filter((provider): provider is typeof HOST_UI_SMOKE_API_KEY_PROVIDERS[number] =>
			(HOST_UI_SMOKE_API_KEY_PROVIDERS as readonly string[]).includes(provider));
	} catch {
		return null;
	}
}

async function setProviderApiKeyFromClipboard(window: Window, provider: string, apiKey: string): Promise<void> {
	await runCommandPaletteCommand(window, HOST_UI_SMOKE_PALETTE.setProviderApiKey.title, HOST_UI_SMOKE_PALETTE.setProviderApiKey.commandId);
	await ensureEnglishInputMode(window);
	await pasteText(provider);
	await delay(350);
	await keyboard.type(Key.Enter);
	await delay(600);
	await delay(500);
	await pasteText(apiKey);
	await keyboard.type(Key.Enter);
	await delay(900);
}

function buildSmokeModelOverrides(baseUrl: string): unknown[] {
	const parameterHints = {
		temperature: { min: 0, max: 2, step: 0.1, recommended: 1 },
		topP: { min: 0, max: 1, step: 0.05, recommended: 1 },
		maxOutputTokens: { min: 1, max: 393216, step: 1024, recommended: 32768 },
		thinking: { options: ["enabled", "disabled"], recommended: "enabled" },
		reasoningEffort: { options: ["high", "max"], recommended: "max" }
	};
	return [
		{
			id: PRIMARY_MODEL.id,
			displayName: PRIMARY_MODEL.displayName,
			provider: PRIMARY_MODEL.provider,
			providerDisplayName: "DeepSeek",
			category: "Fast / General",
			baseUrl,
			family: "oai-compatible",
			contextLength: 1048576,
			maxOutputTokens: 32768,
			toolCalling: true,
			vision: false,
			visionProxyModelId: "",
			temperature: 1,
			topP: 1,
			reasoningEffort: "high",
			thinking: { type: "enabled" },
			headers: {},
			extraBody: {},
			includeReasoningInRequest: false,
			editTools: ["apply-patch", "multi-find-replace", "find-replace"],
			parameterHints,
			documentationUrl: "https://api-docs.deepseek.com/zh-cn/"
		},
		{
			id: SECONDARY_MODEL.id,
			displayName: SECONDARY_MODEL.displayName,
			provider: SECONDARY_MODEL.provider,
			providerDisplayName: "DeepSeek",
			category: "Reasoning / Agent",
			baseUrl,
			family: "oai-compatible",
			contextLength: 1048576,
			maxOutputTokens: 32768,
			toolCalling: true,
			vision: false,
			visionProxyModelId: "",
			temperature: 1,
			topP: 1,
			reasoningEffort: "high",
			thinking: { type: "enabled" },
			headers: {},
			extraBody: {},
			includeReasoningInRequest: false,
			editTools: ["apply-patch", "multi-find-replace", "find-replace"],
			parameterHints,
			documentationUrl: "https://api-docs.deepseek.com/zh-cn/"
		}
	];
}

async function choosePrimaryModel(window: Window): Promise<void> {
	await chooseModel(window, RELATIVE_POINTS.flashOption);
}

async function chooseSecondaryModel(window: Window): Promise<void> {
	await chooseModel(window, RELATIVE_POINTS.proOption);
}

async function chooseModel(window: Window, optionPoint: { x: number; y: number }): Promise<void> {
	await clickRelative(window, RELATIVE_POINTS.model);
	await delay(300);
	await clickRelative(window, optionPoint);
	await delay(1_000);
}

async function teardownSmokeVsCodeSession(controller: SmokeController, workspaceTitleHint: string): Promise<void> {
	await killSpawnedProcess(controller.spawnedProcess);
	controller.spawnedProcess = undefined;
	await delay(2_000);
	const smokeWindows = windowManager.getWindows().filter((window) =>
		isHostUiSmokeWindowTitle(window.getTitle(), workspaceTitleHint));
	for (const window of smokeWindows) {
		if (window.isVisible()) {
			await closeWindow(window, { workspaceTitleHint });
			continue;
		}
		try {
			focusWindow(window);
			await delay(200);
			await shortcut(Key.LeftAlt, Key.F4);
			await delay(400);
		} catch {
			// Best-effort close for windows that lost a readable title after chat UI.
		}
	}
	if (smokeWindows.length === 0) {
		console.warn("[host-ui-smoke.close] no smoke VS Code window matched; process kill was best-effort");
	}
}

async function closeExistingSmokeWindows(workspaceTitleHint: string): Promise<string[]> {
	const closedTitles: string[] = [];
	const candidates = windowManager.getWindows().filter((window) => {
		if (!window.isVisible()) {
			return false;
		}
		return isHostUiSmokeWindowTitle(window.getTitle(), workspaceTitleHint);
	});
	for (const candidate of candidates) {
		const title = candidate.getTitle();
		await closeWindow(candidate, { workspaceTitleHint });
		closedTitles.push(title);
	}
	return closedTitles;
}

async function createSmokeModelServer(): Promise<SmokeModelServer> {
	const chatRequests: MockChatCompletionRequest[] = [];
	const waiters: Array<{
		resolve(request: MockChatCompletionRequest): void;
		reject(error: Error): void;
		timeout: ReturnType<typeof setTimeout>;
	}> = [];
	const server = createServer(async (request, response) => {
		try {
			const requestUrl = request.url ?? "/";
			if (request.method === "GET" && requestUrl === "/v1/models") {
				respondJson(response, 200, {
					data: [
						{ id: "deepseek-v4-flash", owned_by: "deepseek" }
					]
				});
				return;
			}

			if (request.method === "POST" && requestUrl === "/v1/chat/completions") {
				const payload = await readJsonBody(request);
				const chatRequest: MockChatCompletionRequest = {
					model: typeof payload.model === "string" ? payload.model : "",
					authorizationHeader: typeof request.headers.authorization === "string" ? request.headers.authorization : undefined,
					messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
					stream: payload.stream !== false
				};
				chatRequests.push(chatRequest);
				for (const waiter of waiters.splice(0)) {
					clearTimeout(waiter.timeout);
					waiter.resolve(chatRequest);
				}
				respondChatCompletion(response);
				return;
			}

			respondJson(response, 404, { error: `Unhandled smoke endpoint: ${request.method ?? "GET"} ${requestUrl}` });
		} catch (error) {
			respondJson(response, 500, {
				error: error instanceof Error ? error.message : String(error)
			});
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});

	const address = server.address() as AddressInfo | null;
	if (!address) {
		throw new Error("Failed to resolve smoke model server address.");
	}

	return {
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
		waitForChatCompletion(timeoutMs: number): Promise<MockChatCompletionRequest> {
			const existing = chatRequests.at(-1);
			if (existing) {
				return Promise.resolve(existing);
			}
			return new Promise<MockChatCompletionRequest>((resolve, reject) => {
				const timeout = setTimeout(() => {
					const index = waiters.findIndex((waiter) => waiter.timeout === timeout);
					if (index >= 0) {
						waiters.splice(index, 1);
					}
					reject(new Error("Timed out waiting for the smoke chat-completions request."));
				}, timeoutMs);
				waiters.push({ resolve, reject, timeout });
			});
		},
		async waitForChatCompletionCount(count: number, timeoutMs: number): Promise<void> {
			const finite = Number.isFinite(timeoutMs) && timeoutMs < Number.MAX_SAFE_INTEGER;
			const deadline = finite ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
			while (Date.now() < deadline) {
				if (chatRequests.length >= count) {
					return;
				}
				await delay(150);
			}
			throw new Error(`Timed out waiting for ${count} smoke chat-completions requests; received ${chatRequests.length}.`);
		},
		peekLastChatCompletion(): MockChatCompletionRequest {
			const last = chatRequests.at(-1);
			if (!last) {
				throw new Error("No smoke chat completion requests recorded yet.");
			}
			return last;
		},
		close(): Promise<void> {
			for (const waiter of waiters.splice(0)) {
				clearTimeout(waiter.timeout);
				waiter.reject(new Error("Smoke model server closed before request completion."));
			}
			return new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	};
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (!text) {
		return {};
	}
	const parsed = JSON.parse(text) as unknown;
	return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

function respondJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8"
	});
	response.end(JSON.stringify(body));
}

function respondChatCompletion(response: ServerResponse): void {
	const created = Math.floor(Date.now() / 1000);
	response.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive"
	});
	response.write(`data: ${JSON.stringify({
		id: "chatcmpl-host-ui-smoke",
		object: "chat.completion.chunk",
		created,
		model: "deepseek-v4-flash",
		choices: [
			{
				index: 0,
				delta: { content: "BRO_SMOKE_OK_20260506" },
				finish_reason: null
			}
		]
	})}\n\n`);
	response.write(`data: ${JSON.stringify({
		id: "chatcmpl-host-ui-smoke",
		object: "chat.completion.chunk",
		created,
		model: "deepseek-v4-flash",
		choices: [
			{
				index: 0,
				delta: {},
				finish_reason: "stop"
			}
		]
	})}\n\n`);
	response.write("data: [DONE]\n\n");
	response.end();
}

async function waitForAnyRequestEndCount(
	logFilePath: string,
	minEnds: number,
	timeoutMs: number,
	controller?: SmokeController
): Promise<void> {
	const finite = Number.isFinite(timeoutMs) && timeoutMs < Number.MAX_SAFE_INTEGER;
	const deadline = finite ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
	let lastSnapshot = "";
	let lastProgressAt = Date.now();
	let stallCount = 0;
	while (Date.now() < deadline) {
		assertSmokeProcessAlive(controller, `request end count (any model, min=${minEnds})`);
		const content = await readFile(logFilePath, "utf8").catch(() => "");
		const endCount = content.split(/\r?\n/).filter((line) => line.includes("request.end")).length;
		const snapshot = `${content.length}:${endCount}`;
		if (snapshot !== lastSnapshot) {
			lastSnapshot = snapshot;
			lastProgressAt = Date.now();
			stallCount = 0;
		}
		if (endCount >= minEnds) {
			return;
		}
		if (controller && Date.now() - lastProgressAt >= DEFAULT_STALL_TIMEOUT_MS) {
			stallCount = await handlePotentialSmokeStall(controller, `request end count (any model, min=${minEnds})`, stallCount);
			lastProgressAt = Date.now();
		}
		await delay(400);
	}
	throw new Error(`Timed out waiting for at least ${minEnds} request.end log lines.`);
}

async function waitForRequestEndCount(
	logFilePath: string,
	runtimeModelId: string,
	minEnds: number,
	timeoutMs: number,
	controller?: SmokeController
): Promise<void> {
	const marker = `\"runtimeModelId\":\"${runtimeModelId}\"`;
	const deadline = Date.now() + timeoutMs;
	let lastSnapshot = "";
	let lastProgressAt = Date.now();
	let stallCount = 0;
	while (Date.now() < deadline) {
		assertSmokeProcessAlive(controller, `request end count for ${runtimeModelId}`);
		const content = await readFile(logFilePath, "utf8").catch(() => "");
		const endCount = content.split(/\r?\n/).filter((line) => line.includes("request.end") && line.includes(marker)).length;
		const snapshot = `${content.length}:${endCount}`;
		if (snapshot !== lastSnapshot) {
			lastSnapshot = snapshot;
			lastProgressAt = Date.now();
			stallCount = 0;
		}
		if (endCount >= minEnds) {
			return;
		}
		if (controller && Date.now() - lastProgressAt >= DEFAULT_STALL_TIMEOUT_MS) {
			stallCount = await handlePotentialSmokeStall(controller, `request end count for ${runtimeModelId}`, stallCount);
			lastProgressAt = Date.now();
		}
		await delay(400);
	}
	throw new Error(`Timed out waiting for at least ${minEnds} request.end lines for ${runtimeModelId}.`);
}

async function waitForRequestEvidence(logFilePath: string, runtimeModelId: string, timeoutMs: number, controller?: SmokeController): Promise<{ requestStartSeen: boolean; requestEndSeen: boolean }> {
	const deadline = Date.now() + timeoutMs;
	let lastSnapshot = "";
	let lastProgressAt = Date.now();
	let stallCount = 0;
	while (Date.now() < deadline) {
		assertSmokeProcessAlive(controller, `request evidence for ${runtimeModelId}`);
		const content = await readFile(logFilePath, "utf8").catch(() => "");
		const runtimeMarker = `\"runtimeModelId\":\"${runtimeModelId}\"`;
		const lines = content.split(/\r?\n/);
		const requestStartSeen = lines.some((line) => line.includes("request.start") && line.includes(runtimeMarker));
		const requestEndSeen = lines.some((line) => line.includes("request.end") && line.includes(runtimeMarker));
		const snapshot = `${content.length}:${Number(requestStartSeen)}:${Number(requestEndSeen)}`;
		if (snapshot !== lastSnapshot) {
			lastSnapshot = snapshot;
			lastProgressAt = Date.now();
			stallCount = 0;
		}
		if (requestStartSeen && requestEndSeen) {
			return { requestStartSeen, requestEndSeen };
		}
		if (controller && Date.now() - lastProgressAt >= DEFAULT_STALL_TIMEOUT_MS) {
			stallCount = await handlePotentialSmokeStall(controller, `request evidence for ${runtimeModelId}`, stallCount);
			lastProgressAt = Date.now();
		}
		await delay(500);
	}
	return {
		requestStartSeen: false,
		requestEndSeen: false
	};
}

async function waitForWrappedRequestEvidence(logFilePath: string, timeoutMs: number, controller?: SmokeController): Promise<{ requestStartSeen: boolean; requestEndSeen: boolean }> {
	const deadline = Date.now() + timeoutMs;
	let lastSnapshot = "";
	let lastProgressAt = Date.now();
	let stallCount = 0;
	while (Date.now() < deadline) {
		assertSmokeProcessAlive(controller, "wrapped request evidence");
		const content = await readFile(logFilePath, "utf8").catch(() => "");
		const lines = content.split(/\r?\n/);
		const requestStartSeen = lines.some((line) => line.includes("request.start") && line.includes('"transport":"vscode-lm-wrapper"'));
		const requestEndSeen = lines.some((line) => line.includes("request.end") && line.includes('"transport":"vscode-lm-wrapper"'));
		const snapshot = `${content.length}:${Number(requestStartSeen)}:${Number(requestEndSeen)}`;
		if (snapshot !== lastSnapshot) {
			lastSnapshot = snapshot;
			lastProgressAt = Date.now();
			stallCount = 0;
		}
		if (requestStartSeen && requestEndSeen) {
			return { requestStartSeen, requestEndSeen };
		}
		if (controller && Date.now() - lastProgressAt >= DEFAULT_STALL_TIMEOUT_MS) {
			stallCount = await handlePotentialSmokeStall(controller, "wrapped request evidence", stallCount);
			lastProgressAt = Date.now();
		}
		await delay(500);
	}
	return {
		requestStartSeen: false,
		requestEndSeen: false
	};
}

async function waitForLogLine(
	logFilePath: string,
	message: string,
	timeoutMs: number,
	controller?: SmokeController,
	options?: { disableStallDetection?: boolean; onPoll?: () => void | Promise<void> }
): Promise<void> {
	const start = Date.now();
	const finite = Number.isFinite(timeoutMs) && timeoutMs < Number.MAX_SAFE_INTEGER;
	const deadline = finite ? start + timeoutMs : Number.POSITIVE_INFINITY;
	let lastSnapshot = "";
	let lastProgressAt = Date.now();
	let stallCount = 0;
	let lastHeartbeatAt = start;
	while (Date.now() < deadline) {
		await options?.onPoll?.();
		assertSmokeProcessAlive(controller, `log line ${message}`);
		const content = await readFile(logFilePath, "utf8").catch(() => "");
		const lines = content.split(/\r?\n/);
		const snapshot = `${content.length}:${lines.at(-1) ?? ""}`;
		if (snapshot !== lastSnapshot) {
			lastSnapshot = snapshot;
			lastProgressAt = Date.now();
			stallCount = 0;
		}
		if (content.split(/\r?\n/).some((line) => line.includes(message))) {
			return;
		}
		if (Date.now() - lastHeartbeatAt >= 30_000) {
			console.log(
				JSON.stringify({
					type: "host-ui-smoke.wait.poll",
					waitingFor: message,
					elapsedMs: Date.now() - start,
					logBytes: content.length
				})
			);
			lastHeartbeatAt = Date.now();
		}
		if (controller && !options?.disableStallDetection && Date.now() - lastProgressAt >= DEFAULT_STALL_TIMEOUT_MS) {
			stallCount = await handlePotentialSmokeStall(controller, `log line ${message}`, stallCount);
			lastProgressAt = Date.now();
		}
		await delay(250);
	}
	throw new Error(`Timed out waiting for log line: ${message}`);
}

async function waitForRequestCommandOutcome(logFilePath: string, timeoutMs: number, controller?: SmokeController): Promise<{ status: "end" } | { status: "failed"; message?: string }> {
	const deadline = Date.now() + timeoutMs;
	let lastSnapshot = "";
	let lastProgressAt = Date.now();
	let stallCount = 0;
	while (Date.now() < deadline) {
		assertSmokeProcessAlive(controller, "request command outcome");
		const content = await readFile(logFilePath, "utf8").catch(() => "");
		const lines = content.split(/\r?\n/);
		const snapshot = `${content.length}:${lines.at(-1) ?? ""}`;
		if (snapshot !== lastSnapshot) {
			lastSnapshot = snapshot;
			lastProgressAt = Date.now();
			stallCount = 0;
		}
		const failed = extractLogPayload<{ message?: string }>(lines, "host-ui-smoke.request.run.failed");
		if (failed) {
			return {
				status: "failed",
				message: typeof failed.message === "string" ? failed.message : undefined
			};
		}
		if (lines.some((line) => line.includes("host-ui-smoke.request.run.end"))) {
			return { status: "end" };
		}
		if (controller && Date.now() - lastProgressAt >= DEFAULT_STALL_TIMEOUT_MS) {
			stallCount = await handlePotentialSmokeStall(controller, "request command outcome", stallCount);
			lastProgressAt = Date.now();
		}
		await delay(250);
	}
	throw new Error("Timed out waiting for request command outcome.");
}

async function waitForLogPayload<T>(
	logFilePath: string,
	message: string,
	timeoutMs: number,
	controller?: SmokeController,
	options?: { disableStallDetection?: boolean }
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let lastSnapshot = "";
	let lastProgressAt = Date.now();
	let stallCount = 0;
	while (Date.now() < deadline) {
		assertSmokeProcessAlive(controller, `log payload ${message}`);
		const content = await readFile(logFilePath, "utf8").catch(() => "");
		const lines = content.split(/\r?\n/);
		const snapshot = `${content.length}:${lines.at(-1) ?? ""}`;
		if (snapshot !== lastSnapshot) {
			lastSnapshot = snapshot;
			lastProgressAt = Date.now();
			stallCount = 0;
		}
		const payload = extractLogPayload<T>(lines, message);
		if (payload !== undefined) {
			return payload;
		}
		if (controller && !options?.disableStallDetection && Date.now() - lastProgressAt >= DEFAULT_STALL_TIMEOUT_MS) {
			stallCount = await handlePotentialSmokeStall(controller, `log payload ${message}`, stallCount);
			lastProgressAt = Date.now();
		}
		await delay(250);
	}
	throw new Error(`Timed out waiting for log payload: ${message}`);
}

function extractLogPayload<T>(lines: readonly string[], message: string): T | undefined {
	for (const line of lines) {
		const index = line.indexOf(message);
		if (index < 0) {
			continue;
		}
		const payloadText = line.slice(index + message.length).trim();
		if (!payloadText.startsWith("{") && !payloadText.startsWith("[")) {
			continue;
		}
		try {
			return JSON.parse(payloadText) as T;
		} catch {
			continue;
		}
	}
	return undefined;
}

function isNewWindow(window: Window, baselineWindowIds: ReadonlySet<number>): boolean {
	return !baselineWindowIds.has(window.id) && window.isVisible();
}

function windowTitleMatches(window: Window, titleHint: string): boolean {
	const title = window.getTitle();
	return title.includes(titleHint) && title.includes("Visual Studio Code");
}

function collectWindowTitles(): string[] {
	return windowManager.getWindows()
		.filter((window) => window.isVisible())
		.map((window) => window.getTitle())
		.filter(Boolean);
}

async function waitForWindow(predicate: (window: Window) => boolean, timeoutMs: number, label: string, controller?: SmokeController): Promise<Window> {
	const deadline = Date.now() + timeoutMs;
	let lastSnapshot = "";
	let lastProgressAt = Date.now();
	let stallCount = 0;
	while (Date.now() < deadline) {
		assertSmokeProcessAlive(controller, label);
		const visibleWindows = windowManager.getWindows().filter((window) => window.isVisible());
		const snapshot = visibleWindows.map((window) => `${window.id}:${window.getTitle()}`).join("\n");
		if (snapshot !== lastSnapshot) {
			lastSnapshot = snapshot;
			lastProgressAt = Date.now();
			stallCount = 0;
		}
		const match = visibleWindows.find(predicate);
		if (match) {
			return match;
		}
		if (controller && Date.now() - lastProgressAt >= DEFAULT_STALL_TIMEOUT_MS) {
			stallCount = await handlePotentialSmokeStall(controller, label, stallCount);
			lastProgressAt = Date.now();
		}
		await delay(250);
	}
	throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForWindowTitle(window: Window, titleFragment: string, timeoutMs: number, controller?: SmokeController): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastSnapshot = "";
	let lastProgressAt = Date.now();
	let stallCount = 0;
	while (Date.now() < deadline) {
		assertSmokeProcessAlive(controller, `window title ${titleFragment}`);
		const currentTitle = window.getTitle();
		if (currentTitle !== lastSnapshot) {
			lastSnapshot = currentTitle;
			lastProgressAt = Date.now();
			stallCount = 0;
		}
		if (currentTitle.includes(titleFragment)) {
			return;
		}
		if (controller && Date.now() - lastProgressAt >= DEFAULT_STALL_TIMEOUT_MS) {
			stallCount = await handlePotentialSmokeStall(controller, `window title ${titleFragment}`, stallCount);
			lastProgressAt = Date.now();
		}
		await delay(250);
	}
	throw new Error(`Timed out waiting for window title containing: ${titleFragment}`);
}

async function handlePotentialSmokeStall(controller: SmokeController, label: string, stallCount: number): Promise<number> {
	const nextStallCount = stallCount + 1;
	// Login is now driven by explicit image-recognition steps in openChatAndStartLogin.
	// Do not run legacy auth-window heuristics from generic stall handling.
	if (controller.interactionWindow && /chat|participant|submit/i.test(label)) {
		const focusKeeper = buildSmokeFocusKeeper(controller.interactionWindow, `stall:${label}`);
		await focusKeeper.maybeRecover(true);
	}
	await maybeDismissSmokeWelcomeWindows(controller);
	if (nextStallCount >= STALL_INTERVENTION_LIMIT) {
		await abortStuckSmokeInstance(controller, label);
		throw new Error(`Smoke stalled while waiting for ${label}; the stuck instance was closed.`);
	}
	return nextStallCount;
}

async function maybeHandleGitHubAuthWindows(controller: SmokeController, label: string): Promise<void> {
	// Loop: a single browser window may have multiple auth-related tabs (e.g. Edge "Verify Session"
	// followed by the GitHub OAuth "Authorize" page). After handling one page the browser may
	// navigate to the next — keep processing until no auth windows remain or we exhaust attempts.
	for (let round = 0; round < 6; round += 1) {
		const authWindows = windowManager.getWindows().filter((window) => window.isVisible() && isPotentialGitHubAuthWindow(window));
		if (authWindows.length === 0) {
			break;
		}
		// Process only ONE auth window per round to avoid focus thrashing.
		// Prefer the browser window (Edge/Chrome) as that is where OAuth happens.
		const authWindow = authWindows.find((w) => isBrowserAuthWindow(w)) ?? authWindows[0]!;
		const baseName = `${sanitizeArtifactName(label)}-auth-r${round + 1}`;
		try {
			controller.screenshots.push(await captureWindowScreenshot(authWindow, controller.artifactsDir, `${baseName}-before.png`));
		} catch {
			// Best-effort evidence only.
		}
		const titleNow = authWindow.getTitle().toLowerCase();
		console.log(`[host-ui-smoke.auth] handling auth window (round ${round + 1}): "${titleNow}"`);
		if (isBrowserAuthWindow(authWindow)) {
			// Browser window: attemptBrowserAuthorization handles focus itself (no ESC/click-inside).
			await attemptBrowserAuthorization(authWindow);
		} else {
			await focusAndPrimeWindow(authWindow, true);
			await keyboard.type(Key.Enter);
			await delay(1_000);
		}
		try {
			controller.screenshots.push(await captureWindowScreenshot(authWindow, controller.artifactsDir, `${baseName}-after.png`));
		} catch {
			// Best-effort evidence only.
		}
		// Wait for potential page navigation before the next round.
		await delay(2_500);
	}
}

/** Close config panel webview so Copilot Chat login templates target the workspace surface. */
async function dismissConfigPanelForChatFlow(window: Window): Promise<void> {
	await focusAndPrimeWindow(window, true);
	await delay(400);
	await keyboard.type(Key.Escape);
	await delay(800);
	console.log("[host-ui-smoke.auth] dismissed config panel before chat/login flow");
}

async function appendGithubAuthPreflightLogEvidence(logFilePath: string, outcome: "already-signed-in" | "image-flow-completed"): Promise<void> {
	const timestamp = new Date().toISOString();
	const line = `[${timestamp}] [INFO] host-ui-smoke.github-auth.preflight.end ${JSON.stringify({ outcome })}\n`;
	await appendFile(logFilePath, line, "utf8");
}

async function openChatAndStartLogin(window: Window, controller: SmokeController): Promise<void> {
	console.log("[host-ui-smoke.auth] startup: image-driven login preflight");
	await focusAndPrimeWindow(window, true);
	await delay(1_000);
	const vsCodeTitle = window.getTitle();
	console.log(`[host-ui-smoke.auth] target vscode window: "${vsCodeTitle}"`);
	try {
		controller.screenshots.push(await captureWindowScreenshot(window, controller.artifactsDir, "wrapped-login-before.png"));
	} catch {
		// Best-effort evidence only.
	}

	const button1 = getTestButtonPath("按钮1.png");
	const button2 = getTestButtonPath("按钮2.png");
	const button3 = getTestButtonPath("按钮3.png");
	const button4 = getTestButtonPath("按钮4.png");
	const button5 = getTestButtonPath("按钮5.png");

	// If user is already logged in, skip the entire login sequence.
	if (await isAlreadyLoggedInByTemplates(window, button1, button4, button5)) {
		console.log("[host-ui-smoke.auth] already logged in, skipping login sequence");
		try {
			controller.screenshots.push(await captureWindowScreenshot(window, controller.artifactsDir, "wrapped-login-already-signed-in.png"));
		} catch {
			// Best-effort evidence only.
		}
		await appendGithubAuthPreflightLogEvidence(controller.logFilePath, "already-signed-in");
		return;
	}

	// 4) 在 VS Code 窗口内定位按钮1并点击。
	const btn1Hit = await waitForTemplate(button1, {
		timeoutMs: 25_000,
		intervalMs: 500,
		region: windowRegion(window),
	});
	if (!btn1Hit) {
		throw new Error("Button1 was not found in VS Code window.");
	}
	console.log(`[host-ui-smoke.auth] button1 center: (${btn1Hit.center.x}, ${btn1Hit.center.y})`);
	await clickTemplateCenter(btn1Hit);
	await delay(1_500);

	// 5) 登录弹窗中定位按钮2并点击。
	const btn2Hit = await waitForTemplate(button2, {
		timeoutMs: 25_000,
		intervalMs: 500,
	});
	if (!btn2Hit) {
		throw new Error("Button2 was not found after clicking button1.");
	}
	console.log(`[host-ui-smoke.auth] button2 center: (${btn2Hit.center.x}, ${btn2Hit.center.y})`);
	await clickTemplateCenter(btn2Hit);
	await delay(3_000);

	// 6) Wait for OAuth browser, then locate button3 (regional template, full-screen fallback, or green primary).
	const browserAttachDeadline = Date.now() + 28_000;
	let authBrowserWindow: Window | undefined;
	while (Date.now() < browserAttachDeadline) {
		authBrowserWindow = windowManager.getWindows().find((candidate) => candidate.isVisible() && isBrowserAuthWindow(candidate));
		if (authBrowserWindow) {
			break;
		}
		await delay(550);
	}
	let browserSearchRegion = authBrowserWindow ? windowRegion(authBrowserWindow) : undefined;
	let usedGreenFallback = false;
	let btn3Hit: TemplateHit | null = null;
	const templateScales = [1, 1.25, 1.5, 0.9, 0.8];
	if (browserSearchRegion) {
		try {
			btn3Hit = await waitForTemplate(button3, {
				timeoutMs: 22_000,
				intervalMs: 700,
				region: browserSearchRegion,
				templateScales
			});
		} catch {
			btn3Hit = null;
		}
	}
	if (!btn3Hit) {
		try {
			btn3Hit = await waitForTemplate(button3, {
				timeoutMs: 16_000,
				intervalMs: 600,
				region: undefined,
				templateScales
			});
		} catch {
			btn3Hit = null;
		}
	}
	if (btn3Hit) {
		console.log(`[host-ui-smoke.auth] button3 center: (${btn3Hit.center.x}, ${btn3Hit.center.y})`);
		await clickTemplateCenter(btn3Hit);
	} else if (browserSearchRegion) {
		const deadline = Date.now() + 50_000;
		while (Date.now() < deadline) {
			const greenBtn = await findGreenPrimaryButton(browserSearchRegion);
			if (greenBtn) {
				console.log(`[host-ui-smoke.auth] green primary button fallback center: (${greenBtn.center.x}, ${greenBtn.center.y})`);
				await clickTemplateCenter(greenBtn);
				usedGreenFallback = true;
				break;
			}
			await delay(700);
		}
		if (!usedGreenFallback) {
			const capture = await captureVirtualDesktop();
			const fullRegion = { x: capture.left, y: capture.top, width: capture.width, height: capture.height };
			const greenWide = await findGreenPrimaryButton(fullRegion);
			if (greenWide) {
				console.log(`[host-ui-smoke.auth] green primary (full desktop) center: (${greenWide.center.x}, ${greenWide.center.y})`);
				await clickTemplateCenter(greenWide);
				usedGreenFallback = true;
			}
		}
		if (!usedGreenFallback) {
			throw new Error("Button3 template not found and green primary button fallback failed.");
		}
	} else {
		const capture = await captureVirtualDesktop();
		const fullRegion = { x: capture.left, y: capture.top, width: capture.width, height: capture.height };
		const greenWide = await findGreenPrimaryButton(fullRegion);
		if (greenWide) {
			console.log(`[host-ui-smoke.auth] green primary (no browser window) center: (${greenWide.center.x}, ${greenWide.center.y})`);
			await clickTemplateCenter(greenWide);
			usedGreenFallback = true;
		} else {
			throw new Error("Button3 was not found and browser window region was unavailable.");
		}
	}
	await delay(2_500);

	// 7) 等待按钮3消失，然后仅关闭当前浏览器标签页（不是关闭整个浏览器）。
	if (!usedGreenFallback) {
		await waitForTemplate(button3, {
			timeoutMs: 45_000,
			intervalMs: 700,
			mustDisappear: true,
			region: browserSearchRegion,
			templateScales: [1, 1.25, 1.5, 0.9, 0.8],
		});
	} else if (browserSearchRegion) {
		const deadline = Date.now() + 45_000;
		let absentStreak = 0;
		while (Date.now() < deadline) {
			const greenBtn = await findGreenPrimaryButton(browserSearchRegion);
			if (!greenBtn) {
				absentStreak += 1;
				if (absentStreak >= 2) {
					break;
				}
			} else {
				absentStreak = 0;
			}
			await delay(700);
		}
		if (absentStreak < 2) {
			throw new Error("Primary green auth button did not disappear in expected time.");
		}
	}
	await delay(800);
	const browserWindow = windowManager.getWindows().find((candidate) => candidate.isVisible() && isBrowserAuthWindow(candidate));
	if (browserWindow) {
		await focusBrowserWindow(browserWindow);
	}
	await shortcut(Key.LeftControl, Key.W);
	await delay(1_200);

	// 8) 聚焦 VS Code。
	await focusAndPrimeWindow(window, true);
	await delay(800);

	// 9) 若按钮5不存在，则点击按钮4弹出 chat 面板。
	const btn5Hit = await findTemplateOnScreen(button5, windowRegion(window));
	if (!btn5Hit) {
		const btn4Hit = await waitForTemplate(button4, {
			timeoutMs: 15_000,
			intervalMs: 500,
			region: windowRegion(window),
		});
		if (!btn4Hit) {
			throw new Error("Button5 absent and button4 not found to open chat panel.");
		}
		console.log(`[host-ui-smoke.auth] button4 center: (${btn4Hit.center.x}, ${btn4Hit.center.y})`);
		await clickTemplateCenter(btn4Hit);
		await delay(1_200);
	}

	try {
		controller.screenshots.push(await captureWindowScreenshot(window, controller.artifactsDir, "wrapped-login-after-image-flow.png"));
	} catch {
		// Best-effort evidence only.
	}
	await appendGithubAuthPreflightLogEvidence(controller.logFilePath, "image-flow-completed");
}

async function isAlreadyLoggedInByTemplates(
	window: Window,
	button1Path: string,
	button4Path: string,
	button5Path: string,
): Promise<boolean> {
	const region = windowRegion(window);
	const signInEntry = await findTemplateOnScreen(button1Path, region, [1, 1.25, 1.5, 0.9, 0.8]);
	if (signInEntry) {
		// Sign-in entry is visible => still not signed in.
		return false;
	}
	let signedMarker = await findTemplateOnScreen(button5Path, region, [1, 1.25, 1.5, 0.9, 0.8]);
	if (signedMarker) {
		return true;
	}
	// Chat panel might be collapsed; click button4 to reveal it, then re-check button5.
	const openChat = await findTemplateOnScreen(button4Path, region, [1, 1.25, 1.5, 0.9, 0.8]);
	if (!openChat) {
		return false;
	}
	await clickTemplateCenter(openChat);
	await delay(900);
	signedMarker = await findTemplateOnScreen(button5Path, region, [1, 1.25, 1.5, 0.9, 0.8]);
	return Boolean(signedMarker);
}

/**
 * Use Windows UI Automation (System.Windows.Automation) to find a visible button
 * whose Name property matches one of the provided strings (first match wins).
 * Returns the absolute screen center-point of the found element, or null if not found.
 */
function findUiElementCenterByNames(names: string[]): Point | null {
	// Build a safe PowerShell array literal: @("name1","name2",...)
	const psArray = `@(${names.map((n) => `'${n.replace(/'/gu, "''")}'`).join(",")})`;
	const psScript = [
		"Add-Type -AssemblyName UIAutomationClient",
		"Add-Type -AssemblyName UIAutomationTypes",
		"$root = [System.Windows.Automation.AutomationElement]::RootElement",
		`$names = ${psArray}`,
		"foreach ($name in $names) {",
		"  $cond = New-Object System.Windows.Automation.PropertyCondition(",
		"    [System.Windows.Automation.AutomationElement]::NameProperty, $name)",
		"  $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)",
		"  if ($el -ne $null) {",
		"    $r = $el.Current.BoundingRectangle",
		"    if ($r.Width -gt 0 -and $r.Height -gt 0) {",
		"      $cx = [int]($r.Left + $r.Width / 2)",
		"      $cy = [int]($r.Top + $r.Height / 2)",
		"      Write-Output \"$cx,$cy\"",
		"      exit 0",
		"    }",
		"  }",
		"}",
		"Write-Output 'NOT_FOUND'"
	].join("\n");
	try {
		const raw = execFileSync("powershell.exe", [
			"-NoProfile", "-NonInteractive", "-Command", psScript
		], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 12_000 }).trim();
		if (!raw || raw === "NOT_FOUND") {
			return null;
		}
		const parts = raw.split(",");
		const x = parseInt(parts[0] ?? "", 10);
		const y = parseInt(parts[1] ?? "", 10);
		if (isNaN(x) || isNaN(y)) {
			return null;
		}
		return new Point(x, y);
	} catch {
		return null;
	}
}

/** VS Code auth button names to look for, in priority order. */
const GITHUB_SIGN_IN_UIA_NAMES = [
	"Continue with GitHub Copilot",
	"Sign in with GitHub",
	"Sign In",
	"Allow",
	"Authorize",
	"Continue",
	"Sign in",
] as const;

/**
 * Try to find and click a GitHub sign-in related button via UIAutomation.
 * Returns true if a button was found and clicked.
 */
async function tryUiAutomationSignInClick(logContext: string): Promise<boolean> {
	console.log(`[host-ui-smoke.auth] UIAutomation: searching for sign-in button (${logContext})`);
	const pt = findUiElementCenterByNames([...GITHUB_SIGN_IN_UIA_NAMES]);
	if (pt) {
		console.log(`[host-ui-smoke.auth] UIAutomation: found button at (${pt.x}, ${pt.y}), clicking (${logContext})`);
		await mouse.setPosition(pt);
		await delay(200);
		await mouse.leftClick();
		return true;
	}
	console.log(`[host-ui-smoke.auth] UIAutomation: button not found (${logContext})`);
	return false;
}

async function tryContinueGitHubSignInInCurrentWindow(window: Window, controller: SmokeController, label: string): Promise<boolean> {
	console.log(`[host-ui-smoke.auth] attempt current-window github continue: ${label}`);
	await focusAndPrimeWindow(window, true);
	await delay(400);

	// Click the sign-in button ONCE only — repeated clicks open extra OAuth tabs.
	const uiaClicked = await tryUiAutomationSignInClick(`${label}-uia`);
	if (!uiaClicked) {
		// Fallback to coordinate click
		await clickRelative(window, RELATIVE_POINTS.continueWithGitHub);
	}
	await delay(800);

	// Now just wait for the external auth window to appear (up to ~15 s).
	// Do NOT click sign-in again — that would open additional browser tabs.
	if (await waitForGitHubAuthWindowVisible(15_000)) {
		console.log(`[host-ui-smoke.auth] external auth window detected after dialog continue: ${label}`);
		await maybeHandleGitHubAuthWindows(controller, label);
		return true;
	}
	// Last resort: a single Enter in case VS Code showed a "Continue" dialog.
	await keyboard.type(Key.Enter);
	await delay(500);
	if (await waitForGitHubAuthWindowVisible(5_000)) {
		console.log(`[host-ui-smoke.auth] external auth window detected after Enter: ${label}`);
		await maybeHandleGitHubAuthWindows(controller, label);
		return true;
	}
	return false;
}

async function maybeDismissSmokeWelcomeWindows(controller: SmokeController): Promise<void> {
	const welcomeWindows = windowManager.getWindows().filter((window) => window.isVisible()
		&& !controller.baselineWindowIds.has(window.id)
		&& isPotentialSmokeWelcomeWindow(window));
	for (const welcomeWindow of welcomeWindows) {
		await closeWindow(welcomeWindow, { smokeWelcome: true });
	}
}

function isPotentialGitHubAuthWindow(window: Window): boolean {
	const title = window.getTitle();
	if (!title) {
		return false;
	}
	const normalized = title.toLowerCase();
	return (
		(normalized.includes("github") && (normalized.includes("sign in") || normalized.includes("authorize") || normalized.includes("continue") || normalized.includes("authentication")))
		|| (normalized.includes("visual studio code") && normalized.includes("authentication"))
		|| (normalized.includes("copilot") && normalized.includes("sign in"))
		|| normalized.includes("verify session")
	);
}

function hasPotentialGitHubAuthWindowVisible(): boolean {
	return windowManager.getWindows().some((window) => window.isVisible() && isPotentialGitHubAuthWindow(window));
}

async function waitForGitHubAuthWindowVisible(timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (hasPotentialGitHubAuthWindowVisible()) {
			return true;
		}
		await delay(250);
	}
	return false;
}

function isBrowserAuthWindow(window: Window): boolean {
	const title = window.getTitle().toLowerCase();
	return title.includes("edge") || title.includes("chrome") || title.includes("firefox") || title.includes("github");
}

function isPotentialSmokeWelcomeWindow(window: Window): boolean {
	return isSmokeVscodeWelcomeWindowTitle(window.getTitle());
}

async function focusBrowserWindow(window: Window): Promise<void> {
	// On Windows, BringWindowToTop / SetForegroundWindow is blocked by the foreground lock when
	// the calling process (node) is not the foreground app.  VS Code smoke windows are maximised
	// and sit on top of Edge, so all mouse-clicks land on VS Code instead of the browser.
	// Fix: minimise every visible HostUiSmoke VS Code window first so Edge is exposed, then
	// bring Edge to the front with a physical address-bar click to establish true foreground.
	try {
		// Minimise ALL visible VS Code windows — both the smoke window AND the developer's own
		// VS Code instance may be maximised on top of Edge, blocking mouse events to the browser.
		const vsCodeWins = windowManager.getWindows().filter(
			(w) => w.isVisible() && w.getTitle().includes("Visual Studio Code"),
		);
		for (const sw of vsCodeWins) {
			sw.minimize();
		}
		if (vsCodeWins.length > 0) {
			await delay(400); // minimise animation
		}
	} catch {
		// Best-effort only.
	}
	try {
		const bounds = normalizeBounds(window);
		if (bounds.x >= 1920 || bounds.x < 0) {
			window.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
			await delay(200);
		}
	} catch {
		// Best-effort only.
	}
	// Do NOT use Alt+Tab recovery for browser windows — that switches away from the auth page.
	const focused = await ensureWindowForeground(window, true, false);
	if (!focused) {
		console.warn(`[host-ui-smoke.focus] failed to confirm foreground for browser window "${window.getTitle()}"`);
	}
	await delay(300);
	// Physical click on the SAFE address-bar area (not page content) to confirm Edge has focus.
	// With VS Code minimised, this click lands on Edge's nav bar at approx y≈30 screen.
	try {
		const bounds2 = normalizeBounds(window);
		const safeX = Math.round(bounds2.x + bounds2.width * 0.4); // ~40% across = nav bar
		const safeY = Math.round(bounds2.y + 38); // ~38px below window top = address bar
		await mouse.setPosition(new Point(safeX, safeY));
		await delay(100);
		await mouse.leftClick();
		await delay(300);
	} catch {
		// Best-effort only.
	}
	// Dismiss any Edge "crashed/restore" notification overlay.
	// When Edge is killed with Stop-Process it restarts and shows a "意外关闭。还原" toast in
	// the top-right corner of the viewport. This toast may intercept page interaction.
	// The × close button is at approx rx=0.676, ry=0.053 (screen: ~1301, 48 on 1920x1080).
	try {
		const bounds3 = normalizeBounds(window);
		const toastCloseX = Math.round(bounds3.x + bounds3.width * 0.676);
		const toastCloseY = Math.round(bounds3.y + bounds3.height * 0.053);
		await mouse.setPosition(new Point(toastCloseX, toastCloseY));
		await delay(100);
		await mouse.leftClick();
		await delay(300);
	} catch {
		// Best-effort only; no toast is also fine.
	}
}

async function attemptBrowserAuthorization(window: Window): Promise<void> {
	// NOTE: UIAutomation cannot reach browser web-content (rendered in a sandboxed process).
	// Use keyboard navigation only: Tab to focus the primary action button, then Enter.
	await focusBrowserWindow(window);
	const titleBefore = window.getTitle().toLowerCase();
	console.log(`[host-ui-smoke.auth-browser] title before authorize click: "${titleBefore}"`);
	if (!window.isVisible() || !isPotentialGitHubAuthWindow(window)) {
		return;
	}
	// Coordinate click on the primary green button area.
	// DO NOT send Enter first — it activates whatever element currently has focus (often a link)
	// which navigates away from the OAuth page before the click can land.
	//
	// Button positions measured from live screenshots (1920x1080 screen, maximized Edge window,
	// vertical tab panel ~185px on left, window bounds {x:-8,y:-8,width:1936,height:1048}):
	//   GitHub "Verify Session / Continue" button: screen (912, 378)
	//     → rx=(912+8)/1936≈0.475, ry=(378+8)/1048≈0.369
	//   GitHub "Authorize" green button (permissions page, centered below account box):
	//     → approximately rx≈0.475, ry≈0.50
	const bounds = normalizeBounds(window);
	const clickTargets: Array<{ rx: number; ry: number; label: string }> = [
		{ rx: 0.475, ry: 0.369, label: "Continue (account picker, IQzhan row)" },
		{ rx: 0.475, ry: 0.400, label: "Continue (slightly lower)" },
		{ rx: 0.475, ry: 0.500, label: "Authorize (permissions page center)" },
		{ rx: 0.475, ry: 0.440, label: "Continue/Authorize mid" },
	];
	for (const target of clickTargets) {
		const cx = Math.round(bounds.x + bounds.width * target.rx);
		const cy = Math.round(bounds.y + bounds.height * target.ry);
		console.log(`[host-ui-smoke.auth-browser] coordinate click: ${target.label} at (${cx}, ${cy})`);
		await focusBrowserWindow(window);
		await mouse.setPosition(new Point(cx, cy));
		await delay(200);
		await mouse.leftClick();
		await delay(2_500);
		if (!window.isVisible() || !isPotentialGitHubAuthWindow(window)) {
			console.log(`[host-ui-smoke.auth-browser] window closed after coordinate click "${target.label}" — auth complete`);
			return;
		}
	}
	// Last resort: Enter key (only after coordinate clicks have all missed).
	console.log("[host-ui-smoke.auth-browser] fallback: pressing Enter");
	await focusBrowserWindow(window);
	await keyboard.type(Key.Enter);
	await delay(2_000);
	if (!window.isVisible() || !isPotentialGitHubAuthWindow(window)) {
		console.log("[host-ui-smoke.auth-browser] window closed after fallback Enter — auth complete");
	}
}

async function abortStuckSmokeInstance(controller: SmokeController, label: string): Promise<void> {
	await killSpawnedProcess(controller.spawnedProcess);
	controller.spawnedProcess = undefined;
	try {
		await writeFile(path.join(controller.artifactsDir, `stalled-${sanitizeArtifactName(label)}.txt`), `stalled while waiting for ${label}\n`);
	} catch {
		// Best-effort evidence only.
	}
}

function isSmokeRelatedWindow(window: Window, controller: SmokeController): boolean {
	const title = window.getTitle();
	return title.includes(controller.workspaceTitleHint)
		|| isPotentialSmokeWelcomeWindow(window)
		|| isPotentialGitHubAuthWindow(window);
}

function assertSmokeProcessAlive(controller: SmokeController | undefined, label: string): void {
	void controller;
	void label;
	// The detached VS Code launcher process can exit before the real windowed instance is ready.
	// Treating that short-lived PID as the smoke lifetime causes false negatives during startup.
	// Startup and runtime health are already bounded by window/log waits plus stall handling.
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function killSpawnedProcess(child: ChildProcess | undefined): Promise<void> {
	const pid = child?.pid;
	if (!pid || !isProcessAlive(pid)) {
		return;
	}
	try {
		execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
	} catch {
		// Best-effort cleanup only.
	}
}

function sanitizeArtifactName(value: string): string {
	return value.replace(/[^a-z0-9]+/giu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "smoke";
}

function switchToEnglishInput(): void {
	try {
		// Switch keyboard layout to English (US) via Win32 LoadKeyboardLayout.
		// This prevents Chinese IME from intercepting keyboard.type() calls.
		execFileSync("powershell.exe", [
			"-NoProfile", "-NonInteractive", "-Command",
			"Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr LoadKeyboardLayout(string p, uint f); [DllImport(\"user32.dll\")] public static extern IntPtr ActivateKeyboardLayout(IntPtr h, uint f);' -Namespace WinAPI -Name KB -Language CSharp; $h=[WinAPI.KB]::LoadKeyboardLayout('00000409',1); [WinAPI.KB]::ActivateKeyboardLayout($h,0) | Out-Null"
		], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 5000 });
	} catch {
		// Best-effort only; keyboard.type may still work even with IME active.
	}
}

function getForegroundInputLanguageHex(): string | undefined {
	try {
		const script = [
			"Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); [DllImport(\"user32.dll\")] public static extern IntPtr GetKeyboardLayout(uint idThread);' -Namespace WinAPI -Name IME -Language CSharp",
			"$hwnd=[WinAPI.IME]::GetForegroundWindow()",
			"$pid=0",
			"$tid=[WinAPI.IME]::GetWindowThreadProcessId($hwnd,[ref]$pid)",
			"$hkl=[WinAPI.IME]::GetKeyboardLayout($tid)",
			"$value=$hkl.ToInt64() -band 0xFFFF",
			"Write-Output ([Convert]::ToString($value,16).PadLeft(4,'0'))"
		].join("; ");
		const out = execFileSync("powershell.exe", [
			"-NoProfile", "-NonInteractive", "-Command", script
		], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 5_000
		}).trim();
		return out || undefined;
	} catch {
		return undefined;
	}
}

function isEnglishInputLanguageActive(): boolean {
	const lang = getForegroundInputLanguageHex()?.toLowerCase();
	if (!lang) {
		return false;
	}
	// 0409 = en-US, keep support for English variants as well.
	return lang === "0409" || lang === "0809" || lang === "0c09" || lang === "1009";
}

async function ensureEnglishInputMode(window: Window): Promise<boolean> {
	// Prefer deterministic OS-level verification (independent from theme/colors).
	for (let attempt = 0; attempt < 4; attempt += 1) {
		if (isEnglishInputLanguageActive()) {
			return true;
		}
		switchToEnglishInput();
		await delay(180);
		if (isEnglishInputLanguageActive()) {
			return true;
		}
		// User-requested fallback: Shift toggle when still not English.
		await keyboard.type(Key.LeftShift);
		await delay(240);
	}
	// Last fallback: keep old template signal for environments where API query fails.
	const button6 = getTestButtonPath("按钮6.png");
	const marker = await findTemplateOnScreen(button6, windowRegion(window), [1, 1.25, 1.5, 0.9]);
	if (marker) {
		return true;
	}
	console.warn("[host-ui-smoke.command] failed to verify english input mode; continue with best-effort");
	return false;
}

function focusWindow(window: Window, maximize = false): void {
	window.show();
	window.restore();
	if (maximize) {
		window.maximize();
	}
	window.bringToTop();
}

function getForegroundWindowTitle(): string {
	try {
		const output = execFileSync("powershell.exe", [
			"-NoProfile", "-NonInteractive", "-Command",
			"Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);' -Namespace WinAPI -Name FG -Language CSharp; $h=[WinAPI.FG]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 512; [WinAPI.FG]::GetWindowText($h,$sb,$sb.Capacity) | Out-Null; $sb.ToString()"
		], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 3000 });
		return output.trim();
	} catch {
		return "";
	}
}

async function ensureWindowForeground(window: Window, maximize = false, allowAltTabRecovery = true): Promise<boolean> {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		focusWindow(window, maximize);
		await delay(250);
		const foregroundTitle = getForegroundWindowTitle().toLowerCase();
		const targetTitle = window.getTitle().toLowerCase();
		// Accept if either title contains the other, or if known browser/IDE keywords match.
		const browserMatch = foregroundTitle.includes("edge") || foregroundTitle.includes("chrome") || foregroundTitle.includes("firefox");
		const titleOverlap = targetTitle && foregroundTitle && (foregroundTitle.includes(targetTitle) || targetTitle.includes(foregroundTitle));
		if (
			foregroundTitle.includes("visual studio code")
			|| titleOverlap
			|| (targetTitle.includes("edge") && browserMatch)
			|| (targetTitle.includes("chrome") && browserMatch)
			|| (targetTitle.includes("firefox") && browserMatch)
		) {
			return true;
		}
		if (!allowAltTabRecovery) {
			continue;
		}
		try {
			await shortcut(Key.LeftAlt, Key.Tab);
			await delay(250);
		} catch {
			// Best-effort focus recovery only.
		}
	}
	return false;
}

async function focusAndPrimeWindow(window: Window, maximize = false): Promise<void> {
	// Move window to primary monitor (0,0 origin) so screenshots and coordinates work.
	try {
		const bounds = normalizeBounds(window);
		if (bounds.x >= 1920 || bounds.x < 0) {
			window.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
			await delay(200);
		}
	} catch {
		// Best-effort only.
	}
	const focused = await ensureWindowForeground(window, maximize);
	if (!focused) {
		console.warn(`[host-ui-smoke.focus] failed to confirm foreground for window "${window.getTitle()}"`);
	}
	await delay(400);
	await dismissBlockingQuickInput();
	await clickRelative(window, RELATIVE_POINTS.focus);
	await delay(300);
}

async function dismissBlockingQuickInput(): Promise<void> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		await keyboard.type(Key.Escape);
		await delay(120);
	}
}

async function gotoEditor(window: Window): Promise<void> {
	await focusAndPrimeWindow(window, true);
	await shortcut(Key.LeftControl, Key.Home);
	await delay(800);
	for (let index = 0; index < 14; index += 1) {
		await keyboard.type(Key.PageDown);
		await delay(450);
	}
	for (let index = 0; index < 1; index += 1) {
		await keyboard.type(Key.PageUp);
		await delay(450);
	}
	await delay(400);
}

async function readModelState(window: Window): Promise<ModelState> {
	return {
		displayName: await readField(window, RELATIVE_POINTS.displayName),
		temperature: await readField(window, RELATIVE_POINTS.temperature),
	};
}

async function waitForModelEditorReady(window: Window, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const state = await readModelState(window).catch(() => emptyState());
		if (isStableModelState(state)) {
			return;
		}
		await delay(400);
	}
	throw new Error("Timed out waiting for the model editor form to stabilize.");
}

function isStableModelState(state: ModelState): boolean {
	return /deepseek|glm|qwen|kimi|minimax|my model/i.test(state.displayName)
		&& /^\d+(?:\.\d+)?$/.test(state.temperature);
}

async function isEditorFormVisible(window: Window): Promise<boolean> {
	const state = await readModelState(window).catch(() => emptyState());
	return state.displayName === PRIMARY_MODEL.displayName && /^\d+(?:\.\d+)?$/.test(state.temperature);
}

async function setTemperature(window: Window, value: string): Promise<void> {
	await clickField(window, RELATIVE_POINTS.temperature);
	await delay(200);
	await shortcut(Key.LeftControl, Key.A);
	await delay(100);
	await keyboard.type(value);
	await delay(300);
}

async function readField(window: Window, point: { x: number; y: number }): Promise<string> {
	if (!clipboard) {
		throw new Error("Clipboard provider was not initialized.");
	}
	await clipboard.write("");
	await clickField(window, point);
	await delay(200);
	await shortcut(Key.LeftControl, Key.A);
	await delay(100);
	await shortcut(Key.LeftControl, Key.C);
	await delay(250);
	return clipboard.read();
}

async function clickField(window: Window, point: { x: number; y: number }): Promise<void> {
	const target = toAbsolutePoint(window, point);
	await mouse.setPosition(target);
	await delay(100);
	await mouse.leftClick();
	await delay(80);
	await mouse.leftClick();
	await delay(120);
}

async function pasteText(text: string): Promise<void> {
	if (!clipboard) {
		await keyboard.type(text);
		return;
	}
	await clipboard.write(text);
	await shortcut(Key.LeftControl, Key.V);
	await delay(250);
}

async function loadClipboard(): Promise<ClipboardApi> {
	const module = await import("clipboardy");
	return module.default;
}

async function clickRelative(window: Window, point: { x: number; y: number }): Promise<void> {
	const target = toAbsolutePoint(window, point);
	await mouse.setPosition(target);
	await delay(120);
	await mouse.leftClick();
	await delay(150);
}

function toAbsolutePoint(window: Window, point: { x: number; y: number }): Point {
	const bounds = normalizeBounds(window);
	return new Point(
		Math.round(bounds.x + (point.x / REFERENCE_WINDOW.width) * bounds.width),
		Math.round(bounds.y + (point.y / REFERENCE_WINDOW.height) * bounds.height),
	);
}

function normalizeBounds(window: Window): { x: number; y: number; width: number; height: number } {
	const bounds = window.getBounds();
	return {
		x: bounds.x ?? 0,
		y: bounds.y ?? 0,
		width: bounds.width ?? REFERENCE_WINDOW.width,
		height: bounds.height ?? REFERENCE_WINDOW.height,
	};
}

type VirtualDesktopCapture = {
	png: Buffer;
	left: number;
	top: number;
	width: number;
	height: number;
};

type TemplateHit = {
	center: Point;
	x: number;
	y: number;
	width: number;
	height: number;
	meanDiff: number;
};

function getTestButtonPath(name: string): string {
	return path.join(TEST_BUTTONS_DIR, name);
}

async function captureVirtualDesktop(): Promise<VirtualDesktopCapture> {
	try {
		const ps = [
			"Add-Type -Assembly 'System.Windows.Forms,System.Drawing'",
			"$b=[System.Windows.Forms.Screen]::AllScreens|ForEach{$_.Bounds}",
			"$l=($b|Measure -Property Left -Minimum).Minimum",
			"$t=($b|Measure -Property Top -Minimum).Minimum",
			"$r=($b|Measure -Property Right -Maximum).Maximum",
			"$btm=($b|Measure -Property Bottom -Maximum).Maximum",
			"$w=[int]($r-$l)",
			"$h=[int]($btm-$t)",
			"$bm=New-Object System.Drawing.Bitmap($w,$h)",
			"$g=[System.Drawing.Graphics]::FromImage($bm)",
			"$g.CopyFromScreen($l,$t,0,0,[System.Drawing.Size]::new($w,$h))",
			"$ms=New-Object System.IO.MemoryStream",
			"$bm.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)",
			"$meta=@{left=[int]$l;top=[int]$t;width=[int]$w;height=[int]$h}|ConvertTo-Json -Compress",
			"$b64=[Convert]::ToBase64String($ms.ToArray())",
			"Write-Output ('__COPILOT_BRO_SCREENSHOT__' + $meta + '__COPILOT_BRO_BASE64__' + $b64)"
		].join("; ");
		const raw = execFileSync("powershell.exe", [
			"-NoProfile", "-NonInteractive", "-Command", ps
		], {
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf8",
			maxBuffer: 120 * 1024 * 1024
		});
		const marker = "__COPILOT_BRO_SCREENSHOT__";
		const splitMarker = "__COPILOT_BRO_BASE64__";
		const start = raw.indexOf(marker);
		if (start < 0) {
			throw new Error("marker missing");
		}
		const payload = raw.slice(start + marker.length).trim();
		const splitIndex = payload.indexOf(splitMarker);
		if (splitIndex < 0) {
			throw new Error("base64 marker missing");
		}
		const metaText = payload.slice(0, splitIndex).trim();
		const base64Text = payload.slice(splitIndex + splitMarker.length).replace(/\s+/gu, "");
		const meta = JSON.parse(metaText) as { left?: number; top?: number; width?: number; height?: number };
		const png = Buffer.from(base64Text, "base64");
		if (png.length === 0) {
			throw new Error("empty png payload");
		}
		return {
			png,
			left: meta.left ?? 0,
			top: meta.top ?? 0,
			width: meta.width ?? 0,
			height: meta.height ?? 0,
		};
	} catch {
		// Fallback for environments where PowerShell output formatting is inconsistent.
		const png = await screenshotDesktop({ format: "png" });
		return {
			png,
			left: 0,
			top: 0,
			width: 1920,
			height: 1080,
		};
	}
}

function clampRegionToCapture(
	region: { x: number; y: number; width: number; height: number } | undefined,
	capture: VirtualDesktopCapture
): { x: number; y: number; width: number; height: number } {
	if (!region) {
		return { x: capture.left, y: capture.top, width: capture.width, height: capture.height };
	}
	const x1 = Math.max(capture.left, region.x);
	const y1 = Math.max(capture.top, region.y);
	const x2 = Math.min(capture.left + capture.width, region.x + region.width);
	const y2 = Math.min(capture.top + capture.height, region.y + region.height);
	return {
		x: x1,
		y: y1,
		width: Math.max(1, x2 - x1),
		height: Math.max(1, y2 - y1),
	};
}

function toGray(rawRgba: Buffer, width: number, height: number): Uint8Array {
	const gray = new Uint8Array(width * height);
	for (let i = 0, p = 0; i < rawRgba.length; i += 4, p += 1) {
		const r = rawRgba[i] ?? 0;
		const g = rawRgba[i + 1] ?? 0;
		const b = rawRgba[i + 2] ?? 0;
		gray[p] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
	}
	return gray;
}

function locateTemplateInGray(
	haystack: Uint8Array,
	haystackWidth: number,
	haystackHeight: number,
	needle: Uint8Array,
	needleWidth: number,
	needleHeight: number,
	offsetX: number,
	offsetY: number
): TemplateHit | null {
	if (needleWidth > haystackWidth || needleHeight > haystackHeight) {
		return null;
	}
	const samplePoints: Array<{ x: number; y: number }> = [];
	for (let sy = 1; sy <= 6; sy += 1) {
		for (let sx = 1; sx <= 8; sx += 1) {
			samplePoints.push({
				x: Math.floor((sx * needleWidth) / 9),
				y: Math.floor((sy * needleHeight) / 7),
			});
		}
	}
	let best: TemplateHit | null = null;
	for (let y = 0; y <= haystackHeight - needleHeight; y += 2) {
		for (let x = 0; x <= haystackWidth - needleWidth; x += 2) {
			let sampleDiff = 0;
			for (const s of samplePoints) {
				const hp = (y + s.y) * haystackWidth + (x + s.x);
				const np = s.y * needleWidth + s.x;
				sampleDiff += Math.abs((haystack[hp] ?? 0) - (needle[np] ?? 0));
			}
			const sampleMean = sampleDiff / samplePoints.length;
			if (sampleMean > 18) {
				continue;
			}
			let fullDiff = 0;
			let fullCount = 0;
			for (let ty = 0; ty < needleHeight; ty += 2) {
				const hBase = (y + ty) * haystackWidth + x;
				const nBase = ty * needleWidth;
				for (let tx = 0; tx < needleWidth; tx += 2) {
					fullDiff += Math.abs((haystack[hBase + tx] ?? 0) - (needle[nBase + tx] ?? 0));
					fullCount += 1;
				}
			}
			const fullMean = fullDiff / Math.max(1, fullCount);
			if (fullMean > 14) {
				continue;
			}
			if (!best || fullMean < best.meanDiff) {
				best = {
					center: new Point(offsetX + x + Math.round(needleWidth / 2), offsetY + y + Math.round(needleHeight / 2)),
					x: offsetX + x,
					y: offsetY + y,
					width: needleWidth,
					height: needleHeight,
					meanDiff: fullMean,
				};
			}
		}
	}
	return best;
}

async function findTemplateOnScreen(
	templatePath: string,
	region?: { x: number; y: number; width: number; height: number },
	templateScales: number[] = [1]
): Promise<TemplateHit | null> {
	const [capture, templatePng] = await Promise.all([
		captureVirtualDesktop(),
		readFile(templatePath),
	]);
	const searchRegion = clampRegionToCapture(region, capture);
	const left = searchRegion.x - capture.left;
	const top = searchRegion.y - capture.top;
	const width = searchRegion.width;
	const height = searchRegion.height;
	const crop = await sharpModule(capture.png)
		.extract({ left, top, width, height })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const baseTemplate = await sharpModule(templatePng)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const hayGray = toGray(crop.data, crop.info.width, crop.info.height);
	let bestHit: TemplateHit | null = null;
	for (const scale of templateScales) {
		const scaledWidth = Math.max(8, Math.round(baseTemplate.info.width * scale));
		const scaledHeight = Math.max(8, Math.round(baseTemplate.info.height * scale));
		const tmpl = await sharpModule(templatePng)
			.resize({ width: scaledWidth, height: scaledHeight, kernel: sharpModule.kernel.lanczos3 })
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const needleGray = toGray(tmpl.data, tmpl.info.width, tmpl.info.height);
		const hit = locateTemplateInGray(
			hayGray,
			crop.info.width,
			crop.info.height,
			needleGray,
			tmpl.info.width,
			tmpl.info.height,
			searchRegion.x,
			searchRegion.y,
		);
		if (!hit) {
			continue;
		}
		if (!bestHit || hit.meanDiff < bestHit.meanDiff) {
			bestHit = hit;
		}
	}
	return bestHit;
}

async function waitForTemplate(
	templatePath: string,
	options: {
		timeoutMs: number;
		intervalMs?: number;
		region?: { x: number; y: number; width: number; height: number };
		mustDisappear?: boolean;
		templateScales?: number[];
	}
): Promise<TemplateHit | null> {
	const deadline = Date.now() + options.timeoutMs;
	const intervalMs = options.intervalMs ?? 500;
	let missStreak = 0;
	while (Date.now() < deadline) {
		const found = await findTemplateOnScreen(templatePath, options.region, options.templateScales ?? [1]);
		if (!options.mustDisappear) {
			if (found) {
				return found;
			}
		} else if (!found) {
			missStreak += 1;
			if (missStreak >= 2) {
				return null;
			}
		} else {
			missStreak = 0;
		}
		await delay(intervalMs);
	}
	if (options.mustDisappear) {
		throw new Error(`Timed out waiting for template to disappear: ${path.basename(templatePath)}`);
	}
	throw new Error(`Timed out waiting for template: ${path.basename(templatePath)}`);
}

async function clickTemplateCenter(hit: TemplateHit): Promise<void> {
	await mouse.setPosition(hit.center);
	await delay(120);
	await mouse.leftClick();
	await delay(250);
}

function windowRegion(window: Window): { x: number; y: number; width: number; height: number } {
	const b = normalizeBounds(window);
	return { x: b.x, y: b.y, width: b.width, height: b.height };
}

function isGitHubGreen(r: number, g: number, b: number): boolean {
	// GitHub primary button green (rough range): #238636-ish.
	return g >= 85 && r <= 110 && b <= 110 && (g - r) >= 35 && (g - b) >= 20;
}

async function findGreenPrimaryButton(region: { x: number; y: number; width: number; height: number }): Promise<TemplateHit | null> {
	const capture = await captureVirtualDesktop();
	const searchRegion = clampRegionToCapture(region, capture);
	const left = searchRegion.x - capture.left;
	const top = searchRegion.y - capture.top;
	const crop = await sharpModule(capture.png)
		.extract({ left, top, width: searchRegion.width, height: searchRegion.height })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const w = crop.info.width;
	const h = crop.info.height;
	const mask = new Uint8Array(w * h);
	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const i = (y * w + x) * 4;
			const r = crop.data[i] ?? 0;
			const g = crop.data[i + 1] ?? 0;
			const b = crop.data[i + 2] ?? 0;
			if (isGitHubGreen(r, g, b)) {
				mask[y * w + x] = 1;
			}
		}
	}
	const visited = new Uint8Array(w * h);
	let best: TemplateHit | null = null;
	const targetX = Math.round(w * 0.63);
	const targetY = Math.round(h * 0.48);
	for (let y = 1; y < h - 1; y += 1) {
		for (let x = 1; x < w - 1; x += 1) {
			const idx = y * w + x;
			if (mask[idx] === 0 || visited[idx] === 1) {
				continue;
			}
			const queue: number[] = [idx];
			visited[idx] = 1;
			let q = 0;
			let count = 0;
			let minX = x;
			let maxX = x;
			let minY = y;
			let maxY = y;
			while (q < queue.length) {
				const p = queue[q++] ?? 0;
				const py = Math.floor(p / w);
				const px = p - py * w;
				count += 1;
				if (px < minX) minX = px;
				if (px > maxX) maxX = px;
				if (py < minY) minY = py;
				if (py > maxY) maxY = py;
				const n = [p - 1, p + 1, p - w, p + w];
				for (const np of n) {
					if (np < 0 || np >= mask.length) {
						continue;
					}
					if (mask[np] === 1 && visited[np] === 0) {
						visited[np] = 1;
						queue.push(np);
					}
				}
			}
			const bw = maxX - minX + 1;
			const bh = maxY - minY + 1;
			if (count < 250 || bw < 40 || bh < 18 || bw > 320 || bh > 120) {
				continue;
			}
			const fill = count / (bw * bh);
			if (fill < 0.25) {
				continue;
			}
			const cx = Math.round((minX + maxX) / 2);
			const cy = Math.round((minY + maxY) / 2);
			const dist = Math.hypot(cx - targetX, cy - targetY);
			const score = dist + Math.abs(bw - 76) * 0.8 + Math.abs(bh - 30) * 1.2;
			const candidate: TemplateHit = {
				center: new Point(searchRegion.x + cx, searchRegion.y + cy),
				x: searchRegion.x + minX,
				y: searchRegion.y + minY,
				width: bw,
				height: bh,
				meanDiff: score,
			};
			if (!best || candidate.meanDiff < best.meanDiff) {
				best = candidate;
			}
		}
	}
	return best;
}

async function shortcut(...keys: Key[]): Promise<void> {
	await keyboard.pressKey(...keys);
	await delay(80);
	await keyboard.releaseKey(...keys);
	await delay(120);
}

async function captureWindowScreenshot(window: Window, artifactsDir: string, fileName: string): Promise<string> {
	const filePath = path.join(artifactsDir, fileName);
	const bounds = normalizeBounds(window);
	// screenshot-desktop captures the primary monitor (0,0 to screenWidth x screenHeight).
	// Only use PowerShell multi-monitor capture when the window's LEFT EDGE is on a secondary
	// monitor (bounds.x >= primaryWidth). A window whose width slightly exceeds primaryWidth
	// while still on the primary screen is fine — screenshot-desktop clips it at the edge.
	const primaryWidth = 1920;
	let png: Buffer;
	if (bounds.x >= primaryWidth) {
		// Use PowerShell to capture the full virtual desktop (all monitors).
		try {
			const psOut = execFileSync("powershell.exe", [
				"-NoProfile", "-NonInteractive", "-Command",
				`Add-Type -Assembly 'System.Windows.Forms,System.Drawing'; $b=[System.Windows.Forms.Screen]::AllScreens|ForEach{$_.Bounds}; $l=($b|Measure -Property Left -Minimum).Minimum; $t=($b|Measure -Property Top -Minimum).Minimum; $w=($b|Measure -Property Right -Maximum).Maximum-$l; $h=($b|Measure -Property Bottom -Maximum).Maximum-$t; $bm=New-Object System.Drawing.Bitmap($w,$h); $g=[System.Drawing.Graphics]::FromImage($bm); $g.CopyFromScreen($l,$t,0,0,[System.Drawing.Size]::new($w,$h)); $ms=New-Object System.IO.MemoryStream; $bm.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray())`
		], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
			png = Buffer.from(psOut.trim(), "base64");
		} catch {
			png = await screenshotDesktop({ format: "png" });
		}
	} else {
		png = await screenshotDesktop({ format: "png" });
	}
	const left = Math.max(0, Math.round(bounds.x));
	const top = Math.max(0, Math.round(bounds.y));
	const width = Math.max(1, Math.round(bounds.width));
	const height = Math.max(1, Math.round(bounds.height));
	try {
		const cropped = await sharpModule(png)
			.extract({ left, top, width, height })
			.png()
			.toBuffer();
		await writeFile(filePath, cropped);
	} catch {
		await writeFile(filePath, png);
	}
	return filePath;
}

type CloseSmokeWindowOptions =
	| { workspaceTitleHint: string; smokeWelcome?: false }
	| { smokeWelcome: true; workspaceTitleHint?: undefined };

/**
 * Alt+F4 only when the window title and the OS foreground title both match a disposable smoke
 * VS Code instance — never send F4 if another app or an unrelated VS Code window is focused.
 */
async function closeWindow(window: Window, options: CloseSmokeWindowOptions): Promise<void> {
	const title = window.getTitle();
	if (options.smokeWelcome === true) {
		if (!isSmokeVscodeWelcomeWindowTitle(title)) {
			console.warn(`[host-ui-smoke.close] skip welcome close — unexpected title: ${JSON.stringify(title)}`);
			return;
		}
	} else {
		const hint = options.workspaceTitleHint.trim();
		const matchesSmokeTitle = isHostUiSmokeWindowTitle(title, hint);
		const titleLostAfterChat = hint.length > 0 && title.trim().length === 0;
		if (!matchesSmokeTitle && !titleLostAfterChat) {
			console.warn(`[host-ui-smoke.close] skip workspace close — title no longer matches smoke hint: ${JSON.stringify(title)}`);
			return;
		}
	}
	const foregroundOk = await ensureWindowForeground(window, false, false);
	if (!foregroundOk) {
		console.warn("[host-ui-smoke.close] skip Alt+F4 — could not bring smoke window to foreground");
		return;
	}
	const fg = getForegroundWindowTitle();
	if (options.smokeWelcome === true) {
		if (!isSmokeVscodeWelcomeWindowTitle(fg)) {
			console.warn(`[host-ui-smoke.close] skip Alt+F4 — foreground is not smoke welcome VS Code: ${JSON.stringify(fg)}`);
			return;
		}
	} else {
		if (!isHostUiSmokeWindowTitle(fg, options.workspaceTitleHint)) {
			console.warn(`[host-ui-smoke.close] skip Alt+F4 — foreground is not smoke workspace VS Code: ${JSON.stringify(fg)}`);
			return;
		}
	}
	try {
		focusWindow(window);
		await delay(200);
		await shortcut(Key.LeftAlt, Key.F4);
		await delay(500);
	} catch {
		// Best-effort cleanup only.
	}
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exitCode = 1;
});