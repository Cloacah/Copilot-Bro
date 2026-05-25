import { getRuntimeModelId } from "./config/modelIdentity";
import type { ModelConfig } from "./types";

export type VisionProxySelectionTarget =
	| { kind: "extended"; runtimeId: string; modelId: string }
	| { kind: "vscode"; id: string };

export function matchesVisionProxyRequestedId(model: ModelConfig, requestedId: string): boolean {
	const normalized = requestedId.trim();
	if (!normalized) {
		return false;
	}
	const runtimeId = getRuntimeModelId(model);
	if (runtimeId === normalized || model.id === normalized) {
		return true;
	}
	const bareId = normalized.split("::")[0]?.trim();
	if (bareId && (model.id === bareId || runtimeId.startsWith(`${bareId}::`))) {
		return true;
	}
	return false;
}

/**
 * Resolves a configured vision-proxy id to an extension-owned vision model when possible.
 * Copilot Bro global/per-model proxy settings reference {@link getRuntimeModelId} values
 * (e.g. `qwen3.5-flash::qwen`), which must not be dropped in favour of Copilot built-ins.
 */
export function resolveExtensionVisionProxyTarget(
	requestedId: string,
	models: readonly ModelConfig[],
	selfIds: ReadonlySet<string>
): VisionProxySelectionTarget | undefined {
	const normalized = requestedId.trim();
	if (!normalized) {
		return undefined;
	}
	const visionModels = models.filter((model) => model.vision === true);
	for (const model of visionModels) {
		if (!matchesVisionProxyRequestedId(model, normalized)) {
			continue;
		}
		const runtimeId = getRuntimeModelId(model);
		if (selfIds.has(runtimeId) || selfIds.has(model.id)) {
			continue;
		}
		return { kind: "extended", runtimeId, modelId: model.id };
	}
	return undefined;
}

export function isCopilotAutoVisionModelId(modelId: string, vendor: string): boolean {
	const id = modelId.trim().toLowerCase();
	const v = vendor.trim().toLowerCase();
	if (!id.includes("auto")) {
		return false;
	}
	return v === "copilot" || v === "copilot-cli" || v === "github.copilot";
}
