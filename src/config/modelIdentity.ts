import type { ModelConfig } from "../types";

type RuntimeModelIdentity = Pick<ModelConfig, "id" | "configId" | "provider"> & Partial<Pick<ModelConfig, "modelFamilyKey" | "modelSource" | "wrappedLanguageModelId" | "wrappedLanguageModelVendor">>;

export function isWrappedLanguageModelConfig(model: Partial<Pick<ModelConfig, "modelSource" | "wrappedLanguageModelId">> | undefined): boolean {
	return model?.modelSource === "vscode-lm-wrapper"
		&& typeof model.wrappedLanguageModelId === "string"
		&& model.wrappedLanguageModelId.trim().length > 0;
}

export function getRuntimeModelId(model: RuntimeModelIdentity): string {
	const wrappedLanguageModelId = model.wrappedLanguageModelId?.trim();
	if (model.modelSource === "vscode-lm-wrapper" && wrappedLanguageModelId) {
		const vendor = model.wrappedLanguageModelVendor?.trim().toLowerCase() || model.provider.trim().toLowerCase() || "vscode-lm";
		return `vscode-lm::${vendor}::${wrappedLanguageModelId}`;
	}

	const familyKey = model.modelFamilyKey?.trim();
	if (familyKey && !familyKey.startsWith("id:")) {
		return `${familyKey}::${model.provider.trim().toLowerCase()}`;
	}

	if (model.configId?.trim()) {
		return `${model.id}::${model.configId.trim()}`;
	}

	return `${model.id}::${model.provider.trim().toLowerCase()}`;
}