import * as vscode from "vscode";
import { getRuntimeModelId } from "./config/modelIdentity";
import {
	isCopilotAutoVisionModelId,
	resolveExtensionVisionProxyTarget
} from "./visionProxyModelSelection";
import type { ExtensionSettings, ModelConfig } from "./types";
import { Logger } from "./logger";

export async function resolveVisionProxyChatModelForRequestedId(
	requestedId: string,
	model: ModelConfig,
	settings: ExtensionSettings,
	logger: Logger,
	selfIds: ReadonlySet<string>
): Promise<vscode.LanguageModelChat | undefined> {
	const trimmed = requestedId.trim();
	if (!trimmed || selfIds.has(trimmed)) {
		return undefined;
	}
	const extensionTarget = resolveExtensionVisionProxyTarget(trimmed, settings.models, selfIds);
	if (extensionTarget?.kind === "extended") {
		const extensionMatches = await vscode.lm.selectChatModels({
			vendor: "extendedModels",
			id: extensionTarget.runtimeId
		});
		const extensionMatch = extensionMatches.find((candidate) => candidate.id === extensionTarget.runtimeId);
		if (extensionMatch) {
			logger.info("vision.proxy.selected", {
				modelId: extensionMatch.id,
				configuredId: trimmed,
				selection: "extension-configured",
				vendor: extensionMatch.vendor
			});
			return extensionMatch;
		}
		logger.warn("vision.proxy.extensionModelUnavailable", {
			requestedId: trimmed,
			runtimeId: extensionTarget.runtimeId,
			model: model.id
		});
	}
	const selected = await vscode.lm.selectChatModels({ id: trimmed });
	const match = selected.find((candidate) => !selfIds.has(candidate.id)
		&& candidate.vendor !== "extendedModels"
		&& !isCopilotAutoVisionModelId(candidate.id, candidate.vendor));
	if (match) {
		logger.info("vision.proxy.selected", {
			modelId: match.id,
			configuredId: trimmed,
			selection: "configured"
		});
		return match;
	}
	logger.warn("vision.proxy.configuredModelUnavailable", { requestedId: trimmed, model: model.id });
	return undefined;
}

export async function resolveVisionProxyChatModelAuto(
	model: ModelConfig,
	logger: Logger,
	selfIds: ReadonlySet<string>
): Promise<vscode.LanguageModelChat | undefined> {
	const allModels = await vscode.lm.selectChatModels();
	logger.debug("vision.proxy.candidates", {
		model: model.id,
		total: allModels.length,
		nonSelf: allModels.filter((candidate) => !selfIds.has(candidate.id)).length
	});
	if (allModels.length === 0) {
		logger.warn("vision.proxy.noModelsAvailable", { model: model.id });
		return undefined;
	}
	const explicitVisionModel = allModels.find((candidate) => !selfIds.has(candidate.id)
		&& candidate.vendor !== "extendedModels"
		&& Boolean((candidate as { capabilities?: { imageInput?: boolean } }).capabilities?.imageInput)
		&& !isCopilotAutoVisionModelId(candidate.id, candidate.vendor));
	if (explicitVisionModel) {
		logger.info("vision.proxy.auto-selected", { modelId: explicitVisionModel.id });
		return explicitVisionModel;
	}
	const genericCopilotModel = allModels.find((candidate) => !selfIds.has(candidate.id)
		&& candidate.vendor !== "extendedModels"
		&& !isCopilotAutoVisionModelId(candidate.id, candidate.vendor));
	if (genericCopilotModel) {
		logger.info("vision.proxy.fallback-selected", { modelId: genericCopilotModel.id });
		return genericCopilotModel;
	}
	logger.warn("vision.proxy.noSuitableModel", { model: model.id });
	return undefined;
}
