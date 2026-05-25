/**
 * Host UI smoke config panel result: shared types + JSON coercion for webview → extension messages.
 * Keeps {@link ../e2e/driver/hostUiSmoke} log parsing and {@link ./configPanel} handlers aligned.
 */

export type HostUiSmokeModelState = {
	displayName: string;
	temperature: string;
};

export type HostUiSmokeProviderEndpointUiResult = {
	rowVisible: boolean;
	profileId: string;
	baseUrlBefore: string;
	baseUrlAfter: string;
	persistedProfileId?: string;
	savedViaSaveButton?: boolean;
	savedViaProfileChange?: boolean;
};

export type HostUiSmokeModelVersionUiResult = {
	rowVisible: boolean;
	familyKey: string;
	versionBefore: string;
	versionAfter: string;
	customVersionId: string;
	customAdded: boolean;
	customRemoved: boolean;
};

export type HostUiSmokeQwenCatalogUiResult = {
	familyVisible: boolean;
	familyKey: string;
	versionCount: number;
	defaultVersionId: string;
};

export type HostUiSmokeConfigResult = {
	ok: boolean;
	initial: HostUiSmokeModelState;
	afterSave: HostUiSmokeModelState;
	proState: HostUiSmokeModelState;
	roundtrip: HostUiSmokeModelState;
	restored: HostUiSmokeModelState;
	providerEndpointUi?: HostUiSmokeProviderEndpointUiResult;
	modelVersionUi?: HostUiSmokeModelVersionUiResult;
	qwenCatalogUi?: HostUiSmokeQwenCatalogUiResult;
	error?: string;
};

export function emptyHostUiSmokeModelState(): HostUiSmokeModelState {
	return {
		displayName: "",
		temperature: ""
	};
}

export function parseHostUiSmokeModelState(value: unknown): HostUiSmokeModelState {
	if (!value || typeof value !== "object") {
		return emptyHostUiSmokeModelState();
	}
	const record = value as Record<string, unknown>;
	return {
		displayName: typeof record.displayName === "string" ? record.displayName : "",
		temperature: typeof record.temperature === "string" ? record.temperature : ""
	};
}

export function parseHostUiSmokeQwenCatalogUi(value: unknown): HostUiSmokeQwenCatalogUiResult | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	return {
		familyVisible: record.familyVisible === true,
		familyKey: typeof record.familyKey === "string" ? record.familyKey : "",
		versionCount: typeof record.versionCount === "number" ? record.versionCount : 0,
		defaultVersionId: typeof record.defaultVersionId === "string" ? record.defaultVersionId : ""
	};
}

export function parseHostUiSmokeModelVersionUi(value: unknown): HostUiSmokeModelVersionUiResult | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	return {
		rowVisible: record.rowVisible === true,
		familyKey: typeof record.familyKey === "string" ? record.familyKey : "",
		versionBefore: typeof record.versionBefore === "string" ? record.versionBefore : "",
		versionAfter: typeof record.versionAfter === "string" ? record.versionAfter : "",
		customVersionId: typeof record.customVersionId === "string" ? record.customVersionId : "",
		customAdded: record.customAdded === true,
		customRemoved: record.customRemoved === true
	};
}

export function parseHostUiSmokeProviderEndpointUi(value: unknown): HostUiSmokeProviderEndpointUiResult | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	return {
		rowVisible: record.rowVisible === true,
		profileId: typeof record.profileId === "string" ? record.profileId : "",
		baseUrlBefore: typeof record.baseUrlBefore === "string" ? record.baseUrlBefore : "",
		baseUrlAfter: typeof record.baseUrlAfter === "string" ? record.baseUrlAfter : "",
		persistedProfileId: typeof record.persistedProfileId === "string" ? record.persistedProfileId : undefined,
		savedViaSaveButton: record.savedViaSaveButton === true,
		savedViaProfileChange: record.savedViaProfileChange === true
	};
}

/** Normalizes webview `hostUiSmokeResult` payload (may be partial or hostile). */
export function parseHostUiSmokeConfigResult(value: unknown): HostUiSmokeConfigResult {
	if (!value || typeof value !== "object") {
		return {
			ok: false,
			initial: emptyHostUiSmokeModelState(),
			afterSave: emptyHostUiSmokeModelState(),
			proState: emptyHostUiSmokeModelState(),
			roundtrip: emptyHostUiSmokeModelState(),
			restored: emptyHostUiSmokeModelState(),
			error: "Host UI smoke config result was empty."
		};
	}
	const record = value as Record<string, unknown>;
	return {
		ok: record.ok === true,
		initial: parseHostUiSmokeModelState(record.initial),
		afterSave: parseHostUiSmokeModelState(record.afterSave),
		proState: parseHostUiSmokeModelState(record.proState),
		roundtrip: parseHostUiSmokeModelState(record.roundtrip),
		restored: parseHostUiSmokeModelState(record.restored),
		providerEndpointUi: parseHostUiSmokeProviderEndpointUi(record.providerEndpointUi),
		modelVersionUi: parseHostUiSmokeModelVersionUi(record.modelVersionUi),
		qwenCatalogUi: parseHostUiSmokeQwenCatalogUi(record.qwenCatalogUi),
		error: typeof record.error === "string" ? record.error : undefined
	};
}
