/**
 * Host UI Chat acceptance matrix: scenario groups, default run list, and coverage metadata.
 * Scenarios are defined in {@link HOST_UI_SMOKE_CHAT_INTEGRATION_CANONICAL}; this module owns ordering and grouping.
 */

/** Token-only scenarios safe under mock LM (no vision API). */
export const HOST_UI_SMOKE_CHAT_MOCK_SAFE_IDS = [
	"model-switch-pro-token"
] as const;

/** Core integration scenarios (vision + routing); require API keys when not mock. */
export const HOST_UI_SMOKE_CHAT_ACCEPTANCE_CORE_IDS = [
	"p3-global-qwen-proxy-chat",
	"vision-proxy-miss",
	"vision-proxy-cache-hit",
	"multi-turn-vision-then-token",
	"p5-qwen-vl-native-chat",
	"p7-describe-only-evidence",
	"p6-path-hydration-chat",
	"p7-restore-artifact-chat",
	"p4-self-refer-proxy-chat",
	"p4-wrapped-vision-chat",
	"model-switch-pro-token",
	"prompt-preset-applied"
] as const;

/** Extended provider / switch / native coverage (Host UI Chat). */
export const HOST_UI_SMOKE_CHAT_ACCEPTANCE_EXTENDED_IDS = [
	"native-vision-zhipu-chat",
	"provider-token-smoke-chat",
	"multi-provider-switch-context",
	"tool-call-model-chat"
] as const;

/** Default integration list when COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_SCENARIOS is unset. */
export const HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS = [
	...HOST_UI_SMOKE_CHAT_ACCEPTANCE_CORE_IDS,
	...HOST_UI_SMOKE_CHAT_ACCEPTANCE_EXTENDED_IDS
] as const;

export type HostUiSmokeChatAcceptanceGroup =
	| "vision-proxy"
	| "vision-native"
	| "provider-token"
	| "model-switch"
	| "multi-turn"
	| "routing-p4"
	| "restore-p7";

export const HOST_UI_SMOKE_CHAT_ACCEPTANCE_GROUPS: Readonly<Record<HostUiSmokeChatAcceptanceGroup, readonly string[]>> = {
	"vision-proxy": [
		"p3-global-qwen-proxy-chat",
		"vision-proxy-miss",
		"vision-proxy-cache-hit",
		"p7-describe-only-evidence",
		"p6-path-hydration-chat",
		"p7-restore-artifact-chat",
		"p7-chat-benchmark-web-restore"
	],
	"vision-native": ["p5-qwen-vl-native-chat", "native-vision-zhipu-chat"],
	"provider-token": ["provider-token-smoke-chat", "tool-call-model-chat"],
	"model-switch": ["model-switch-pro-token", "multi-provider-switch-context"],
	"multi-turn": ["multi-turn-vision-then-token", "multi-provider-switch-context"],
	"routing-p4": ["p4-self-refer-proxy-chat", "p4-wrapped-vision-chat"],
	"restore-p7": ["p7-restore-artifact-chat", "p7-chat-benchmark-web-restore"]
};

export function listAllChatAcceptanceScenarioIds(): string[] {
	return [...HOST_UI_SMOKE_CHAT_ACCEPTANCE_DEFAULT_IDS, "p7-chat-benchmark-web-restore"];
}
