import { createHash, randomUUID } from "node:crypto";
import { isWrappedLanguageModelConfig } from "./config/modelIdentity";
import type { ExtensionSettings, ModelConfig, OpenAIMessage, RequestAttributionConfig } from "./types";
import { formatVisionStatusText } from "./toolCooperation/outputSemantics";
import type { ModelCapabilities, ToolSelection } from "./toolCooperation/toolSelector";
import { resolveVisionProxyPolicy } from "./visionProxyPolicy";

export interface RequestTraceContext {
	requestId: string;
	sessionId?: string;
	batchId?: string;
	batchIndex?: number;
}

export function buildModelCapabilities(
	model: ModelConfig,
	settings: Pick<ExtensionSettings, "visionProxy">
): ModelCapabilities {
	const proxyPolicy = resolveVisionProxyPolicy(model, settings);
	const wrapped = isWrappedLanguageModelConfig(model);
	return {
		modelType: wrapped ? "builtin" : "bro",
		nativeVision: model.vision,
		proxyVision: proxyPolicy.enabled,
		proxyRequired: proxyPolicy.required,
		wrapperProxyAvailable: wrapped && proxyPolicy.enabled,
		textFallback: true,
		planOnly: true,
		toolCalling: model.toolCalling
	};
}

export function createRequestTrace(
	_config: RequestAttributionConfig,
	overrides: Partial<RequestTraceContext> = {}
): RequestTraceContext {
	const requestId = normalizeString(overrides.requestId) ?? randomUUID();
	const sessionId = normalizeString(overrides.sessionId);
	const batchId = normalizeString(overrides.batchId);
	const batchIndex = overrides.batchIndex;
	return {
		requestId,
		sessionId,
		batchId,
		batchIndex
	};
}

export function buildAttributionHeaders(
	config: RequestAttributionConfig,
	trace: RequestTraceContext
): Record<string, string> {
	if (!config.enabled) {
		return {};
	}
	const headers: Record<string, string> = {
		"X-Extended-Models-Request-Id": trace.requestId
	};
	if (config.includeSessionId && trace.sessionId) {
		headers["X-Extended-Models-Session-Id"] = trace.sessionId;
	}
	if (config.includeBatchId && trace.batchId) {
		headers["X-Extended-Models-Batch-Id"] = trace.batchId;
		if (typeof trace.batchIndex === "number") {
			headers["X-Extended-Models-Batch-Index"] = String(trace.batchIndex);
		}
	}
	return headers;
}

export function formatVisionStatus(
	stage: "start" | "end" | "failed",
	selection: Pick<ToolSelection, "strategy" | "reason">,
	trace: RequestTraceContext,
	config: Pick<RequestAttributionConfig, "includeSessionId" | "includeBatchId">
): string {
	return formatVisionStatusText(stage, selection.strategy, selection.reason, trace, config);
}

export function collectImageRefs(messages: readonly OpenAIMessage[]): string[] {
	const refs: string[] = [];
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const part of message.content) {
			if (part.type !== "image_url") {
				continue;
			}
			const url = part.image_url.url.trim();
			if (!url) {
				continue;
			}
			const hash = createHash("sha256").update(url).digest("hex");
			refs.push(`${url}|hash:${hash}`);
		}
	}
	return refs;
}

function normalizeString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}