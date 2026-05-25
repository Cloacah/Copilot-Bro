/**
 * Host UI smoke environment helpers (packaged in release VSIX).
 * Driver-only window matching stays in {@link ../driver/hostUiSmokeEnv}.
 */
export const PROVIDER_API_KEY_ENVIRONMENT: Record<string, string> = {
	deepseek: "DEEPSEEK_API_KEY",
	zhipu: "ZHIPU_API_KEY",
	qwen: "DASHSCOPE_API_KEY",
	dashscope: "DASHSCOPE_API_KEY",
	minimax: "MINIMAX_API_KEY",
	kimi: "KIMI_API_KEY",
	moonshot: "KIMI_API_KEY"
} as const;

export const API_KEY_ENVIRONMENT_VARIABLES = Array.from(new Set(Object.values(PROVIDER_API_KEY_ENVIRONMENT))).sort();

/** Built-in providers that accept per-provider API keys in host UI smoke. */
export const HOST_UI_SMOKE_API_KEY_PROVIDERS = ["deepseek", "zhipu", "kimi", "minimax", "qwen"] as const;

export type ApiKeyEnvironmentStatus = "present" | "missing";

export function getProviderEnvironmentVariableName(provider: string): string | undefined {
	return PROVIDER_API_KEY_ENVIRONMENT[provider.trim().toLowerCase()];
}

export function summarizeApiKeyEnvironment(env: Pick<NodeJS.ProcessEnv, string>): Record<string, ApiKeyEnvironmentStatus> {
	return Object.fromEntries(
		API_KEY_ENVIRONMENT_VARIABLES.map((variableName) => [
			variableName,
			env[variableName]?.trim() ? "present" : "missing"
		])
	);
}
