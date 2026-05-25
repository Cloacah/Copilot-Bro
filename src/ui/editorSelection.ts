import { getRuntimeModelId } from "../config/modelIdentity";
import type { ModelConfig } from "../types";

export interface ConfigPanelSelection {
	provider: string;
	modelRuntimeId: string;
}

export function resolveInitialEditorSelection(storedSelection: unknown, models: readonly ModelConfig[]): ConfigPanelSelection {
	const stored = normalizeEditorSelection(storedSelection);
	if (stored?.modelRuntimeId) {
		const match = models.find((model) => getRuntimeModelId(model) === stored.modelRuntimeId);
		if (match) {
			return {
				provider: match.provider,
				modelRuntimeId: getRuntimeModelId(match)
			};
		}
	}

	if (stored?.provider) {
		const providerMatch = models.find((model) => model.provider === stored.provider);
		if (providerMatch) {
			return {
				provider: providerMatch.provider,
				modelRuntimeId: getRuntimeModelId(providerMatch)
			};
		}
	}

	const fallback = models[0];
	return {
		provider: fallback?.provider ?? "",
		modelRuntimeId: fallback ? getRuntimeModelId(fallback) : ""
	};
}

export function normalizeEditorSelection(value: unknown): ConfigPanelSelection | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const provider = typeof record.provider === "string" ? record.provider.trim() : "";
	const modelRuntimeId = typeof record.modelRuntimeId === "string" ? record.modelRuntimeId.trim() : "";
	if (!provider && !modelRuntimeId) {
		return undefined;
	}
	return { provider, modelRuntimeId };
}

export function selectionFromModel(value: unknown): ConfigPanelSelection | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const model = value as Partial<ModelConfig>;
	if (!model.id || !model.provider) {
		return undefined;
	}
	return {
		provider: model.provider,
		modelRuntimeId: getRuntimeModelId(model as Pick<ModelConfig, "id" | "configId" | "provider">)
	};
}