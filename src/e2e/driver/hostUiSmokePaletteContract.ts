/**
 * Command palette entries used by Host UI smoke (nut-js types the **title** string).
 * Must match `package.json` → `contributes.commands` for the same `command` id.
 */
export const HOST_UI_SMOKE_PALETTE = {
	setProviderApiKey: { commandId: "extendedModels.setProviderApiKey", title: "Set Provider API Key" },
	openChat: { commandId: "extendedModels.hostUiSmokeOpenChat", title: "Open Host UI Smoke Chat" },
	runChatSuite: { commandId: "extendedModels.hostUiSmokeRunChatSuite", title: "Run Host UI Smoke Chat Suite" },
	submitChatRequest: { commandId: "extendedModels.hostUiSmokeSubmitChatRequest", title: "Submit Host UI Smoke Chat Request" },
	logPresetCatalog: { commandId: "extendedModels.hostUiSmokeLogPresetCatalog", title: "Log Preset Catalog Smoke" },
	runProviderProbe: { commandId: "extendedModels.hostUiSmokeProbeProviders", title: "Run Provider Probe Smoke" },
	runVisionContract: { commandId: "extendedModels.hostUiSmokeVisionContract", title: "Run Vision Contract Smoke" },
	runVisionJsonRepair: { commandId: "extendedModels.hostUiSmokeVisionJsonRepair", title: "Run Vision JSON Repair Smoke" },
	runPhase1SettingsExhaustive: {
		commandId: "extendedModels.hostUiSmokePhase1SettingsExhaustive",
		title: "Run Phase1 Settings Exhaustive Smoke"
	},
	runPhase1SettingsRoundtrip: {
		commandId: "extendedModels.hostUiSmokePhase1SettingsRoundtrip",
		title: "Run Phase1 Settings Roundtrip Smoke"
	},
	runVisionProbe: { commandId: "extendedModels.hostUiSmokeVisionProbe", title: "Run Vision Probe Smoke" },
	runScreenshotPageVision: {
		commandId: "extendedModels.hostUiSmokeScreenshotPageVision",
		title: "Run Screenshot Page Vision Smoke"
	},
	runVisionChatProgress: {
		commandId: "extendedModels.hostUiSmokeVisionChatProgress",
		title: "Run Vision Chat Progress Smoke"
	},
	runP6P7RealAssets: {
		commandId: "extendedModels.hostUiSmokeP6P7RealAssets",
		title: "Run P6 P7 Real Assets Smoke"
	},
	runAgentSmokeBudgeted: { commandId: "extendedModels.hostUiSmokeAgentSmokeBudgeted", title: "Run Agent Smoke Budgeted" },
	runHostUiSmokeRequest: { commandId: "extendedModels.hostUiSmokeRunRequest", title: "Run Host UI Smoke Request" }
} as const;

export type HostUiSmokePaletteEntry = (typeof HOST_UI_SMOKE_PALETTE)[keyof typeof HOST_UI_SMOKE_PALETTE];

/** For contract tests: every palette command the smoke harness may invoke. */
export function listHostUiSmokePaletteContracts(): readonly HostUiSmokePaletteEntry[] {
	return Object.values(HOST_UI_SMOKE_PALETTE);
}
