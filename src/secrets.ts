import * as vscode from "vscode";
import process from "node:process";
import type { ModelConfig } from "./types";
import {
	getApiKey as getApiKeyFromStorage,
	providerSecretKey,
	shouldDeferApiKeyPromptInSmoke
} from "./secretsStorage";

export { providerSecretKey } from "./secretsStorage";

export async function getApiKey(secrets: vscode.SecretStorage, model: ModelConfig): Promise<string | undefined> {
	return getApiKeyFromStorage(secrets, model);
}

export async function promptForApiKey(
	secrets: vscode.SecretStorage,
	provider?: string,
	existing?: string
): Promise<string | undefined> {
	const normalizedProvider = provider?.trim().toLowerCase();
	const key = normalizedProvider ? providerSecretKey(normalizedProvider) : "extendedModels.apiKey";
	const title = normalizedProvider ? `API Key for ${normalizedProvider}` : "Default API Key";
	const value = await vscode.window.showInputBox({
		title: `Copilot Bro: ${title}`,
		prompt: existing ? "Update API key. Leave empty to clear it." : "Enter API key. It will be stored in VS Code SecretStorage.",
		ignoreFocusOut: true,
		password: true
	});

	if (value === undefined) {
		return undefined;
	}

	if (!value.trim()) {
		await secrets.delete(key);
		return "";
	}

	const trimmed = value.trim();
	await secrets.store(key, trimmed);
	return trimmed;
}

export async function ensureApiKey(secrets: vscode.SecretStorage, model: ModelConfig): Promise<string | undefined> {
	const existing = await getApiKey(secrets, model);
	if (existing) {
		return existing;
	}
	if (shouldDeferApiKeyPromptInSmoke()) {
		return undefined;
	}

	const entered = await promptForApiKey(secrets, model.provider);
	return entered || undefined;
}

export async function clearApiKey(secrets: vscode.SecretStorage, provider?: string): Promise<void> {
	if (provider?.trim()) {
		await secrets.delete(providerSecretKey(provider));
	} else {
		await secrets.delete("extendedModels.apiKey");
	}
}

export async function setDefaultApiKey(secrets: vscode.SecretStorage): Promise<void> {
	const existing = await secrets.get("extendedModels.apiKey");
	const saved = await promptForApiKey(secrets, undefined, existing);
	if (saved === "") {
		vscode.window.showInformationMessage("Copilot Bro default API key cleared.");
	} else if (saved) {
		vscode.window.showInformationMessage("Copilot Bro default API key saved.");
	}
}
