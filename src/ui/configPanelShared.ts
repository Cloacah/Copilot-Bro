import { getVisiblePhase1Sections, type Phase1ConfigSectionKey, type UiLocaleText } from "./phase1ConfigUi";

type Phase1VisibleSection = ReturnType<typeof getVisiblePhase1Sections>[number];
type Phase1VisibleField = Phase1VisibleSection["fields"][number];

export function resolveConfigPanelLanguage(value: unknown): "zh" | "en" {
	return value === "en" ? "en" : "zh";
}

export function renderPhase1Field(
	sectionKey: Phase1ConfigSectionKey,
	field: Phase1VisibleField,
	value: unknown,
	language: "zh" | "en"
): string {
	const inputId = getPhase1FieldInputId(sectionKey, field.key);
	const label = escapeHtml(localizePhase1Text(field.label, language));
	const tip = escapeHtml(localizePhase1Text(field.tip, language));
	if (field.kind === "boolean") {
		return `<div><label class="check" title="${tip}"><input id="${escapeHtml(inputId)}" type="checkbox" title="${tip}" ${value === true ? "checked" : ""}> ${label}</label></div>`;
	}
	if (field.kind === "select") {
		const selected = typeof value === "string" ? value : "";
		const options = (field.options ?? []).map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
		return `<div><label for="${escapeHtml(inputId)}" title="${tip}">${label}</label><select id="${escapeHtml(inputId)}" title="${tip}">${options}</select></div>`;
	}
	if (field.kind === "number") {
		const currentValue = typeof value === "number" && Number.isFinite(value) ? String(value) : "";
		const minimum = "minimum" in field && field.minimum !== undefined ? ` min="${field.minimum}"` : "";
		const maximum = "maximum" in field && field.maximum !== undefined ? ` max="${field.maximum}"` : "";
		const step = "step" in field && field.step !== undefined ? ` step="${field.step}"` : "";
		return `<div><label for="${escapeHtml(inputId)}" title="${tip}">${label}</label><input id="${escapeHtml(inputId)}" type="number" title="${tip}" value="${escapeHtml(currentValue)}"${minimum}${maximum}${step}></div>`;
	}
	const currentValue = typeof value === "string" ? value : "";
	const multiline = "multiline" in field && field.multiline === true;
	return multiline
		? `<div><label for="${escapeHtml(inputId)}" title="${tip}">${label}</label><textarea id="${escapeHtml(inputId)}" title="${tip}">${escapeHtml(currentValue)}</textarea></div>`
		: `<div><label for="${escapeHtml(inputId)}" title="${tip}">${label}</label><input id="${escapeHtml(inputId)}" title="${tip}" value="${escapeHtml(currentValue)}"></div>`;
}

export function renderProviderOptions(
	providerNames: readonly unknown[],
	keyedProviders: readonly unknown[],
	initialProvider: unknown,
	providerOptionTip: unknown
): string {
	const keyed = new Set(keyedProviders.map((provider) => normalizeString(provider)));
	const selected = normalizeString(initialProvider);
	return providerNames.map((provider) => {
		const normalizedProvider = normalizeString(provider);
		return `<option value="${escapeHtml(normalizedProvider)}" title="${escapeHtml(providerOptionTip)}" ${normalizedProvider === selected ? "selected" : ""}>${escapeHtml(`${keyed.has(normalizedProvider) ? "✓ " : ""}${normalizedProvider}`)}</option>`;
	}).join("");
}

function localizePhase1Text(value: UiLocaleText | undefined, language: "zh" | "en"): string {
	return language === "en" ? value?.en ?? "" : value?.zh ?? "";
}

function getPhase1FieldInputId(sectionKey: Phase1ConfigSectionKey, fieldKey: string): string {
	return `phase1-${sectionKey}-${fieldKey}`;
}

function escapeHtml(value: unknown): string {
	return normalizeString(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value : String(value ?? "");
}