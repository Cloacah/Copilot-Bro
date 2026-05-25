import { getRuntimeModelId } from "./config/modelIdentity";
import type { ExtensionSettings, ModelConfig } from "./types";

const MODEL_VISION_PROXY_DISABLED = "__vision_proxy_disabled__";

export interface VisionProxyPolicy {
	enabled: boolean;
	required: boolean;
	requestedModelId?: string;
	reason: "explicit-disabled" | "self-disabled" | "model-configured" | "global-configured" | "global-auto" | "native-default";
}

export function resolveVisionProxyPolicy(
	model: ModelConfig,
	settings: Pick<ExtensionSettings, "visionProxy">
): VisionProxyPolicy {
	const configured = normalizeRequestedVisionProxyId(model.visionProxyModelId);
	if (configured.kind === "disabled") {
		return { enabled: false, required: false, reason: "explicit-disabled" };
	}

	const normalizedDefault: { kind: "disabled" } | { kind: "target"; value?: string } = settings.visionProxy.enabled
		? normalizeRequestedVisionProxyId(settings.visionProxy.defaultModelId)
		: { kind: "target" };
	const defaultModelId = normalizedDefault.kind === "target" ? normalizedDefault.value : undefined;
	const requestedModelId = configured.value ?? defaultModelId;
	if (requestedModelId && getModelSelfIds(model).has(requestedModelId)) {
		return { enabled: false, required: false, requestedModelId, reason: "self-disabled" };
	}
	if (configured.value) {
		return { enabled: true, required: true, requestedModelId, reason: "model-configured" };
	}
	if (defaultModelId) {
		return { enabled: true, required: true, requestedModelId, reason: "global-configured" };
	}
	if (!model.vision && model.visionProxyModelId !== null && settings.visionProxy.enabled) {
		return { enabled: true, required: true, reason: "global-auto" };
	}
	return { enabled: false, required: false, reason: "native-default" };
}

function normalizeRequestedVisionProxyId(value: unknown): { kind: "disabled" } | { kind: "target"; value?: string } {
	if (value === null) {
		return { kind: "disabled" };
	}
	if (typeof value !== "string") {
		return { kind: "target" };
	}
	const normalized = value.trim();
	if (!normalized) {
		return { kind: "target" };
	}
	if (
		normalized.toLowerCase() === "auto"
		|| normalized.toLowerCase() === "null"
		|| normalized === MODEL_VISION_PROXY_DISABLED
	) {
		return { kind: "disabled" };
	}
	return { kind: "target", value: normalized };
}

function getModelSelfIds(model: ModelConfig): Set<string> {
	return new Set([model.id, getRuntimeModelId(model)]);
}
