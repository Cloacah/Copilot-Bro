/**
 * Plan p4: wrapped handoff + self-refer vision proxy — Chat integration contracts (SSOT).
 */
import { resolveVisionProxyPolicy } from "../../../visionProxyPolicy";
import type { ExtensionSettings, ModelConfig } from "../../../types";

export const P4_SELF_REFER_RUNTIME_ID = "deepseek-v4-flash::deepseek";
export const P4_SELF_REFER_PROXY_MODEL_ID = "deepseek-v4-flash";

export function shouldSkipP4WrappedChatScenario(env: Pick<NodeJS.ProcessEnv, string>): { skip: true; reason: string } | { skip: false } {
	if (env.COPILOT_BRO_UI_SMOKE_MODEL_KIND?.trim().toLowerCase() !== "wrapped") {
		return { skip: true, reason: "requires-wrapped-model-kind" };
	}
	if (env.COPILOT_BRO_UI_SMOKE_INCLUDE_WRAPPED_MODELS !== "1") {
		return { skip: true, reason: "wrapped-models-not-included" };
	}
	return { skip: false };
}

export function evaluateSelfReferProxyPolicy(
	model: ModelConfig,
	settings: Pick<ExtensionSettings, "visionProxy">
): { ok: boolean; policy: ReturnType<typeof resolveVisionProxyPolicy> } {
	const policy = resolveVisionProxyPolicy(model, settings);
	return {
		ok: policy.reason === "self-disabled" && policy.enabled === false,
		policy
	};
}

export function buildSelfReferOverlayModel(base: ModelConfig): ModelConfig {
	return {
		...base,
		visionProxyModelId: P4_SELF_REFER_PROXY_MODEL_ID
	};
}
