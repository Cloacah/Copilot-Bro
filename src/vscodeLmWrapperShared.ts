import type { ModelConfig } from "./types";

export interface WrappedLanguageModelDescriptor {
	id: string;
	vendor?: string;
	name?: string;
	family?: string;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	capabilities?: {
		imageInput?: boolean;
		toolCalling?: boolean;
	};
}

export function createWrappedLanguageModelConfig(candidate: WrappedLanguageModelDescriptor): ModelConfig | undefined {
	if (!candidate.id.trim()) {
		return undefined;
	}

	const sourceVendor = candidate.vendor?.trim() || "vscode-lm";
	const sourceLabel = getWrappedSourceLabel(sourceVendor);
	const inferredVision = inferWrappedVisionCapability(candidate);
	return {
		id: candidate.id,
		displayName: `${candidate.name ?? candidate.id} (Wrapped · ${sourceLabel})`,
		provider: "copilot",
		providerDisplayName: "copilot",
		category: `Built-in Wrapper · ${sourceLabel}`,
		family: candidate.family?.trim() || "builtin-wrapper",
		contextLength: Math.max(1024, candidate.maxInputTokens ?? 128000),
		maxOutputTokens: Math.max(1, candidate.maxOutputTokens ?? 8192),
		temperature: 1,
		topP: 1,
		thinking: { type: "enabled" },
		reasoningEffort: "high",
		vision: inferredVision,
		visionProxyModelId: undefined,
		toolCalling: candidate.capabilities?.toolCalling ?? true,
		headers: {},
		extraBody: {},
		includeReasoningInRequest: false,
		editTools: [],
		parameterHints: {
			temperature: { min: 0, max: 2, step: 0.1, recommended: 1 },
			topP: { min: 0, max: 1, step: 0.05, recommended: 1 },
			maxOutputTokens: {
				min: 1,
				max: Math.max(1, candidate.maxOutputTokens ?? 8192),
				step: 1024,
				recommended: Math.max(1, candidate.maxOutputTokens ?? 8192)
			},
			thinking: { options: ["enabled", "disabled"], recommended: "enabled" },
			reasoningEffort: { options: ["low", "medium", "high", "max"], recommended: "high" }
		},
		modelSource: "vscode-lm-wrapper",
		wrappedLanguageModelId: candidate.id,
		wrappedLanguageModelVendor: sourceVendor,
		wrappedLanguageModelFamily: candidate.family?.trim() || undefined,
		builtIn: false
	};
}

function inferWrappedVisionCapability(candidate: WrappedLanguageModelDescriptor): boolean {
	const normalizedId = candidate.id.trim().toLowerCase();
	const heuristicVision = Boolean(normalizedId) && (
		normalizedId.includes("auto")
		|| normalizedId.includes("gpt-4")
		|| normalizedId.includes("gpt-5")
		|| normalizedId.includes("o1")
		|| normalizedId.includes("o3")
		|| normalizedId.includes("claude")
		|| normalizedId.includes("gemini")
	);
	if (candidate.capabilities?.imageInput === true) {
		return true;
	}
	if (candidate.capabilities?.imageInput === false) {
		return heuristicVision;
	}
	return heuristicVision;
}

function getWrappedSourceLabel(vendor: string): string {
	const normalized = vendor.trim().toLowerCase();
	if (normalized === "copilot" || normalized === "github.copilot") {
		return "copilot";
	}
	if (normalized === "copilot-cli") {
		return "copilot-cli";
	}
	return vendor.trim() || "vscode-lm";
}

export function buildWrapperInstructionText(
	presetContent?: string
): string | undefined {
	const sections: string[] = [];
	if (presetContent?.trim()) {
		sections.push(presetContent.trim());
	}

	if (sections.length === 0) {
		return undefined;
	}

	return [
		"Apply the following Copilot Bro instructions before answering the rest of this conversation.",
		...sections
	].join("\n\n");
}