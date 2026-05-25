import * as vscode from "vscode";
import { BUILT_IN_PRESETS } from "../../config/presets";
import { QWEN_MODEL_FAMILIES } from "../../config/qwenModelFamilies";
import { getSettings } from "../../config/settings";
import { getVisiblePhase1Sections, sanitizePhase1SectionValue, type Phase1ConfigSectionKey } from "../../ui/phase1ConfigUi";
import {
	applyPhase1SectionRoundtripMutation,
	buildPhase1SettingsChecklist
} from "./settingsChecklist";
import { listPromptPresets } from "../../promptPresets";
import type { ExtendedModelsProvider } from "../../provider";
import type { Logger } from "../../logger";

export interface HostUiSmokeCommandHandlers {
	openChat: () => void | Promise<void>;
	runChatSuite: () => void | Promise<void>;
	probeProviders: () => void | Promise<void>;
	visionContract: () => void | Promise<void>;
	visionJsonRepair: () => void | Promise<void>;
	visionProbe: () => void | Promise<void>;
	screenshotPageVision: () => void | Promise<void>;
	visionChatProgress: (provider: ExtendedModelsProvider) => void | Promise<void>;
	p6P7RealAssets: (logger: Logger) => void | Promise<unknown>;
	agentSmokeBudgeted: () => void | Promise<void>;
	runRequest: () => void | Promise<void>;
	submitChatRequest: () => void | Promise<void>;
}

export function isHostUiSmokeMode(): boolean {
	return process.env.COPILOT_BRO_UI_SMOKE === "1";
}

export function registerHostUiSmokeCommands(
	context: vscode.ExtensionContext,
	provider: ExtendedModelsProvider,
	logger: Logger | undefined,
	handlers: HostUiSmokeCommandHandlers
): vscode.Disposable[] {
	if (!isHostUiSmokeMode()) {
		return [];
	}
	return [
		vscode.commands.registerCommand("extendedModels.hostUiSmokeOpenChat", () => handlers.openChat()),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeRunChatSuite", async () => {
			logger?.info("host-ui-smoke.command.run-chat-suite.invoked");
			await handlers.runChatSuite();
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeLogPresetCatalog", async () => {
			logger?.info("host-ui-smoke.command.log-preset-catalog.invoked");
			const promptPresets = await listPromptPresets(context);
			const qwenFamilyKeys = QWEN_MODEL_FAMILIES.map((family) => family.familyKey);
			logger?.info("host-ui-smoke.preset.catalog.end", {
				promptPresetCount: promptPresets.length,
				promptPresetIds: promptPresets.map((preset) => preset.id),
				builtInModelCount: BUILT_IN_PRESETS.length,
				qwenFamilyCount: QWEN_MODEL_FAMILIES.length,
				qwenFamilyKeys,
				qwenModelIdCount: QWEN_MODEL_FAMILIES.reduce((total, family) => total + family.versionIds.length, 0)
			});
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeProbeProviders", async () => {
			logger?.info("host-ui-smoke.command.probe-providers.invoked");
			await handlers.probeProviders();
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeVisionContract", async () => {
			logger?.info("host-ui-smoke.command.vision-contract.invoked");
			await handlers.visionContract();
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeVisionJsonRepair", async () => {
			logger?.info("host-ui-smoke.command.vision-json-repair.invoked");
			await handlers.visionJsonRepair();
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokePhase1SettingsRoundtrip", async () => {
			logger?.info("host-ui-smoke.command.phase1-settings-roundtrip.invoked");
			const checklist = buildPhase1SettingsChecklist();
			let ok = true;
			let roundtripCount = 0;
			try {
				const config = vscode.workspace.getConfiguration("extendedModels");
				const settings = getSettings();
				for (const section of getVisiblePhase1Sections()) {
					const sectionKey = section.key as Phase1ConfigSectionKey;
					const previous = config.get(sectionKey) as Record<string, unknown>;
					const mutated = applyPhase1SectionRoundtripMutation(settings, sectionKey);
					const expectedSanitized = sanitizePhase1SectionValue(sectionKey, mutated);
					await config.update(sectionKey, mutated, vscode.ConfigurationTarget.Workspace);
					const rereadSettings = getSettings();
					const actualSanitized = sanitizePhase1SectionValue(
						sectionKey,
						rereadSettings[sectionKey] as unknown
					);
					for (const field of section.fields) {
						const expected = expectedSanitized[field.key];
						const actual = actualSanitized[field.key];
						const fieldOk = JSON.stringify(expected) === JSON.stringify(actual);
						logger?.info("host-ui-smoke.phase1.settings.roundtrip", {
							sectionKey,
							fieldKey: field.key,
							ok: fieldOk,
							expectedType: expected === null ? "null" : typeof expected
						});
						if (!fieldOk) {
							ok = false;
						}
						roundtripCount += 1;
					}
					await config.update(sectionKey, previous, vscode.ConfigurationTarget.Workspace);
				}
				logger?.info("host-ui-smoke.phase1.settings.roundtrip.end", {
					ok,
					roundtripCount,
					checklistCount: checklist.length
				});
			} catch (error) {
				ok = false;
				logger?.error("host-ui-smoke.phase1.settings.roundtrip.end", {
					ok: false,
					message: error instanceof Error ? error.message : String(error)
				});
			}
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokePhase1SettingsExhaustive", async () => {
			logger?.info("host-ui-smoke.command.phase1-settings-exhaustive.invoked");
			try {
				const settings = getSettings();
				const sections = getVisiblePhase1Sections();
				let probeCount = 0;
				for (const section of sections) {
					const value = settings[section.key];
					if (!value || typeof value !== "object") {
						throw new Error(`missing settings section: ${section.key}`);
					}
					const record = value as unknown as Record<string, unknown>;
					for (const field of section.fields) {
						if (!(field.key in record)) {
							throw new Error(`missing field key ${section.key}.${field.key}`);
						}
						const v = record[field.key];
						if (v === undefined) {
							throw new Error(`undefined value for ${section.key}.${field.key}`);
						}
						logger?.info("host-ui-smoke.phase1.settings.field", {
							sectionKey: section.key,
							fieldKey: field.key,
							kind: field.kind,
							present: true,
							valueType: v === null ? "null" : typeof v
						});
						probeCount += 1;
					}
				}
				logger?.info("host-ui-smoke.phase1.settings.exhaustive.end", {
					ok: true,
					probeCount,
					sectionCount: sections.length,
					sectionKeys: sections.map((section) => section.key)
				});
			} catch (error) {
				logger?.error("host-ui-smoke.phase1.settings.exhaustive.end", {
					ok: false,
					message: error instanceof Error ? error.message : String(error)
				});
			}
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeVisionProbe", async () => {
			logger?.info("host-ui-smoke.command.vision-probe.invoked");
			await handlers.visionProbe();
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeScreenshotPageVision", async () => {
			logger?.info("host-ui-smoke.command.screenshot-page-vision.invoked");
			await handlers.screenshotPageVision();
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeVisionChatProgress", async () => {
			logger?.info("host-ui-smoke.command.vision-chat-progress.invoked");
			await handlers.visionChatProgress(provider);
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeP6P7RealAssets", async () => {
			logger?.info("host-ui-smoke.command.p6-p7-real-assets.invoked");
			if (!logger) {
				return;
			}
			await handlers.p6P7RealAssets(logger);
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeAgentSmokeBudgeted", async () => {
			logger?.info("host-ui-smoke.command.agent-smoke-budgeted.invoked");
			await handlers.agentSmokeBudgeted();
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeRunRequest", async () => {
			logger?.info("host-ui-smoke.command.run-request.invoked");
			await handlers.runRequest();
		}),
		vscode.commands.registerCommand("extendedModels.hostUiSmokeSubmitChatRequest", async () => {
			logger?.info("host-ui-smoke.command.submit-chat-request.invoked");
			await handlers.submitChatRequest();
		})
	];
}
