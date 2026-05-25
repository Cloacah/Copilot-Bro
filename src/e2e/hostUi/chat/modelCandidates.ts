/** Re-exports and Host UI integration retry tuning. See {@link ./hostUiModelProfiles}. */
import { HOST_UI_MODEL_PROFILE_REGISTRY } from "./hostUiModelProfiles";

export {
	dedupeRuntimeCandidates,
	resolveIntegrationTurnCandidates,
	resolveHostUiModelProfile,
	resolveHostUiModelProfilePrimary,
	resolveHostUiRuntimeModelCandidates,
	validateHostUiIntegrationModelProfiles,
	HOST_UI_DEFAULT_TEXT_PROFILE,
	HOST_UI_MODEL_PROFILE_REGISTRY,
	HOST_UI_SMOKE_PROVIDER_TEXT_PROFILE,
	type HostUiModelProfileId
} from "./hostUiModelProfiles";

/** Host UI integration only — conservative defaults to limit API/token spend. */
export const HOST_UI_INTEGRATION_RETRY_DEFAULTS = {
	maxAttemptsPerCandidate: 3,
	baseDelayMs: 2_000,
	maxDelayMs: 30_000
} as const;

export interface HostUiIntegrationRetryOptions {
	readonly maxAttemptsPerCandidate?: number;
	readonly baseDelayMs?: number;
	readonly maxDelayMs?: number;
}

/** Optional looser retry for flaky CI (`COPILOT_BRO_UI_SMOKE_INTEGRATION_RETRY_AGGRESSIVE=1`). */
export function resolveHostUiTestRetryOptions(
	env: Pick<NodeJS.ProcessEnv, string> = process.env
): HostUiIntegrationRetryOptions {
	if (env.COPILOT_BRO_UI_SMOKE_INTEGRATION_RETRY_AGGRESSIVE?.trim() === "1") {
		return {
			maxAttemptsPerCandidate: 4,
			baseDelayMs: 2_000,
			maxDelayMs: 30_000
		};
	}
	return { ...HOST_UI_INTEGRATION_RETRY_DEFAULTS };
}

/** @deprecated Use profile `zhipu.vision-native`. */
export const HOST_UI_ZHIPU_VISION_RUNTIME_CANDIDATES = HOST_UI_MODEL_PROFILE_REGISTRY["zhipu.vision-native"];

/** @deprecated Use profile `zhipu.text`. */
export const HOST_UI_ZHIPU_TEXT_RUNTIME_CANDIDATES = HOST_UI_MODEL_PROFILE_REGISTRY["zhipu.text"];

/** @deprecated Use profile `zhipu.text.tool` (paid fallback is last in chain). */
export const HOST_UI_ZHIPU_TEXT_PAID_FALLBACK_CANDIDATES = HOST_UI_MODEL_PROFILE_REGISTRY["zhipu.text.tool"].filter((id) =>
	id.includes("glm-5")
);
