/** True when the extension runs inside Host UI smoke (isolated VS Code + test VSIX). */
export function isHostUiSmokeMode(): boolean {
	return process.env.COPILOT_BRO_UI_SMOKE === "1";
}
