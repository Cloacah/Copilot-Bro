/**
 * Webview `post()` commands that must carry `configWriteScope` for scoped writes.
 * Injected into the config panel HTML — keep this list the single source of truth.
 */
export const CONFIG_PANEL_POST_COMMANDS_REQUIRING_CONFIG_WRITE_SCOPE: readonly string[] = [
	"addModelFamilyVersion",
	"deleteModel",
	"hostUiSmokeSaveModel",
	"removeModelFamilyVersion",
	"saveCustomModel",
	"saveModel",
	"savePhase1Section",
	"saveVisionProxyBase",
	"saveVisionProxyPrompt",
	"setProviderEndpoint"
] as const;

export function configPanelPostCommandRequiresConfigWriteScope(command: string): boolean {
	return CONFIG_PANEL_POST_COMMANDS_REQUIRING_CONFIG_WRITE_SCOPE.includes(command);
}
