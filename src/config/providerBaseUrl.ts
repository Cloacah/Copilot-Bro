/**
 * Provider-owned base URLs: models never persist baseUrl; resolution is at runtime.
 */

import {
	CUSTOM_ENDPOINT_PROFILE_ID,
	findProviderEndpointCatalog,
	getDefaultEndpointProfileId,
	normalizeProviderKey,
	resolveProviderEndpointBaseUrl,
	resolveStoredProviderEndpointProfileId,
	type ModelLikeWithProvider
} from "./providerEndpoints";

/** Built-in default gateways when no workspace profile is selected. */
export const PROVIDER_SEED_BASE_URLS: Readonly<Record<string, string>> = {
	deepseek: "https://api.deepseek.com",
	zhipu: "https://open.bigmodel.cn/api/paas/v4",
	minimax: "https://api.minimax.io/v1",
	kimi: "https://api.moonshot.ai/v1",
	moonshot: "https://api.moonshot.ai/v1",
	qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
	dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1"
};

export function normalizeProviderCustomBaseUrls(input: unknown): Record<string, string> {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [rawProvider, rawUrl] of Object.entries(input as Record<string, unknown>)) {
		const provider = normalizeProviderKey(rawProvider);
		const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
		if (provider && url && /^https?:\/\//i.test(url)) {
			out[provider] = url;
		}
	}
	return out;
}

export function resolveEffectiveModelBaseUrl(
	model: ModelLikeWithProvider,
	providerEndpoints: Record<string, string>,
	providerCustomBaseUrls: Record<string, string> = {}
): string | undefined {
	if (model.modelSource === "vscode-lm-wrapper") {
		return undefined;
	}
	const provider = normalizeProviderKey(model.provider);
	if (!provider) {
		return undefined;
	}
	const custom = providerCustomBaseUrls[provider];
	if (custom) {
		return custom;
	}
	const profileId = resolveStoredProviderEndpointProfileId(model.provider, providerEndpoints);
	if (profileId && profileId !== CUSTOM_ENDPOINT_PROFILE_ID) {
		const fromProfile = resolveProviderEndpointBaseUrl(model.provider, profileId);
		if (fromProfile) {
			return fromProfile;
		}
	}
	const catalog = findProviderEndpointCatalog(model.provider);
	const defaultProfileId = catalog?.defaultProfileId ?? getDefaultEndpointProfileId(model.provider);
	if (defaultProfileId) {
		const fromDefault = resolveProviderEndpointBaseUrl(model.provider, defaultProfileId);
		if (fromDefault) {
			return fromDefault;
		}
	}
	return PROVIDER_SEED_BASE_URLS[provider];
}

export function enrichModelsWithProviderBaseUrl<T extends ModelLikeWithProvider>(
	models: readonly T[],
	providerEndpoints: Record<string, string>,
	providerCustomBaseUrls: Record<string, string> = {}
): T[] {
	return models.map((model) => {
		const baseUrl = resolveEffectiveModelBaseUrl(model, providerEndpoints, providerCustomBaseUrls);
		if (!baseUrl) {
			const { baseUrl: _removed, ...rest } = model as T & { baseUrl?: string };
			return rest as T;
		}
		return { ...model, baseUrl };
	});
}

export function stripBaseUrlFromModelRecord(record: Record<string, unknown>): Record<string, unknown> {
	const next = { ...record };
	delete next.baseUrl;
	return next;
}
