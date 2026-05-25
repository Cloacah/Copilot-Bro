import {
	CUSTOM_ENDPOINT_PROFILE_ID,
	findProviderEndpointCatalog,
	listProviderEndpointProfiles,
	normalizeBaseUrlForCompare,
	normalizeProviderKey,
	resolveEndpointProfileId,
	type ProviderEndpointProfile
} from "../config/providerEndpoints";

export type ProviderEndpointCatalogClientEntry = {
	readonly providers: readonly string[];
	readonly defaultProfileId: string;
	readonly profiles: readonly { id: string; baseUrl: string; labels: { zh: string; en: string } }[];
};

export function findClientCatalogEntry(
	catalog: readonly ProviderEndpointCatalogClientEntry[],
	provider: string
): ProviderEndpointCatalogClientEntry | undefined {
	const key = normalizeProviderKey(provider);
	return catalog.find((entry) => entry.providers.some((alias) => normalizeProviderKey(alias) === key));
}

export function listClientProfiles(
	catalog: readonly ProviderEndpointCatalogClientEntry[],
	provider: string
): readonly ProviderEndpointProfile[] {
	return listProviderEndpointProfiles(provider);
}

export function resolveClientEndpointProfileId(
	catalog: readonly ProviderEndpointCatalogClientEntry[],
	provider: string,
	baseUrl: string | undefined,
	storedProfileId?: string
): string {
	return resolveEndpointProfileId(provider, baseUrl, storedProfileId);
}

export function renderProviderEndpointProfileSelect(options: {
	catalog: readonly ProviderEndpointCatalogClientEntry[];
	provider: string;
	selectedProfileId: string;
	baseUrl: string;
	language: "zh" | "en";
	customLabel: { zh: string; en: string };
	selectTip: string;
}): string {
	const entry = findClientCatalogEntry(options.catalog, options.provider);
	if (!entry) {
		return "";
	}
	const profiles = listProviderEndpointProfiles(options.provider);
	const selected = options.selectedProfileId || CUSTOM_ENDPOINT_PROFILE_ID;
	const customText = options.language === "en" ? options.customLabel.en : options.customLabel.zh;
	const optionsHtml = [
		...profiles.map((profile) => {
			const label = options.language === "en" ? profile.labels.en : profile.labels.zh;
			const selectedAttr = profile.id === selected ? " selected" : "";
			return `<option value="${escapeAttr(profile.id)}"${selectedAttr}>${escapeHtml(label)}</option>`;
		}),
		`<option value="${escapeAttr(CUSTOM_ENDPOINT_PROFILE_ID)}"${selected === CUSTOM_ENDPOINT_PROFILE_ID ? " selected" : ""}>${escapeHtml(customText)}</option>`
	].join("");
	return [
		`<label for="providerEndpointProfile" title="${escapeHtml(options.selectTip)}">`,
		options.language === "en" ? "Endpoint" : "接入区域",
		`</label>`,
		`<select id="providerEndpointProfile" title="${escapeHtml(options.selectTip)}">${optionsHtml}</select>`
	].join("\n");
}

export function profileIdForBaseUrlInput(
	provider: string,
	baseUrl: string,
	storedProfileId?: string
): string {
	return resolveEndpointProfileId(provider, baseUrl, storedProfileId);
}

export function baseUrlForProfileSelection(provider: string, profileId: string): string | undefined {
	const catalog = findProviderEndpointCatalog(provider);
	if (!catalog || profileId === CUSTOM_ENDPOINT_PROFILE_ID) {
		return undefined;
	}
	return catalog.profiles.find((profile) => profile.id === profileId)?.baseUrl;
}

export function isKnownProfileBaseUrl(provider: string, baseUrl: string): boolean {
	const normalized = normalizeBaseUrlForCompare(baseUrl);
	return listProviderEndpointProfiles(provider).some((profile) =>
		normalizeBaseUrlForCompare(profile.baseUrl) === normalized);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
	return escapeHtml(value);
}
