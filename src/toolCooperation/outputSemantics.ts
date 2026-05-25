import type { ToolSelectionStrategy } from "./compatibilityMatrix";

export const strategyLabels: Record<ToolSelectionStrategy, { zh: string; en: string }> = {
	native: { zh: "原生视觉", en: "Native Vision" },
	proxy: { zh: "代理识图", en: "Proxy Vision" },
	"wrapper-proxy": { zh: "包装代理", en: "Wrapper Proxy" },
	"text-fallback": { zh: "文本降级", en: "Text Fallback" },
	"plan-only": { zh: "仅计划", en: "Plan Only" },
	disabled: { zh: "已禁用", en: "Disabled" }
};

export const errorMessages = {
	visionProxyUnavailable: "[Image omitted: no vision proxy model is available.]",
	visionProxyFailed: "[Image omitted: vision proxy failed to describe it.]",
	visionProxyEmpty: "[Image omitted: vision proxy returned an empty description.]"
} as const;

export const statusMessages = {
	visionPrefix: "[Vision]"
} as const;

export interface VisionInputBindingSummary {
	sourceKind: string;
	imageHash?: string;
	evidenceId?: string;
	route?: ToolSelectionStrategy;
	toolName?: string;
	proxyModelId?: string;
	rawImageForwarded?: boolean;
	reused?: boolean;
}

const CHAT_DEBUG_MARKERS = new Set(["[text-fallback]", "[plan-only]", "[disabled]"]);

const VISION_ROUTE_LABELS = new Set<ToolSelectionStrategy>([
	"native",
	"proxy",
	"wrapper-proxy",
	"text-fallback",
	"plan-only",
	"disabled"
]);

export function createVisionPreprocessSummary(stats: {
	processedCount: number;
	integrityPassCount: number;
	integrityFailCount: number;
	fallbackToOriginalCount: number;
	warningsCount: number;
}): string | undefined {
	const {
		processedCount,
		integrityPassCount,
		integrityFailCount,
		fallbackToOriginalCount,
		warningsCount
	} = stats;
	if (processedCount <= 0) {
		return undefined;
	}
	if (
		integrityPassCount === processedCount
		&& integrityFailCount === 0
		&& fallbackToOriginalCount === 0
		&& warningsCount === 0
	) {
		return undefined;
	}
	const parts = [
		`${statusMessages.visionPrefix} preprocess`,
		`images=${processedCount}`
	];
	if (integrityPassCount !== processedCount || integrityFailCount > 0) {
		parts.push(`integrity=${integrityPassCount}/${processedCount}`);
	}
	if (fallbackToOriginalCount > 0) {
		parts.push(`fallback=${fallbackToOriginalCount}`);
	}
	if (warningsCount > 0) {
		parts.push(`warnings=${warningsCount}`);
	}
	return parts.join(" · ");
}

export function createVisionDetailsText(text: string): string {
	const parts = text
		.trim()
		.split(" · ")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (parts.length === 0) {
		return statusMessages.visionPrefix;
	}
	const [headline, ...details] = parts;
	if (details.length === 0) {
		return headline;
	}
	return [headline, ...details.map((detail, index) => formatVisionDetailLine(detail, index))].join("\n");
}

export function createChatDebugDetailsText(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) {
		return "";
	}
	if (trimmed.startsWith(statusMessages.visionPrefix)) {
		return createVisionDetailsText(trimmed);
	}
	if (trimmed.startsWith("```[Vision ")) {
		return unfoldVisionFence(trimmed);
	}
	const lines = trimmed
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) {
		return "";
	}
	const [headline, ...details] = lines;
	if (!CHAT_DEBUG_MARKERS.has(headline)) {
		return trimmed;
	}
	return [headline, ...details.map((detail) => formatChatDebugDetailLine(detail))].join("\n");
}

export function createChatDebugSummary(text: string): string {
	const normalized = createChatDebugDetailsText(text);
	const firstLine = normalized.split(/\r?\n/, 1)[0]?.trim();
	return firstLine || "Debug Output";
}

export function createPlanOnlyContent(reason: string, goal: string): string {
	return [
		"[plan-only]",
		`reason=${reason}`,
		`goal=${goal}`,
		"steps=1) identify the missing visual evidence 2) request or reconstruct the required visual facts 3) continue with a text-only safe path"
	].join("\n");
}

export function createTextFallbackContent(reason: string): string {
	return [
		"[text-fallback]",
		`reason=${reason}`,
		"action=Proceed with the best text-only explanation and call out the missing visual evidence explicitly."
	].join("\n");
}

export function createDisabledVisionContent(reason: string): string {
	return [
		"[disabled]",
		`reason=${reason}`,
		"action=Vision handling is unavailable for the current compatibility configuration. Enable a compatible route or continue without image analysis."
	].join("\n");
}

export function createVisionBatchHeader(batchId: string, sessionId: string): string {
	return `[vision-batch:${batchId}] session=${sessionId}`;
}

function escapeVisionThinkingHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/`/g, "&#96;");
}

export function formatVisionStructuredThinkingBlock(
	snapshotJson: string,
	meta: {
		contract: string;
		elementCount: number;
		reused?: boolean;
		sourceKind?: string;
		toolName?: string;
		route?: "proxy" | "native";
	}
): string {
	const trimmed = snapshotJson.trim();
	const routeLabel = meta.route === "native" ? "native" : "proxy";
	const headline = meta.reused
		? `${statusMessages.visionPrefix} structured evidence · cache reuse`
		: `${statusMessages.visionPrefix} structured evidence · ${routeLabel} · ${meta.contract}`;
	const context = [
		meta.sourceKind ? `source=${meta.sourceKind}` : "",
		meta.toolName ? `tool=${meta.toolName}` : "",
		`elements=${meta.elementCount}`
	].filter((part) => part.length > 0).join(" · ");
	const safeJson = escapeVisionThinkingHtml(trimmed.slice(0, 6000));
	const body = trimmed.length > 0
		? [
			'<details data-extended-models-vision-structured="true">',
			`<summary>${routeLabel} snapshot · ${meta.elementCount} element(s)</summary>`,
			`<pre>${safeJson}</pre>`,
			"</details>"
		].join("\n")
		: "_structured snapshot unavailable_";
	return [headline, context, body].filter((line) => line.length > 0).join("\n");
}

export function isVisionStructuredThinkingText(text: string): boolean {
	return text.includes("data-extended-models-vision-structured");
}

/** Collapsible vision progress block used when Chat has no LanguageModelThinkingPart API. */
export function isVisionProgressDetailsText(text: string): boolean {
	return text.includes("data-extended-models-vision=\"true\"");
}

export function renderVisionThinkingDetails(text: string): string {
	const displayText = isVisionStructuredThinkingText(text) ? text.trim() : createVisionDetailsText(text);
	const summary = createVisionProgressSummary(displayText);
	return [
		`<details data-extended-models-vision="true">`,
		`<summary>识图进度 · ${escapeVisionProgressHtml(summary)}</summary>`,
		"",
		displayText,
		"</details>",
		""
	].join("\n");
}

function createVisionProgressSummary(displayText: string): string {
	const firstLine = displayText.split(/\r?\n/, 1)[0]?.trim() ?? "";
	if (firstLine.startsWith(statusMessages.visionPrefix)) {
		return firstLine.slice(statusMessages.visionPrefix.length).trim() || "vision";
	}
	if (firstLine.includes("Proxy snapshot")) {
		return "structured snapshot";
	}
	return firstLine.slice(0, 80) || "vision";
}

function escapeVisionProgressHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function createVisionInputBindingSummary(summary: VisionInputBindingSummary): string {
	const parts = [
		`${statusMessages.visionPrefix} input`,
		`source=${compactSummaryValue(summary.sourceKind) || "unknown"}`
	];
	const toolName = compactSummaryValue(summary.toolName);
	if (toolName) {
		parts.push(`tool=${toolName}`);
	}
	const imageHash = compactHash(summary.imageHash);
	if (imageHash) {
		parts.push(`image=${imageHash}`);
	}
	const evidenceId = compactSummaryValue(summary.evidenceId);
	if (evidenceId) {
		parts.push(`evidence=${evidenceId}`);
	}
	if (summary.route) {
		parts.push(`route=${summary.route}`);
	}
	const proxyModelId = compactSummaryValue(summary.proxyModelId);
	if (proxyModelId) {
		parts.push(`proxy=${proxyModelId}`);
	}
	if (typeof summary.reused === "boolean") {
		parts.push(`reused=${summary.reused ? "true" : "false"}`);
	}
	if (typeof summary.rawImageForwarded === "boolean") {
		parts.push(`rawImageForwarded=${summary.rawImageForwarded ? "true" : "false"}`);
	}
	return parts.join(" · ");
}

export function formatVisionStatusText(
	stage: "start" | "end" | "failed",
	strategy: ToolSelectionStrategy,
	reason: string,
	trace: { requestId: string; sessionId?: string; batchId?: string; batchIndex?: number },
	config: { includeSessionId: boolean; includeBatchId: boolean }
): string {
	const parts = [
		`${statusMessages.visionPrefix} ${stage}`,
		strategy,
		`req=${compactVisionTraceId(trace.requestId)}`
	];
	if (config.includeSessionId && trace.sessionId) {
		parts.push(`session=${trace.sessionId}`);
	}
	if (config.includeBatchId && trace.batchId) {
		parts.push(typeof trace.batchIndex === "number"
			? `batch=${trace.batchId}#${trace.batchIndex}`
			: `batch=${trace.batchId}`);
	}
	parts.push(reason);
	return parts.join(" · ");
}

function compactVisionTraceId(value: string): string {
	return /^[0-9a-f]{8}-/i.test(value) ? value.slice(0, 8) : value;
}

function compactHash(value: string | undefined): string {
	const normalized = compactSummaryValue(value);
	return normalized.length > 16 ? normalized.slice(0, 16) : normalized;
}

function compactSummaryValue(value: string | undefined): string {
	return (typeof value === "string" ? value : "").trim().replace(/\s+/g, "-");
}

function formatVisionDetailLine(detail: string, index: number): string {
	if (VISION_ROUTE_LABELS.has(detail as ToolSelectionStrategy)) {
		return `route: ${detail}`;
	}
	const equalsIndex = detail.indexOf("=");
	if (equalsIndex >= 0) {
		const key = detail.slice(0, equalsIndex).trim();
		const value = detail.slice(equalsIndex + 1).trim();
		return `${mapVisionDetailKey(key)}: ${value}`;
	}
	return `${index === 0 ? "route" : "reason"}: ${detail}`;
}

function unfoldVisionFence(text: string): string {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) {
		return "";
	}
	const opening = lines[0] ?? "";
	const headerMatch = /^```(\[[^\]]+\])\s*(.*)$/.exec(opening);
	const headline = [headerMatch?.[1], headerMatch?.[2]].filter((part): part is string => Boolean(part && part.trim())).join(" ").trim() || "[Vision Debug]";
	const closingIndex = lines.at(-1) === "```" ? lines.length - 1 : lines.length;
	const details = lines.slice(1, closingIndex).map((line) => formatChatDebugDetailLine(line));
	return [headline, ...details].join("\n");
}

function formatChatDebugDetailLine(detail: string): string {
	const equalsIndex = detail.indexOf("=");
	if (equalsIndex < 0) {
		return detail;
	}
	const key = detail.slice(0, equalsIndex).trim();
	const value = detail.slice(equalsIndex + 1).trim();
	return `${key}: ${value}`;
}

function mapVisionDetailKey(key: string): string {
	switch (key) {
		case "req":
			return "request";
		case "session":
			return "session";
		case "batch":
			return "batch";
		case "images":
			return "images";
		case "integrity":
			return "integrity";
		case "fallback":
			return "fallback";
		case "warnings":
			return "warnings";
		default:
			return key;
	}
}