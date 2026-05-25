/**
 * Real Chat LM integration scenarios (@bro-smoke + integration marker).
 * Validates vision proxy, cache, model switch, and multi-turn via log evidence — not smoke-token alone.
 */
import { Buffer } from "node:buffer";
import { QWEN_HOST_UI_CONTRACT } from "../../../config/qwenCatalogContract";
import { resolveIntegrationTurnCandidates, type HostUiModelProfileId } from "./hostUiModelProfiles";
import { resolveHostUiTestRetryOptions } from "./modelCandidates";
import {
	HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS,
	HOST_UI_SMOKE_CHAT_MOCK_SAFE_IDS
} from "./acceptance";
import { getProviderEnvironmentVariableName } from "../env";
import {
	P4_SELF_REFER_RUNTIME_ID,
	shouldSkipP4WrappedChatScenario
} from "./p4Route";
import { HOST_UI_SMOKE_BUTTON_PATH_PLACEHOLDER } from "../fixtures/vision";
import {
	P7_CHAT_BENCHMARK_FORBIDDEN,
	P7_CHAT_BENCHMARK_MARKERS,
	P7_RESTORE_ARTIFACT_CHAT_FORBIDDEN,
	P7_RESTORE_ARTIFACT_CHAT_MARKERS
} from "../logMarkers";

export const HOST_UI_SMOKE_INTEGRATION_SUITE_MARKER = "[host-ui-smoke-integration-suite]";

/** 12×12 PNG (Qwen/DashScope require width/height > 10; 1×1 stub caused 400). */
export const HOST_UI_SMOKE_MIN_PNG = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVR4nGPgqjhBEDGMKmIYhEEAAJj8uaGsDcltAAAAAElFTkSuQmCC",
		"base64"
	)
);

/** 13×13 PNG — distinct hash from {@link HOST_UI_SMOKE_MIN_PNG} for a second cache-miss turn. */
export const HOST_UI_SMOKE_ALT_MIN_PNG = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAA0AAAANCAIAAAD9iXMrAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVR4nGM4EaBBDGIYVXdiOIcLAAVB00HZzdNyAAAAAElFTkSuQmCC",
		"base64"
	)
);

export type HostUiSmokeChatIntegrationKind =
	| "text-token"
	| "vision-proxy"
	| "vision-cache-hit"
	| "model-switch"
	| "multi-turn"
	| "native-vision"
	| "p4-self-refer"
	| "p4-wrapped"
	| "p6-path-hydration"
	| "p7-restore"
	| "tool-call";

export interface HostUiSmokeChatIntegrationTurn {
	readonly userPrompt: string;
	/** Per-turn model override (runtime id). */
	readonly runtimeModelId?: string;
	/** Built-in profile id → ordered runtime model candidates (preferred). */
	readonly modelProfile?: HostUiModelProfileId;
	/** Explicit ordered fallback runtime ids (overrides profile). */
	readonly runtimeModelCandidates?: readonly string[];
	readonly attachMinPng?: boolean;
	/** Second probe PNG (different hash) for an independent `vision.proxy.cache.miss`. */
	readonly attachAltMinPng?: boolean;
	/** Real repo fixture under `fixtures/host-ui/testButtons/` (not 1×1 stub). */
	readonly attachTestButtonAsset?: boolean;
	/** Defaults to `按钮1.png`; use `按钮2.png` when a distinct image hash is required (e.g. after p6 path hydration). */
	readonly attachTestButtonFile?: string;
	/** Full chat UI benchmark screenshot under `src/test/fixtures/chat-screenshot-benchmark.png`. */
	readonly attachChatScreenshotBenchmark?: boolean;
	readonly expectedTrimmed?: string;
}

export interface HostUiSmokeChatIntegrationScenario {
	readonly id: string;
	readonly kind: HostUiSmokeChatIntegrationKind;
	readonly userPrompt: string;
	readonly attachMinPng?: boolean;
	readonly attachAltMinPng?: boolean;
	readonly attachTestButtonAsset?: boolean;
	readonly attachTestButtonFile?: string;
	readonly attachChatScreenshotBenchmark?: boolean;
	readonly runtimeModelId?: string;
	readonly modelProfile?: HostUiModelProfileId;
	readonly runtimeModelCandidates?: readonly string[];
	readonly expectedTrimmed?: string;
	readonly requiredLogMarkers: readonly string[];
	readonly forbiddenLogMarkers?: readonly string[];
	readonly turns?: readonly HostUiSmokeChatIntegrationTurn[];
	/** Per-turn LM timeout for long vision+restore runs (e.g. full screenshot → web). */
	readonly integrationTurnTimeoutMs?: number;
	/** When set, skip scenario if this env var is missing (plan: no fake pass without keys). */
	readonly requiredApiKeyProvider?: string;
	/** When set, every listed provider must have an API key env var or the scenario is skipped. */
	readonly requiredApiKeyProviders?: readonly string[];
}

export const HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL: readonly HostUiSmokeChatIntegrationScenario[] = [
	{
		id: "p3-global-qwen-proxy-chat",
		kind: "vision-proxy",
		modelProfile: "deepseek.vision-proxy",
		userPrompt:
			"[host-ui-p3-proxy] Global vision proxy: describe the attached small PNG in ≤12 words. Do not invent UI elements.",
		attachMinPng: true,
		requiredLogMarkers: [
			"vision.proxy.selected",
			'"selection":"extension-configured"',
			'"provider":"qwen"',
			"vision.input.bound",
			"vision.proxy.cache.miss",
			"vision.route.selected",
			"vision.evidence.persisted",
			'"rawImageForwarded":false',
			"request.messages.summary",
			'"hasImageParts":false'
		],
		forbiddenLogMarkers: ['"selection":"fallback-selected"', "claude-sonnet"],
		requiredApiKeyProviders: ["deepseek", "qwen"]
	},
	{
		id: "vision-proxy-miss",
		kind: "vision-proxy",
		modelProfile: "deepseek.vision-proxy",
		userPrompt:
			"[host-ui-chat-vision] Describe the attached small PNG in ≤12 words. Do not invent UI elements.",
		attachAltMinPng: true,
		requiredLogMarkers: [
			"vision.input.bound",
			"vision.proxy.cache.miss",
			"vision.route.selected",
			"vision.evidence.persisted",
			'"rawImageForwarded":false',
			"request.messages.summary",
			'"hasImageParts":false'
		],
		requiredApiKeyProvider: "deepseek"
	},
	{
		id: "vision-proxy-cache-hit",
		kind: "vision-cache-hit",
		modelProfile: "deepseek.vision-proxy",
		userPrompt:
			"[host-ui-chat-vision] Same image as prior turn — one short sentence only.",
		attachMinPng: true,
		requiredLogMarkers: [
			"vision.input.bound",
			"vision.proxy.cache.hit",
			"vision.route.selected",
			"request.messages.summary"
		],
		forbiddenLogMarkers: [],
		requiredApiKeyProvider: "deepseek"
	},
	{
		id: "model-switch-pro-token",
		kind: "model-switch",
		modelProfile: "deepseek.text.pro",
		userPrompt: "Reply with exactly BRO_SMOKE_OK_20260506 and nothing else.",
		expectedTrimmed: "BRO_SMOKE_OK_20260506",
		requiredLogMarkers: ["request.start", "request.end"],
		forbiddenLogMarkers: [],
		requiredApiKeyProvider: "deepseek"
	},
	{
		id: "prompt-preset-applied",
		kind: "text-token",
		modelProfile: "deepseek.text",
		userPrompt: "[host-ui-preset] Reply with exactly BRO_SMOKE_OK_20260506 and nothing else.",
		expectedTrimmed: "BRO_SMOKE_OK_20260506",
		requiredLogMarkers: [
			"prompt.preset.applied",
			'"presetId":"built-in:senior-engineer"',
			"request.messages.summary",
			'"roleCounts":{"system":1',
			"request.start",
			"request.end"
		],
		requiredApiKeyProvider: "deepseek"
	},
	{
		id: "p5-qwen-vl-native-chat",
		kind: "native-vision",
		modelProfile: "qwen.vl-native",
		userPrompt:
			"[host-ui-p5] Describe the attached small PNG in ≤10 words. No files, no markdown fences.",
		attachMinPng: true,
		requiredLogMarkers: [
			"vision.route.selected",
			'"strategy":"native"',
			"vision.native.structured.resolving",
			"vision.evidence.persisted",
			'"hasImageParts":false',
			"request.start",
			"request.end"
		],
		requiredApiKeyProvider: "qwen"
	},
	{
		id: "p7-describe-only-evidence",
		kind: "vision-proxy",
		modelProfile: "deepseek.vision-proxy",
		userPrompt:
			"[host-ui-p7] Describe-only: summarize the attached image in one sentence. Do not restore SVG/PNG artifacts.",
		attachTestButtonAsset: true,
		attachTestButtonFile: "按钮3.png",
		requiredLogMarkers: [
			"vision.input.bound",
			"vision.handoff.resolved",
			"vision.restore.pipeline.skipped",
			"vision.evidence.persisted",
			"vision.route.selected",
			'"hasImageParts":false'
		],
		forbiddenLogMarkers: [
			"vision.artifact.persist.failed",
			"vision.restore.pipeline.complete",
			"vision.restore.pipeline.start"
		],
		requiredApiKeyProvider: "deepseek"
	},
	{
		id: "multi-turn-vision-then-token",
		kind: "multi-turn",
		userPrompt: "",
		requiredLogMarkers: [
			"vision.input.bound",
			"vision.route.selected",
			"vision.evidence.persisted",
			"request.start"
		],
		requiredApiKeyProvider: "deepseek",
		turns: [
			{
				userPrompt:
					"[host-ui-chat-vision] Describe the attached small PNG in ≤12 words.",
				attachMinPng: true,
				modelProfile: "deepseek.vision-proxy"
			},
			{
				userPrompt: "Reply with exactly BRO_SMOKE_OK_20260506 and nothing else.",
				expectedTrimmed: "BRO_SMOKE_OK_20260506",
				modelProfile: "deepseek.text"
			}
		]
	},
	{
		id: "p4-self-refer-proxy-chat",
		kind: "p4-self-refer",
		userPrompt:
			"[host-ui-p4] Self-refer proxy guard: describe the attached small PNG in ≤10 words.",
		attachMinPng: true,
		modelProfile: "p4.self-refer",
		requiredLogMarkers: [
			"host-ui-smoke.p4.self-refer.policy",
			'"reason":"self-disabled"',
			"vision.guard.residual-images",
			"request.end"
		],
		forbiddenLogMarkers: ["vision.proxy.cache.miss", "vision.proxy.selected"],
		requiredApiKeyProvider: "deepseek"
	},
	{
		id: "p6-path-hydration-chat",
		kind: "p6-path-hydration",
		modelProfile: "deepseek.vision-proxy",
		userPrompt: `[host-ui-p6] Path-only hydration (describe-only): one short sentence about the UI button PNG at ${HOST_UI_SMOKE_BUTTON_PATH_PLACEHOLDER}. No attachments. No SVG restoration.`,
		requiredLogMarkers: [
			"vision.proxy.hydrated.imagePaths",
			"vision.input.bound",
			"vision.proxy.cache.miss",
			"vision.evidence.persisted",
			"vision.route.selected",
			"request.end"
		],
		forbiddenLogMarkers: [],
		requiredApiKeyProvider: "deepseek"
	},
	{
		id: "p7-restore-artifact-chat",
		kind: "p7-restore",
		modelProfile: "deepseek.vision-proxy",
		userPrompt:
			"[host-ui-p7-restore] Perfect vector restoration of this real UI button image. Prefer svg-mode structured output with path geometry; no bbox-only placeholder.",
		attachTestButtonAsset: true,
		attachTestButtonFile: "按钮2.png",
		requiredLogMarkers: [...P7_RESTORE_ARTIFACT_CHAT_MARKERS],
		forbiddenLogMarkers: [...P7_RESTORE_ARTIFACT_CHAT_FORBIDDEN],
		requiredApiKeyProvider: "deepseek"
	},
	{
		id: "p7-chat-benchmark-web-restore",
		kind: "p7-restore",
		modelProfile: "deepseek.vision-proxy",
		userPrompt: "精准还原这张图片中的内容到一个web界面中",
		attachChatScreenshotBenchmark: true,
		integrationTurnTimeoutMs: 600_000,
		requiredLogMarkers: [...P7_CHAT_BENCHMARK_MARKERS],
		forbiddenLogMarkers: [...P7_CHAT_BENCHMARK_FORBIDDEN],
		requiredApiKeyProvider: "deepseek"
	},
	{
		id: "p4-wrapped-vision-chat",
		kind: "p4-wrapped",
		userPrompt:
			"[host-ui-p4] Wrapped model vision handoff: describe the attached small PNG in ≤10 words.",
		attachMinPng: true,
		requiredLogMarkers: [
			"vision.route.selected",
			"vscode-lm::",
			"request.start",
			"request.end"
		],
		forbiddenLogMarkers: []
	},
	{
		id: "provider-token-smoke-chat",
		kind: "multi-turn",
		userPrompt: "",
		requiredLogMarkers: [
			"request.start",
			"request.end",
			'"provider":"zhipu"',
			'"provider":"minimax"',
			'"provider":"kimi"'
		],
		requiredApiKeyProviders: ["zhipu", "minimax", "kimi"],
		turns: [
			{
				userPrompt: "[host-ui-provider-zhipu] Reply with exactly BRO_SMOKE_OK_20260506 and nothing else.",
				expectedTrimmed: "BRO_SMOKE_OK_20260506",
				modelProfile: "zhipu.text"
			},
			{
				userPrompt: "[host-ui-provider-minimax] Reply with exactly BRO_SMOKE_OK_20260506 and nothing else.",
				expectedTrimmed: "BRO_SMOKE_OK_20260506",
				modelProfile: "minimax.text"
			},
			{
				userPrompt: "[host-ui-provider-kimi] Reply with exactly BRO_SMOKE_OK_20260506 and nothing else.",
				expectedTrimmed: "BRO_SMOKE_OK_20260506",
				modelProfile: "kimi.text"
			}
		]
	},
	{
		id: "native-vision-zhipu-chat",
		kind: "native-vision",
		modelProfile: "zhipu.vision-native",
		userPrompt:
			"[host-ui-native-zhipu] Describe the attached small PNG in ≤12 words. Return structured vision batch JSON when possible.",
		attachMinPng: true,
		requiredLogMarkers: [
			"vision.route.selected",
			'"strategy":"native"',
			"vision.native.structured.resolving",
			"vision.native.structured.completed",
			"vision.input.bound",
			"vision.evidence.persisted",
			'"hasImageParts":false',
			"request.start",
			"request.end"
		],
		forbiddenLogMarkers: ['"rawImageForwarded":true'],
		requiredApiKeyProvider: "zhipu"
	},
	{
		id: "multi-provider-switch-context",
		kind: "multi-turn",
		userPrompt: "",
		requiredLogMarkers: [
			"vision.input.bound",
			"vision.route.selected",
			"vision.evidence.persisted",
			"request.start",
			"request.end"
		],
		requiredApiKeyProviders: ["deepseek", "zhipu"],
		turns: [
			{
				userPrompt:
					"[host-ui-switch-1] Describe the attached small PNG in ≤10 words.",
				attachMinPng: true,
				modelProfile: "deepseek.vision-proxy"
			},
			{
				userPrompt: "Reply with exactly BRO_SMOKE_OK_20260506 and nothing else.",
				expectedTrimmed: "BRO_SMOKE_OK_20260506",
				modelProfile: "zhipu.text"
			},
			{
				userPrompt:
					"[host-ui-switch-3] Confirm session still works: reply exactly BRO_SMOKE_OK_20260506.",
				expectedTrimmed: "BRO_SMOKE_OK_20260506",
				modelProfile: "deepseek.text.pro"
			}
		]
	},
	{
		id: "tool-call-model-chat",
		kind: "tool-call",
		modelProfile: "zhipu.text.tool",
		userPrompt:
			"[host-ui-tools] Reply with exactly BRO_SMOKE_OK_20260506 and nothing else. (Tool-calling model smoke.)",
		expectedTrimmed: "BRO_SMOKE_OK_20260506",
		requiredLogMarkers: ["request.start", "request.end"],
		requiredApiKeyProvider: "zhipu"
	}
] as const;

const DEFAULT_INTEGRATION_IDS = HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS;

const MOCK_SAFE_INTEGRATION_IDS = HOST_UI_SMOKE_CHAT_MOCK_SAFE_IDS;

export function shouldRunHostUiSmokeChatIntegration(env: Pick<NodeJS.ProcessEnv, string>): boolean {
	return env.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION?.trim() !== "0";
}

export function shouldRunHostUiSmokeChatIntegrationSuite(prompt: string): boolean {
	return prompt.includes(HOST_UI_SMOKE_INTEGRATION_SUITE_MARKER);
}

export function parseHostUiSmokeChatIntegrationScenarioIds(env: Pick<NodeJS.ProcessEnv, string>): string[] {
	const raw = env.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_SCENARIOS?.trim();
	if (!raw) {
		return env.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_MOCK === "1"
			? [...MOCK_SAFE_INTEGRATION_IDS]
			: [...DEFAULT_INTEGRATION_IDS];
	}
	const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
	return parts.length > 0 ? parts : [...DEFAULT_INTEGRATION_IDS];
}

export function resolveHostUiSmokeChatIntegrationScenarios(
	env: Pick<NodeJS.ProcessEnv, string>
): HostUiSmokeChatIntegrationScenario[] {
	const ids = parseHostUiSmokeChatIntegrationScenarioIds(env);
	const byId = new Map(HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL.map((scenario) => [scenario.id, scenario]));
	const resolved: HostUiSmokeChatIntegrationScenario[] = [];
	const unknown: string[] = [];
	for (const id of ids) {
		const found = byId.get(id);
		if (found) {
			resolved.push(found);
		} else {
			unknown.push(id);
		}
	}
	if (unknown.length > 0) {
		throw new Error(
			`Unknown host UI smoke chat integration scenario id(s): ${unknown.join(", ")}. Known: ${[...byId.keys()].join(", ")}`
		);
	}
	if (resolved.length === 0) {
		throw new Error("Host UI smoke chat integration scenario list resolved to empty.");
	}
	return resolved;
}

export function countIntegrationLmRequests(scenarios: readonly HostUiSmokeChatIntegrationScenario[]): number {
	let total = 0;
	for (const scenario of scenarios) {
		if (scenario.turns && scenario.turns.length > 0) {
			total += scenario.turns.length;
		} else {
			total += 1;
		}
	}
	return total;
}

const HOST_UI_BUDGET_MAX_CANDIDATES_PER_TURN = 4;

/** Conservative LM attempt budget for participant timeouts (profile fallbacks + test retries). */
export function countIntegrationLmRequestBudget(
	scenarios: readonly HostUiSmokeChatIntegrationScenario[],
	env: Pick<NodeJS.ProcessEnv, string> = process.env
): number {
	const retry = resolveHostUiTestRetryOptions(env);
	const attemptsCap = Math.min(retry.maxAttemptsPerCandidate ?? 2, 2);
	let total = 0;
	for (const scenario of scenarios) {
		const turns = scenario.turns?.length ? scenario.turns : [scenario];
		for (const turn of turns) {
			const candidates = resolveIntegrationTurnCandidates(scenario, turn, env);
			const candidateSlots = Math.min(Math.max(1, candidates.length), HOST_UI_BUDGET_MAX_CANDIDATES_PER_TURN);
			total += candidateSlots * attemptsCap;
		}
	}
	return total;
}

/** Integration turns expected to run (excludes scenarios skipped for missing API keys / wrapped-only). */
export function countExecutableIntegrationLmRequests(
	scenarios: readonly HostUiSmokeChatIntegrationScenario[],
	env: Pick<NodeJS.ProcessEnv, string> = process.env
): number {
	let total = 0;
	for (const scenario of scenarios) {
		if (resolveHostUiSmokeIntegrationSkip(scenario, env).skip) {
			continue;
		}
		if (scenario.turns && scenario.turns.length > 0) {
			total += scenario.turns.length;
		} else {
			total += 1;
		}
	}
	return total;
}

/** LM turns for stall gates (`request.end` count): token scenarios + executable integration turns. */
export function countHostUiSmokeChatLmRequests(
	env: Pick<NodeJS.ProcessEnv, string>,
	tokenScenarioCount: number
): number {
	let total = tokenScenarioCount;
	if (shouldRunHostUiSmokeChatIntegration(env)) {
		total += countExecutableIntegrationLmRequests(resolveHostUiSmokeChatIntegrationScenarios(env), env);
	}
	return total;
}

export function computeHostUiSmokeParticipantTimeoutMs(env: Pick<NodeJS.ProcessEnv, string>, tokenScenarioCount: number): number {
	const integrationScenarios = shouldRunHostUiSmokeChatIntegration(env)
		? resolveHostUiSmokeChatIntegrationScenarios(env)
		: [];
	const requests = tokenScenarioCount + countIntegrationLmRequestBudget(integrationScenarios, env);
	const scenarios = shouldRunHostUiSmokeChatIntegration(env)
		? resolveHostUiSmokeChatIntegrationScenarios(env)
		: [];
	const hasVision = scenarios.some((s) =>
		s.kind === "vision-proxy"
		|| s.kind === "vision-cache-hit"
		|| s.kind === "native-vision"
		|| s.kind === "multi-turn"
		|| s.kind === "p6-path-hydration"
		|| s.kind === "p7-restore");
	const base = 180_000;
	const perRequest = hasVision ? 90_000 : 25_000;
	const lineCap = Math.min(900_000, base + requests * perRequest);
	const longFloor = scenarios.reduce((acc, s) => {
		const t = s.integrationTurnTimeoutMs;
		return t && t > acc ? t + 120_000 : acc;
	}, 0);
	return Math.min(900_000, Math.max(lineCap, longFloor));
}

export function scenarioRequiresVisionApi(scenario: HostUiSmokeChatIntegrationScenario): boolean {
	if (
		scenario.kind === "vision-proxy"
		|| scenario.kind === "vision-cache-hit"
		|| scenario.kind === "native-vision"
		|| scenario.kind === "p6-path-hydration"
		|| scenario.kind === "p7-restore"
	) {
		return true;
	}
	if (scenario.turns?.some((turn) =>
		turn.attachMinPng
		|| turn.attachAltMinPng
		|| turn.attachTestButtonAsset
		|| turn.attachChatScreenshotBenchmark)) {
		return true;
	}
	return (
		scenario.attachMinPng === true
		|| scenario.attachAltMinPng === true
		|| scenario.attachTestButtonAsset === true
		|| scenario.attachChatScreenshotBenchmark === true
	);
}

export function resolveHostUiSmokeIntegrationSkip(
	scenario: HostUiSmokeChatIntegrationScenario,
	env: Pick<NodeJS.ProcessEnv, string>
): { skip: true; reason: string } | { skip: false } {
	if (scenario.kind === "p4-wrapped") {
		const wrapped = shouldSkipP4WrappedChatScenario(env);
		if (wrapped.skip) {
			return wrapped;
		}
	}
	const providers = scenario.requiredApiKeyProviders?.length
		? scenario.requiredApiKeyProviders
		: scenario.requiredApiKeyProvider
			? [scenario.requiredApiKeyProvider]
			: [];
	for (const provider of providers) {
		const normalized = provider.trim().toLowerCase();
		if (!normalized) {
			continue;
		}
		const envName = getProviderEnvironmentVariableName(normalized);
		if (envName && !env[envName]?.trim()) {
			return { skip: true, reason: `no-api-key:${envName}` };
		}
	}
	if (!scenarioRequiresVisionApi(scenario)) {
		return { skip: false };
	}
	const deepseekKey = env.DEEPSEEK_API_KEY?.trim();
	if (providers.length === 0 && !deepseekKey) {
		return { skip: true, reason: "no-deepseek-api-key" };
	}
	return { skip: false };
}
