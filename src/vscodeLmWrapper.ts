import * as vscode from "vscode";
import { isWrappedLanguageModelConfig } from "./config/modelIdentity";
import type { Logger } from "./logger";
import { estimateTokens } from "./openaiCompat/messages";
import { resolveSelectedPromptPresetContent } from "./promptPresets";
import type { ExtensionSettings, ModelConfig } from "./types";
import { buildWrapperInstructionText, createWrappedLanguageModelConfig } from "./vscodeLmWrapperShared";

type WrappedLanguageModelCandidate = vscode.LanguageModelChat & {
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly capabilities?: {
		imageInput?: boolean;
		toolCalling?: boolean;
	};
};

let cachedWrappedLanguageModelConfigs: ModelConfig[] = [];
let wrappedLanguageModelRefreshPromise: Promise<ModelConfig[]> | undefined;

export interface WrappedLanguageModelRequest {
	messages: vscode.LanguageModelChatMessage[];
	estimatedPromptTokens: number;
}

export function getCachedWrappedLanguageModelConfigs(): ModelConfig[] {
	return [...cachedWrappedLanguageModelConfigs];
}

export function clearWrappedLanguageModelConfigCache(): void {
	cachedWrappedLanguageModelConfigs = [];
}

const SELECT_CHAT_MODELS_TIMEOUT_MS = 10_000;

export async function refreshWrappedLanguageModelConfigs(logger?: Logger): Promise<ModelConfig[]> {
	if (wrappedLanguageModelRefreshPromise) {
		return wrappedLanguageModelRefreshPromise;
	}

	wrappedLanguageModelRefreshPromise = (async () => {
		try {
			const timedOut = Symbol("timeout");
			const candidatesResult = await Promise.race([
				vscode.lm.selectChatModels(),
				new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), SELECT_CHAT_MODELS_TIMEOUT_MS))
			]);
			if (candidatesResult === timedOut) {
				logger?.warn("wrapper.models.cache.refresh.timeout", { timeoutMs: SELECT_CHAT_MODELS_TIMEOUT_MS });
				return getCachedWrappedLanguageModelConfigs();
			}
			const candidates = candidatesResult;
			cachedWrappedLanguageModelConfigs = collectWrappedLanguageModelConfigs(candidates);
			logger?.info("wrapper.models.cache.refreshed", {
				rawCount: candidates.length,
				rawVendors: [...new Set(candidates.map((c) => c.vendor))],
				filteredCount: cachedWrappedLanguageModelConfigs.length
			});
			return getCachedWrappedLanguageModelConfigs();
		} catch (error) {
			logger?.warn("wrapper.models.cache.refresh.failed", {
				message: error instanceof Error ? error.message : String(error)
			});
			return getCachedWrappedLanguageModelConfigs();
		} finally {
			wrappedLanguageModelRefreshPromise = undefined;
		}
	})();

	return wrappedLanguageModelRefreshPromise;
}

export async function resolveWrappedLanguageModel(model: ModelConfig, logger?: Logger): Promise<vscode.LanguageModelChat | undefined> {
	if (!isWrappedLanguageModelConfig(model)) {
		return undefined;
	}

	try {
		const requestedId = model.wrappedLanguageModelId?.trim();
		if (!requestedId) {
			return undefined;
		}
		const requestedVendor = model.wrappedLanguageModelVendor?.trim().toLowerCase();
		const matches = await vscode.lm.selectChatModels({ id: requestedId });
		const match = matches.find((candidate) => {
			if (candidate.vendor === "extendedModels") {
				return false;
			}
			if (!requestedVendor) {
				return true;
			}
			return candidate.vendor.trim().toLowerCase() === requestedVendor;
		});
		if (!match) {
			logger?.warn("wrapper.model.unavailable", {
				requestedId,
				requestedVendor
			});
		}
		return match;
	} catch (error) {
		logger?.warn("wrapper.model.lookup.failed", {
			requestedId: model.wrappedLanguageModelId,
			message: error instanceof Error ? error.message : String(error)
		});
		return undefined;
	}
}

export async function buildWrappedLanguageModelRequest(
	context: vscode.ExtensionContext,
	settings: ExtensionSettings,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	visionContract?: string
): Promise<WrappedLanguageModelRequest> {
	const preface = await buildWrapperInstructionPreface(context, settings);
	const requestMessages: vscode.LanguageModelChatMessage[] = [];
	let estimatedPromptTokens = 0;

	if (preface) {
		requestMessages.push(vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(preface)]));
		estimatedPromptTokens += estimateTokens(preface);
	}

	if (visionContract) {
		requestMessages.push(vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(visionContract)]));
		estimatedPromptTokens += estimateTokens(visionContract);
	}

	for (const message of messages) {
		requestMessages.push(buildCompatibleWrappedChatMessage(message));
		estimatedPromptTokens += estimateTokens(message);
	}

	return {
		messages: requestMessages,
		estimatedPromptTokens
	};
}

async function buildWrapperInstructionPreface(
	context: vscode.ExtensionContext,
	settings: ExtensionSettings
): Promise<string | undefined> {
	const presetContent = await resolveSelectedPromptPresetContent(context, settings);
	return buildWrapperInstructionText(presetContent);
}

function collectWrappedLanguageModelConfigs(candidates: readonly vscode.LanguageModelChat[]): ModelConfig[] {
	const out = new Map<string, ModelConfig>();
	for (const candidate of candidates) {
		if (candidate.vendor === "extendedModels") {
			continue;
		}
		const wrapped = createWrappedLanguageModelConfig(candidate as WrappedLanguageModelCandidate);
		if (wrapped) {
			out.set(`${wrapped.wrappedLanguageModelVendor ?? wrapped.provider}::${wrapped.wrappedLanguageModelId}`, wrapped);
		}
	}
	return Array.from(out.values());
}

function buildCompatibleWrappedChatMessage(message: vscode.LanguageModelChatRequestMessage): vscode.LanguageModelChatMessage {
	const normalizedRole = String(message.role).trim().toLowerCase();
	const safeRole = normalizedRole === "assistant" || normalizedRole === "tool" || normalizedRole === "user"
		? message.role
		: vscode.LanguageModelChatMessageRole.User;
	// Map system/unknown roles to user role to avoid languageModelSystem proposed API requirement.
	return new vscode.LanguageModelChatMessage(
		safeRole,
		[...message.content] as vscode.LanguageModelInputPart[],
		message.name
	);
}