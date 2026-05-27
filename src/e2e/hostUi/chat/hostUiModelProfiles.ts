/**
 * Host UI chat integration — provider-agnostic model profile registry.
 * Scenarios reference a profile id; ordered runtime ids come from here (overridable via env).
 */
import { QWEN_HOST_UI_CONTRACT } from "../../../config/qwenCatalogContract";
import { P4_SELF_REFER_RUNTIME_ID } from "./p4Route";

export const HOST_UI_MODEL_PROFILE_REGISTRY = {
	"deepseek.text": ["deepseek-v4-flash::deepseek"],
	"deepseek.text.pro": ["deepseek-v4-pro::deepseek"],
	"deepseek.vision-proxy": ["deepseek-v4-flash::deepseek"],
	"qwen.vl-native": [`${QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey}::qwen`],
	"qwen.text-probe": ["qwen-turbo::qwen", "qwen3.5-flash::qwen"],
	"zhipu.text": [
		"glm-4-flash::zhipu",
		"glm-4.7-flash::zhipu",
		"glm-4.5-flash::zhipu",
		"glm-4.7-flashx::zhipu"
	],
	"zhipu.text.tool": [
		"glm-4-flash::zhipu",
		"glm-4.7-flash::zhipu",
		"glm-4.5-flash::zhipu",
		"glm-5.1::zhipu"
	],
	"zhipu.vision-native": [
		"glm-4.6v-flash::zhipu",
		"glm-4.6v-flashx::zhipu",
		"glm-4.6v::zhipu",
		"glm-4.1v-thinking-flashx::zhipu",
		"glm-4v-flash::zhipu",
		"glm-5v-turbo::zhipu"
	],
	"kimi.text": ["moonshot-v1::kimi", "kimi-k2.6::kimi"],
	"minimax.text": ["MiniMax-M2.7-highspeed::minimax", "MiniMax-M2.7::minimax"],
	"p4.self-refer": [P4_SELF_REFER_RUNTIME_ID]
} as const;

export type HostUiModelProfileId = keyof typeof HOST_UI_MODEL_PROFILE_REGISTRY;

/** Scenario id → profile when kind/provider inference would pick the wrong chain. */
const HOST_UI_SCENARIO_PROFILE_BY_ID: Partial<Record<string, HostUiModelProfileId>> = {
	"tool-call-model-chat": "zhipu.text.tool"
};

export const HOST_UI_DEFAULT_TEXT_PROFILE: HostUiModelProfileId = "deepseek.text";

/** Default text profile per provider for participant probes and runtime id resolution. */
export const HOST_UI_SMOKE_PROVIDER_TEXT_PROFILE: Readonly<Record<string, HostUiModelProfileId>> = {
	deepseek: "deepseek.text",
	zhipu: "zhipu.text",
	minimax: "minimax.text",
	kimi: "kimi.text",
	qwen: "qwen.text-probe"
};

const PROFILE_ENV_PREFIX = "COPILOT_BRO_UI_SMOKE_MODEL_PROFILE_";

export function hostUiModelProfileEnvKey(profileId: HostUiModelProfileId): string {
	return `${PROFILE_ENV_PREFIX}${profileId.toUpperCase().replace(/[.-]/g, "_")}`;
}

function parseEnvCandidateList(raw: string | undefined): string[] | undefined {
	const value = raw?.trim();
	if (!value) {
		return undefined;
	}
	const parts = value.split(",").map((entry) => entry.trim()).filter(Boolean);
	return parts.length > 0 ? parts : undefined;
}

export function dedupeRuntimeCandidates(candidates: readonly string[]): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const candidate of candidates) {
		const id = candidate.trim();
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		ordered.push(id);
	}
	return ordered;
}

export function isHostUiModelProfileId(value: string): value is HostUiModelProfileId {
	return Object.prototype.hasOwnProperty.call(HOST_UI_MODEL_PROFILE_REGISTRY, value);
}

export function resolveHostUiModelProfile(
	profileId: HostUiModelProfileId,
	env: Pick<NodeJS.ProcessEnv, string> = process.env
): readonly string[] {
	const envKey = hostUiModelProfileEnvKey(profileId);
	const fromEnv = parseEnvCandidateList(env[envKey]);
	const builtin = HOST_UI_MODEL_PROFILE_REGISTRY[profileId];
	return dedupeRuntimeCandidates(fromEnv ?? builtin);
}

/** Primary runtime id for a profile (config panel / default smoke LM). */
export function resolveHostUiModelProfilePrimary(
	profileId: HostUiModelProfileId = HOST_UI_DEFAULT_TEXT_PROFILE,
	env: Pick<NodeJS.ProcessEnv, string> = process.env
): string {
	const candidates = resolveHostUiModelProfile(profileId, env);
	if (candidates.length === 0) {
		throw new Error(`Host UI model profile "${profileId}" resolved to an empty candidate list.`);
	}
	return candidates[0];
}

export interface HostUiModelSelectionInput {
	readonly modelProfile?: HostUiModelProfileId;
	readonly runtimeModelId?: string;
	readonly runtimeModelCandidates?: readonly string[];
	readonly requiredApiKeyProvider?: string;
	readonly requiredApiKeyProviders?: readonly string[];
	readonly kind?: string;
	readonly id?: string;
}

function inferProfileId(input: HostUiModelSelectionInput): HostUiModelProfileId | undefined {
	const scenarioId = input.id?.trim();
	if (scenarioId && scenarioId in HOST_UI_SCENARIO_PROFILE_BY_ID) {
		return HOST_UI_SCENARIO_PROFILE_BY_ID[scenarioId];
	}
	const provider = input.requiredApiKeyProvider?.trim().toLowerCase();
	if (input.kind === "native-vision" && provider === "zhipu") {
		return "zhipu.vision-native";
	}
	if (input.kind === "p4-self-refer") {
		return "p4.self-refer";
	}
	if (provider === "qwen" && (input.kind === "vision-proxy" || input.kind === "native-vision")) {
		return "qwen.vl-native";
	}
	if (provider === "zhipu") {
		if (input.kind === "tool-call") {
			return "zhipu.text.tool";
		}
		return "zhipu.text";
	}
	if (provider === "kimi") {
		return "kimi.text";
	}
	if (provider === "minimax") {
		return "minimax.text";
	}
	if (provider === "deepseek") {
		if (input.kind === "model-switch") {
			return "deepseek.text.pro";
		}
		if (
			input.kind === "vision-proxy"
			|| input.kind === "vision-cache-hit"
			|| input.kind === "p6-path-hydration"
			|| input.kind === "p7-restore"
			|| input.kind === "multi-turn"
			|| input.kind === "native-vision"
		) {
			return "deepseek.vision-proxy";
		}
		return "deepseek.text";
	}
	if (
		input.kind === "vision-proxy"
		|| input.kind === "vision-cache-hit"
		|| input.kind === "p6-path-hydration"
		|| input.kind === "p7-restore"
	) {
		return "deepseek.vision-proxy";
	}
	return undefined;
}

export function resolveHostUiRuntimeModelCandidates(
	input: HostUiModelSelectionInput,
	env: Pick<NodeJS.ProcessEnv, string> = process.env
): readonly string[] {
	if (input.runtimeModelCandidates?.length) {
		return dedupeRuntimeCandidates(input.runtimeModelCandidates);
	}
	if (input.modelProfile) {
		return resolveHostUiModelProfile(input.modelProfile, env);
	}
	if (input.runtimeModelId?.trim()) {
		return [input.runtimeModelId.trim()];
	}
	const inferred = inferProfileId(input);
	if (inferred) {
		return resolveHostUiModelProfile(inferred, env);
	}
	return [];
}

export function resolveIntegrationTurnCandidates(
	scenario: HostUiModelSelectionInput & { readonly id?: string; readonly turns?: readonly HostUiModelSelectionInput[] },
	turn: HostUiModelSelectionInput | undefined,
	env: Pick<NodeJS.ProcessEnv, string> = process.env
): readonly string[] {
	if (!turn && scenario.turns?.length) {
		return resolveIntegrationTurnCandidates(scenario, scenario.turns[0], env);
	}
	const turnLike = turn ?? {};
	const merged: HostUiModelSelectionInput = {
		id: scenario.id,
		modelProfile: turnLike.modelProfile ?? scenario.modelProfile,
		runtimeModelId: turnLike.runtimeModelId ?? scenario.runtimeModelId,
		runtimeModelCandidates: turnLike.runtimeModelCandidates ?? scenario.runtimeModelCandidates,
		requiredApiKeyProvider: turnLike.requiredApiKeyProvider ?? scenario.requiredApiKeyProvider,
		requiredApiKeyProviders: turnLike.requiredApiKeyProviders ?? scenario.requiredApiKeyProviders,
		kind: scenario.kind
	};
	const turnCandidates = resolveHostUiRuntimeModelCandidates(merged, env);
	if (turnCandidates.length > 0) {
		return turnCandidates;
	}
	return resolveHostUiRuntimeModelCandidates(
		{
			id: scenario.id,
			...scenario,
			kind: scenario.kind,
			requiredApiKeyProvider: scenario.requiredApiKeyProvider,
			requiredApiKeyProviders: scenario.requiredApiKeyProviders
		},
		env
	);
}

export function validateHostUiIntegrationModelProfiles(
	scenarios: readonly (HostUiModelSelectionInput & {
		readonly id: string;
		readonly kind?: string;
		readonly turns?: readonly HostUiModelSelectionInput[];
	})[]
): string[] {
	const issues: string[] = [];
	for (const scenario of scenarios) {
		if (scenario.kind === "p4-wrapped") {
			continue;
		}
		const turns = scenario.turns?.length
			? scenario.turns
			: [scenario];
		for (let index = 0; index < turns.length; index += 1) {
			const turn = turns[index];
			const candidates = resolveIntegrationTurnCandidates(scenario, turn);
			if (candidates.length === 0) {
				const label = scenario.turns?.length ? `${scenario.id}#${index + 1}` : scenario.id;
				issues.push(`host-ui.model-profile.empty:${label}`);
			}
		}
	}
	return issues;
}
