import { getRuntimeModelId } from "./config/modelIdentity";
import { resolveEffectiveModelVisionProxySelection } from "./config/modelVisionProxy";
import type { ExtensionSettings, ModelConfig } from "./types";

export interface VisionProxyPolicy {
	enabled: boolean;
	required: boolean;
	requestedModelId?: string;
	reason:
		| "explicit-disabled"
		| "self-disabled"
		| "model-configured"
		| "model-custom-list"
		| "model-auto"
		| "global-configured"
		| "global-custom-list"
		| "global-auto"
		| "native-default";
}

export function resolveVisionProxyPolicy(
	model: ModelConfig,
	settings: Pick<ExtensionSettings, "visionProxy">
): VisionProxyPolicy {
	const effective = resolveEffectiveModelVisionProxySelection(model, settings);
	if (!effective.enabled) {
		if (effective.scope === "disabled") {
			return { enabled: false, required: false, reason: "explicit-disabled" };
		}
		return { enabled: false, required: false, reason: "native-default" };
	}

	const selfIds = getModelSelfIds(model);
	if (effective.selectionMode === "fixed") {
		const id = effective.fixedModelId.trim();
		if (!id) {
			if (effective.source === "inherit" && !model.vision && settings.visionProxy.enabled) {
				return { enabled: true, required: true, reason: "global-auto" };
			}
			return {
				enabled: false,
				required: false,
				reason: effective.source === "model"
					? "model-configured"
					: model.vision
						? "native-default"
						: "global-configured"
			};
		}
		if (selfIds.has(id)) {
			return { enabled: false, required: false, requestedModelId: id, reason: "self-disabled" };
		}
		return {
			enabled: true,
			required: true,
			requestedModelId: id,
			reason: effective.source === "model" ? "model-configured" : "global-configured"
		};
	}

	if (effective.selectionMode === "custom-list") {
		if (!effective.customModelIds.length) {
			return {
				enabled: false,
				required: false,
				reason: effective.source === "model" ? "model-custom-list" : "global-custom-list"
			};
		}
		return {
			enabled: true,
			required: true,
			reason: effective.source === "model" ? "model-custom-list" : "global-custom-list"
		};
	}

	if (!model.vision) {
		return {
			enabled: true,
			required: true,
			reason: effective.source === "model" ? "model-auto" : "global-auto"
		};
	}

	return { enabled: false, required: false, reason: "native-default" };
}

function getModelSelfIds(model: ModelConfig): Set<string> {
	return new Set([model.id, getRuntimeModelId(model)]);
}
