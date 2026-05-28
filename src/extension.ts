import * as vscode from "vscode";
import { getSettings, listProviders } from "./config/settings";
import { isHostUiSmokeMode } from "./smokeModeGate";
import { hasWorkspaceFolders, normalizeDefaultSaveScope, toVsCodeConfigurationTarget } from "./config/configScope";
import { registerCopilotBroLogStoragePath } from "./copilotBroLogPaths";
import { Logger } from "./logger";
import { clearApiKey, promptForApiKey, providerSecretKey, setDefaultApiKey } from "./secrets";
import { ConfigPanel } from "./ui/configPanel";
import { readMergedCustomModelsFromInspect, resolveDefaultSaveTarget } from "./ui/configPanelPersistence";
import { ExtendedModelsProvider } from "./provider";
import { listPromptPresets, openGlobalPromptPresetFolder, selectPromptPreset } from "./promptPresets";
import { refreshWrappedLanguageModelConfigs } from "./vscodeLmWrapper";

let logger: Logger | undefined;

function shouldEnableWrappedModelRefresh(): boolean {
	return !isHostUiSmokeMode() || process.env.COPILOT_BRO_UI_SMOKE_INCLUDE_WRAPPED_MODELS === "1";
}

export function activate(context: vscode.ExtensionContext): void {
	registerCopilotBroLogStoragePath(context.globalStorageUri.fsPath);
	logger = new Logger();
	try {
		logger.setLevel(getSettings().logLevel);
	} catch (error) {
		logger.warn("settings.read.failed.on-activate", {
			message: error instanceof Error ? error.message : String(error)
		});
	}
	const shouldRefreshWrappedModels = shouldEnableWrappedModelRefresh();

	const provider = new ExtendedModelsProvider(context, context.secrets, logger, () => getSettings());
	const refreshWrappedModels = async (): Promise<void> => {
		await refreshWrappedLanguageModelConfigs(logger);
		provider.refreshModels();
	};
	const subscriptions: vscode.Disposable[] = [
		logger,
		provider
	];
	try {
		subscriptions.push(vscode.lm.registerLanguageModelChatProvider("extendedModels", provider));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error("provider.register.failed", { message });
		void vscode.window.showWarningMessage("Copilot Bro: language model provider registration failed. Settings UI remains available. Check diagnostics output for details.");
	}
	context.subscriptions.push(
		...subscriptions,
		vscode.commands.registerCommand("extendedModels.manage", async () => {
			try {
				await ConfigPanel.open(context);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger?.error("config-panel.open.failed", { message });
				vscode.window.showErrorMessage(`Copilot Bro: Failed to open settings panel: ${message}`);
			}
		}),
		vscode.commands.registerCommand("extendedModels.openModelSettings", async () => {
			try {
				await ConfigPanel.open(context);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger?.error("config-panel.open.failed", { message });
				vscode.window.showErrorMessage(`Copilot Bro: Failed to open settings panel: ${message}`);
			}
		}),
		vscode.commands.registerCommand("extendedModels.openUiSettings", async () => {
			try {
				await ConfigPanel.open(context);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger?.error("config-panel.open.failed", { message });
				vscode.window.showErrorMessage(`Copilot Bro: Failed to open settings panel: ${message}`);
			}
		}),
		vscode.commands.registerCommand("extendedModels.openScopedSettingsJson", async (scope?: unknown) => {
			const preference = scope === "workspace" || scope === "global"
				? scope
				: vscode.workspace.getConfiguration("extendedModels").get<"workspace" | "global">("configWriteScope", "global");
			if (preference === "workspace" && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
				await vscode.commands.executeCommand("workbench.action.openWorkspaceSettingsFile");
				return;
			}
			await vscode.commands.executeCommand("workbench.action.openSettingsJson");
		}),
		vscode.commands.registerCommand("extendedModels.setApiKey", () => setDefaultApiKey(context.secrets)),
		vscode.commands.registerCommand("extendedModels.setProviderApiKey", async (providerName?: unknown) => {
			const changedProvider = await setProviderApiKey(context, providerName);
			if (changedProvider) {
				provider.refreshModels();
			}
		}),
		vscode.commands.registerCommand("extendedModels.clearApiKey", async () => {
			await clearSelectedApiKey(context);
			provider.refreshModels();
		}),
		vscode.commands.registerCommand("extendedModels.showOutput", () => logger?.show()),
		vscode.commands.registerCommand("extendedModels.exportModels", () => exportModels()),
		vscode.commands.registerCommand("extendedModels.importModels", () => importModels()),
		vscode.commands.registerCommand("extendedModels.selectPromptPreset", () => selectPromptPreset(context)),
		vscode.commands.registerCommand("extendedModels.openPromptPresetFolder", () => openGlobalPromptPresetFolder(context)),
		vscode.commands.registerCommand("extendedModels.clearCaches", async () => {
			await context.workspaceState.update("extendedModels.configPanel.selection", undefined);
			await context.globalState.update("extendedModels.providerModelCatalog", undefined);
			await ConfigPanel.open(context);
			vscode.window.showInformationMessage("Copilot Bro: Caches cleared and config panel refreshed.");
		}),
		...(shouldRefreshWrappedModels
			? [vscode.lm.onDidChangeChatModels(() => {
				void refreshWrappedModels().catch((error) => logger?.warn("wrapper.models.refresh.host-change.failed", {
					message: error instanceof Error ? error.message : String(error)
				}));
			})]
			: []),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("extendedModels.logLevel")) {
				try {
					logger?.setLevel(getSettings().logLevel);
				} catch (error) {
					logger?.warn("settings.read.failed.on-config-change", {
						message: error instanceof Error ? error.message : String(error)
					});
				}
			}
			if (event.affectsConfiguration("extendedModels")) {
				try {
					provider.refreshModels();
				} catch (error) {
					logger?.warn("settings.read.failed.on-config-refresh", {
						message: error instanceof Error ? error.message : String(error)
					});
				}
			}
		})
	);

	logger.info("extension.activated");
	if (shouldRefreshWrappedModels) {
		void refreshWrappedModels().catch((error) => logger?.warn("wrapper.models.refresh.startup.failed", {
			message: error instanceof Error ? error.message : String(error)
		}));
	} else {
		logger.info("wrapper.models.refresh.skipped", {
			reason: "host-ui-smoke"
		});
	}

	if (isHostUiSmokeMode() && logger) {
		const smokeLogger = logger;
		void import("./e2e/hostUi/extensionSmokeActivation.js")
			.then((smoke) => smoke.activateHostUiSmoke(context, { logger: smokeLogger, provider, refreshWrappedModels }))
			.catch((error) => logger?.warn("host-ui-smoke.activate.failed", {
				message: error instanceof Error ? error.message : String(error)
			}));
	}
}

async function exportModels(): Promise<void> {
	const uri = await vscode.window.showSaveDialog({
		title: "Export Copilot Bro Model Configuration",
		defaultUri: vscode.Uri.file("copilot-bro-models.json"),
		filters: {
			"JSON": [
				"json"
			]
		}
	});
	if (!uri) {
		return;
	}

	const config = vscode.workspace.getConfiguration("extendedModels");
	const models = readMergedCustomModelsFromInspect(config.inspect("models"));
	const content = JSON.stringify({ models: models.map((model) => removeSensitiveFields(model)) }, null, 2);
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
	vscode.window.showInformationMessage("Copilot Bro configuration exported.");
}

async function importModels(): Promise<void> {
	const uris = await vscode.window.showOpenDialog({
		title: "Import Copilot Bro Model Configuration",
		canSelectMany: false,
		filters: {
			"JSON": [
				"json"
			]
		}
	});
	const uri = uris?.[0];
	if (!uri) {
		return;
	}

	const bytes = await vscode.workspace.fs.readFile(uri);
	const text = new TextDecoder().decode(bytes);
	const parsed = JSON.parse(text) as unknown;
	const models = Array.isArray(parsed) ? parsed : (parsed as { models?: unknown }).models;
	if (!Array.isArray(models)) {
		throw new Error("Imported file must be a JSON array or an object with a models array.");
	}

	const config = vscode.workspace.getConfiguration("extendedModels");
	const preference = normalizeDefaultSaveScope(config.get("configWriteScope", "global"));
	const target = resolveDefaultSaveTarget(preference, hasWorkspaceFolders());
	await config.update("models", models, toVsCodeConfigurationTarget(target));
	vscode.window.showInformationMessage("Copilot Bro configuration imported.");
}

function removeSensitiveFields(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => removeSensitiveFields(item));
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (!isSensitiveKey(key)) {
			out[key] = removeSensitiveFields(item);
		}
	}
	return out;
}

function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return normalized.includes("authorization")
		|| normalized.includes("api-key")
		|| normalized.includes("apikey")
		|| normalized.includes("api_key")
		|| normalized.includes("token")
		|| normalized.includes("secret")
		|| normalized.includes("password")
		|| normalized === "cookie";
}

export function deactivate(): void {
	if (isHostUiSmokeMode()) {
		void import("./e2e/hostUi/extensionSmokeActivation.js").then((smoke) => smoke.deactivateHostUiSmokeExtension());
	}
	logger?.dispose();
	logger = undefined;
}

async function setProviderApiKey(context: vscode.ExtensionContext, preferredProvider?: unknown): Promise<string | undefined> {
	const normalizedPreferredProvider = typeof preferredProvider === "string" ? preferredProvider.trim().toLowerCase() : "";
	let provider = normalizedPreferredProvider;
	if (!provider) {
		const providers = getProviderChoices();
		const selected = await vscode.window.showQuickPick(providers, {
			title: "Copilot Bro: Select Provider",
			placeHolder: "Choose the provider whose API key should be updated"
		});
		provider = selected ?? "";
	}
	if (!provider) {
		return undefined;
	}

	const existing = await context.secrets.get(providerSecretKey(provider));
	const saved = await promptForApiKey(context.secrets, provider, existing);
	if (saved === "") {
		vscode.window.showInformationMessage(`Copilot Bro API key for ${provider} cleared.`);
	} else if (saved) {
		vscode.window.showInformationMessage(`Copilot Bro API key for ${provider} saved.`);
	}
	return saved === undefined ? undefined : provider;
}

async function clearSelectedApiKey(context: vscode.ExtensionContext): Promise<void> {
	const choices = [
		"Default",
		...getProviderChoices()
	];
	const selected = await vscode.window.showQuickPick(choices, {
		title: "Copilot Bro: Clear API Key"
	});
	if (!selected) {
		return;
	}
	await clearApiKey(context.secrets, selected === "Default" ? undefined : selected);
	vscode.window.showInformationMessage(`Copilot Bro API key for ${selected} cleared.`);
}

function getProviderChoices(): string[] {
	const settings = getSettings();
	const configuredCustomProviders = vscode.workspace.getConfiguration("extendedModels").get<string[]>("customProviders", []);
	const providers = Array.from(new Set([
		...listProviders(settings.models),
		...configuredCustomProviders
			.filter((provider) => typeof provider === "string")
			.map((provider) => provider.trim().toLowerCase())
			.filter(Boolean)
	])).sort((left, right) => left.localeCompare(right));
	if (providers.length > 0) {
		return providers;
	}
	return [
		"deepseek",
		"zhipu",
		"minimax",
		"kimi",
		"qwen"
	];
}
