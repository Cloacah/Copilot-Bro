import process from "node:process";
import type { ModelConfig } from "./types";

const DEFAULT_KEY = "extendedModels.apiKey";

export function shouldDeferApiKeyPromptInSmoke(): boolean {
	return process.env.COPILOT_BRO_UI_SMOKE === "1";
}

export interface SecretStorageLike {
	get(key: string): Thenable<string | undefined>;
}

export function providerSecretKey(provider: string): string {
	return `extendedModels.apiKey.${provider.trim().toLowerCase()}`;
}

export async function getApiKey(secrets: SecretStorageLike, model: ModelConfig): Promise<string | undefined> {
	const providerKey = providerSecretKey(model.provider);
	return (await secrets.get(providerKey)) ?? (await secrets.get(DEFAULT_KEY));
}
