import * as vscode from "vscode";
import { getRuntimeModelId } from "./config/modelIdentity";
import { resolveEffectiveModelVisionProxySelection } from "./config/modelVisionProxy";
import { resolveVisionProxyPolicy } from "./visionProxyPolicy";
import type { ExtensionSettings, ModelConfig } from "./types";
import { Logger } from "./logger";
import type { VisionProxyCandidate } from "./visionProxyRetryCoordinator";
import { resolveVisionProxyChatModelAuto, resolveVisionProxyChatModelForRequestedId } from "./visionProxySelection";

export async function resolveVisionProxyCandidateChain(
	model: ModelConfig,
	settings: ExtensionSettings,
	logger: Logger
): Promise<readonly VisionProxyCandidate[]> {
	const proxyPolicy = resolveVisionProxyPolicy(model, settings);
	if (!proxyPolicy.enabled) {
		return [];
	}

	const effective = resolveEffectiveModelVisionProxySelection(model, settings);
	const selfIds = new Set([model.id, getRuntimeModelId(model)]);
	const mode = effective.selectionMode;

	if (mode === "fixed") {
		const id = (effective.fixedModelId.trim() || proxyPolicy.requestedModelId || "").trim();
		if (!id || selfIds.has(id)) {
			return [];
		}
		const chatModel = await resolveVisionProxyChatModelForRequestedId(id, model, settings, logger, selfIds);
		logger.info("vision.proxy.chain.resolved", {
			selectionMode: "fixed",
			scope: effective.scope,
			count: chatModel ? 1 : 0,
			firstConfiguredId: chatModel ? id : ""
		});
		return chatModel ? [{ chatModel, configuredId: id }] : [];
	}

	if (mode === "custom-list") {
		const chain: VisionProxyCandidate[] = [];
		for (const configuredId of effective.customModelIds) {
			if (!configuredId.trim() || selfIds.has(configuredId)) {
				logger.info("vision.proxy.candidate.skip", {
					modelId: configuredId,
					reason: selfIds.has(configuredId) ? "self-model" : "empty-id"
				});
				continue;
			}
			const chatModel = await resolveVisionProxyChatModelForRequestedId(
				configuredId,
				model,
				settings,
				logger,
				selfIds
			);
			if (chatModel) {
				chain.push({ chatModel, configuredId });
			} else {
				logger.warn("vision.proxy.candidate.skip", {
					modelId: configuredId,
					reason: "unavailable"
				});
			}
		}
		logger.info("vision.proxy.chain.resolved", {
			selectionMode: "custom-list",
			scope: effective.scope,
			count: chain.length,
			firstConfiguredId: chain[0]?.configuredId ?? ""
		});
		return chain;
	}

	const chatModel = await resolveVisionProxyChatModelAuto(model, logger, selfIds);
	if (!chatModel) {
		return [];
	}
	logger.info("vision.proxy.chain.resolved", {
		selectionMode: "auto",
		scope: effective.scope,
		count: 1,
		firstConfiguredId: chatModel.id
	});
	return [{ chatModel, configuredId: chatModel.id }];
}
