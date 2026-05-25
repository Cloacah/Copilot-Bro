/**
 * Provider endpoint profiles: multi-region / multi-gateway base URLs keyed by provider aliases.
 * Inspired by OpenAPI "servers" lists — one catalog, many providers, runtime resolution.
 */

export interface ProviderEndpointProfile {
	readonly id: string;
	readonly baseUrl: string;
	readonly labels: { readonly zh: string; readonly en: string };
	readonly region?: string;
}

export interface ProviderEndpointCatalogEntry {
	/** Provider keys that share this catalog (e.g. qwen, dashscope). */
	readonly providers: readonly string[];
	readonly defaultProfileId: string;
	readonly profiles: readonly ProviderEndpointProfile[];
}

/** DashScope OpenAI-compatible mode — official regional endpoints. */
const DASHSCOPE_COMPAT_PATH = "/compatible-mode/v1";

export const PROVIDER_ENDPOINT_CATALOG: readonly ProviderEndpointCatalogEntry[] = [
	{
		providers: ["qwen", "dashscope"],
		defaultProfileId: "dashscope-cn",
		profiles: [
			{
				id: "dashscope-cn",
				baseUrl: `https://dashscope.aliyuncs.com${DASHSCOPE_COMPAT_PATH}`,
				labels: { zh: "中国（北京）", en: "China (Beijing)" },
				region: "cn-beijing"
			},
			{
				id: "dashscope-intl",
				baseUrl: `https://dashscope-intl.aliyuncs.com${DASHSCOPE_COMPAT_PATH}`,
				labels: { zh: "国际（新加坡）", en: "International (Singapore)" },
				region: "ap-southeast-1"
			},
			{
				id: "dashscope-us",
				baseUrl: `https://dashscope-us.aliyuncs.com${DASHSCOPE_COMPAT_PATH}`,
				labels: { zh: "美国（弗吉尼亚）", en: "United States (Virginia)" },
				region: "us-east-1"
			}
		]
	},
	{
		providers: ["kimi", "moonshot"],
		defaultProfileId: "moonshot-global",
		profiles: [
			{
				id: "moonshot-global",
				baseUrl: "https://api.moonshot.ai/v1",
				labels: { zh: "国际", en: "Global" },
				region: "global"
			},
			{
				id: "moonshot-cn",
				baseUrl: "https://api.moonshot.cn/v1",
				labels: { zh: "中国", en: "China" },
				region: "cn"
			}
		]
	},
	{
		providers: ["minimax"],
		defaultProfileId: "minimax-global",
		profiles: [
			{
				id: "minimax-global",
				baseUrl: "https://api.minimax.io/v1",
				labels: { zh: "国际", en: "Global" },
				region: "global"
			},
			{
				id: "minimax-cn",
				baseUrl: "https://api.minimaxi.com/v1",
				labels: { zh: "中国", en: "China" },
				region: "cn"
			}
		]
	}
] as const;

export const CUSTOM_ENDPOINT_PROFILE_ID = "custom";

export function normalizeProviderKey(provider: string): string {
	return provider.trim().toLowerCase();
}

export function normalizeBaseUrlForCompare(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/u, "").toLowerCase();
}

export function findProviderEndpointCatalog(provider: string): ProviderEndpointCatalogEntry | undefined {
	const key = normalizeProviderKey(provider);
	return PROVIDER_ENDPOINT_CATALOG.find((entry) =>
		entry.providers.some((alias) => normalizeProviderKey(alias) === key));
}

export function listProviderEndpointProfiles(provider: string): readonly ProviderEndpointProfile[] {
	return findProviderEndpointCatalog(provider)?.profiles ?? [];
}

export function findEndpointProfileById(provider: string, profileId: string): ProviderEndpointProfile | undefined {
	const catalog = findProviderEndpointCatalog(provider);
	if (!catalog) {
		return undefined;
	}
	return catalog.profiles.find((profile) => profile.id === profileId);
}

export function findEndpointProfileByBaseUrl(provider: string, baseUrl: string): ProviderEndpointProfile | undefined {
	const normalized = normalizeBaseUrlForCompare(baseUrl);
	if (!normalized) {
		return undefined;
	}
	return listProviderEndpointProfiles(provider).find((profile) =>
		normalizeBaseUrlForCompare(profile.baseUrl) === normalized);
}

export function resolveEndpointProfileId(
	provider: string,
	baseUrl: string | undefined,
	storedProfileId?: string
): string {
	const catalog = findProviderEndpointCatalog(provider);
	if (!catalog) {
		return CUSTOM_ENDPOINT_PROFILE_ID;
	}
	if (baseUrl?.trim()) {
		const byUrl = findEndpointProfileByBaseUrl(provider, baseUrl);
		if (byUrl) {
			return byUrl.id;
		}
		return CUSTOM_ENDPOINT_PROFILE_ID;
	}
	if (storedProfileId && storedProfileId !== CUSTOM_ENDPOINT_PROFILE_ID) {
		const byId = findEndpointProfileById(provider, storedProfileId);
		if (byId) {
			return byId.id;
		}
	}
	return catalog.defaultProfileId;
}

export function resolveProviderEndpointBaseUrl(provider: string, profileId: string): string | undefined {
	const profile = findEndpointProfileById(provider, profileId);
	return profile?.baseUrl;
}

export function getDefaultEndpointProfileId(provider: string): string | undefined {
	return findProviderEndpointCatalog(provider)?.defaultProfileId;
}

export function normalizeProviderEndpointsConfig(input: unknown): Record<string, string> {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [rawProvider, rawProfileId] of Object.entries(input as Record<string, unknown>)) {
		const provider = normalizeProviderKey(rawProvider);
		const profileId = typeof rawProfileId === "string" ? rawProfileId.trim() : "";
		if (!provider || !profileId || profileId === CUSTOM_ENDPOINT_PROFILE_ID) {
			continue;
		}
		const catalog = findProviderEndpointCatalog(provider);
		if (!catalog) {
			continue;
		}
		if (!catalog.profiles.some((profile) => profile.id === profileId)) {
			continue;
		}
		out[provider] = profileId;
	}
	return out;
}

export function resolveStoredProviderEndpointProfileId(
	provider: string,
	providerEndpoints: Record<string, string>
): string | undefined {
	const key = normalizeProviderKey(provider);
	const direct = providerEndpoints[key];
	if (direct) {
		return direct;
	}
	const catalog = findProviderEndpointCatalog(provider);
	if (!catalog) {
		return undefined;
	}
	for (const alias of catalog.providers) {
		const aliasKey = normalizeProviderKey(alias);
		if (providerEndpoints[aliasKey]) {
			return providerEndpoints[aliasKey];
		}
	}
	return undefined;
}

export interface ModelLikeWithProvider {
	provider: string;
	baseUrl?: string;
	modelSource?: string;
}

/**
 * @deprecated Use enrichModelsWithProviderBaseUrl from ./providerBaseUrl
 */
export function applyProviderEndpointPreferences<T extends ModelLikeWithProvider>(
	models: readonly T[],
	providerEndpoints: Record<string, string>
): T[] {
	// Lazy import avoids circular dependency with providerBaseUrl.ts
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { enrichModelsWithProviderBaseUrl } = require("./providerBaseUrl") as typeof import("./providerBaseUrl");
	return enrichModelsWithProviderBaseUrl(models, providerEndpoints, {});
}

export function providerEndpointCatalogForClient(): readonly {
	providers: readonly string[];
	defaultProfileId: string;
	profiles: readonly { id: string; baseUrl: string; labels: { zh: string; en: string } }[];
}[] {
	return PROVIDER_ENDPOINT_CATALOG.map((entry) => ({
		providers: [...entry.providers],
		defaultProfileId: entry.defaultProfileId,
		profiles: entry.profiles.map((profile) => ({
			id: profile.id,
			baseUrl: profile.baseUrl,
			labels: { ...profile.labels }
		}))
	}));
}

export function applyProviderBaseUrlToStoredModels(
	current: unknown[],
	provider: string,
	baseUrl: string
): unknown[] {
	const providerKey = normalizeProviderKey(provider);
	const normalizedTarget = normalizeBaseUrlForCompare(baseUrl);
	if (!providerKey || !normalizedTarget) {
		return current;
	}
	return current.map((item) => {
		if (!item || typeof item !== "object") {
			return item;
		}
		const record = item as Record<string, unknown>;
		const itemProvider = typeof record.provider === "string" ? normalizeProviderKey(record.provider) : "";
		if (itemProvider !== providerKey) {
			return item;
		}
		if (record.modelSource === "vscode-lm-wrapper") {
			return item;
		}
		return { ...record, baseUrl: baseUrl.trim() };
	});
}

export function mergeProviderEndpointsPreference(
	current: Record<string, string>,
	provider: string,
	profileId: string
): Record<string, string> {
	const key = normalizeProviderKey(provider);
	if (!key) {
		return { ...current };
	}
	const catalog = findProviderEndpointCatalog(provider);
	// Remove all alias keys first so there is always at most one canonical entry.
	const next: Record<string, string> = {};
	for (const [k, v] of Object.entries(current)) {
		const isAlias = catalog
			? catalog.providers.some((alias) => normalizeProviderKey(alias) === k)
			: k === key;
		if (!isAlias) {
			next[k] = v;
		}
	}
	if (profileId === CUSTOM_ENDPOINT_PROFILE_ID || !profileId.trim()) {
		return next;
	}
	if (!findEndpointProfileById(provider, profileId)) {
		return next;
	}
	next[key] = profileId;
	return next;
}
