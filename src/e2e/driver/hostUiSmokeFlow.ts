import type { HostUiSmokeE2eSuiteId } from "../hostUi/suites/e2eSuites";
import { shouldRunHostUiSmokeE2eSuite } from "../hostUi/suites/e2eSuites";

export type HostUiSmokeRequestPath = "chat-ui" | "lm-api";

export function getHostUiSmokeRequestPath(env: Pick<NodeJS.ProcessEnv, string>): HostUiSmokeRequestPath {
	const value = env.COPILOT_BRO_UI_SMOKE_REQUEST_PATH?.trim().toLowerCase();
	return value === "lm-api" ? "lm-api" : "chat-ui";
}

export function shouldUseLanguageModelApiCommand(requestPath: HostUiSmokeRequestPath): boolean {
	return requestPath === "lm-api";
}

/**
 * Full E2E defaults to opening the Copilot Bro settings panel smoke.
 * Opt out with COPILOT_BRO_UI_SMOKE_CONFIG_PANEL=0, or omit the `config-panel` suite via COPILOT_BRO_UI_SMOKE_E2E.
 */
export function shouldRunConfigPanelSmoke(
	env: Pick<NodeJS.ProcessEnv, string>,
	e2eSuites: ReadonlySet<HostUiSmokeE2eSuiteId>
): boolean {
	if (env.COPILOT_BRO_UI_SMOKE_CONFIG_PANEL === "0") {
		return false;
	}
	if (env.COPILOT_BRO_UI_SMOKE_CONFIG_PANEL === "1") {
		return true;
	}
	return shouldRunHostUiSmokeE2eSuite(e2eSuites, "config-panel");
}

/**
 * After Chat UI suite, also run the palette-driven LM API smoke command.
 * Default: on when mock server is used (no real token cost); off otherwise unless explicitly "1"/"true".
 */
export function shouldRunPostChatLmApiAfterChat(
	env: Pick<NodeJS.ProcessEnv, string>,
	options: { hasMockServer: boolean; smokeModelKind: "provider" | "wrapped" }
): boolean {
	if (options.smokeModelKind === "wrapped") {
		return false;
	}
	const explicit = env.COPILOT_BRO_UI_SMOKE_POST_CHAT_LM_API?.trim().toLowerCase();
	if (explicit === "1" || explicit === "true") {
		return true;
	}
	if (explicit === "0" || explicit === "false") {
		return false;
	}
	// Default on for provider chat-ui so LM API palette path is exercised with real keys too (opt-out with 0).
	return options.smokeModelKind === "provider";
}
