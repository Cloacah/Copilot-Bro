import type { ModelConfig, ModelParameterHints } from "../types";
import { createModelFromFamily } from "./modelFamilyCatalog";
import { KIMI_MODEL_FAMILIES } from "./kimiModelFamilies";
import { QWEN_MODEL_FAMILIES } from "./qwenModelFamilies";
import { ZHIPU_MODEL_FAMILIES } from "./zhipuModelFamilies";

export const DEFAULT_CONTEXT_LENGTH = 128000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

const EDIT_TOOLS = ["apply-patch", "multi-find-replace", "find-replace"];

const COMMON_HINTS: ModelParameterHints = {
	temperature: { min: 0, max: 2, step: 0.1, recommended: 1 },
	topP: { min: 0, max: 1, step: 0.05, recommended: 1 },
	maxOutputTokens: { min: 1, max: 128000, step: 1024, recommended: 8192 },
	thinking: { options: ["enabled", "disabled"], recommended: "disabled" }
};

const DEEPSEEK_HINTS: ModelParameterHints = {
	...COMMON_HINTS,
	temperature: { min: 0, max: 2, step: 0.1, recommended: 1 },
	maxOutputTokens: { min: 1, max: 393216, step: 1024, recommended: 32768 },
	reasoningEffort: { options: ["high", "max"], recommended: "max" },
	thinking: { options: ["enabled", "disabled"], recommended: "enabled" }
};

const ZHIPU_REASONING_HINTS: ModelParameterHints = {
	...COMMON_HINTS,
	temperature: { min: 0, max: 2, step: 0.1, recommended: 0.6 },
	topP: { min: 0, max: 1, step: 0.05, recommended: 1 },
	maxOutputTokens: { min: 1, max: 128000, step: 1024, recommended: 8192 },
	thinking: { options: ["enabled", "disabled"], recommended: "enabled" }
};

const KIMI_K26_HINTS: ModelParameterHints = {
	...COMMON_HINTS,
	temperature: { min: 0.6, max: 1, step: 0.4, recommended: 1 },
	topP: { min: 0.95, max: 0.95, step: 0, recommended: 0.95 },
	maxOutputTokens: { min: 1, max: 32768, step: 1024, recommended: 8192 },
	thinking: { options: ["enabled", "disabled"], recommended: "enabled" }
};

const QWEN_HINTS: ModelParameterHints = {
	...COMMON_HINTS,
	temperature: { min: 0, max: 2, step: 0.1, recommended: 0.7 },
	topP: { min: 0, max: 1, step: 0.05, recommended: 0.8 },
	thinking: { options: ["enabled", "disabled"], recommended: "disabled" }
};

const MINIMAX_HINTS: ModelParameterHints = {
	...COMMON_HINTS,
	temperature: { min: 0.01, max: 1, step: 0.01, recommended: 1 },
	topP: { min: 0, max: 1, step: 0.05, recommended: 1 },
	maxOutputTokens: { min: 1, max: 128000, step: 1024, recommended: 8192 },
	thinking: { options: ["enabled", "disabled"], recommended: "enabled" }
};

interface ModelSeed {
	id: string;
	displayName?: string;
	category?: string;
	contextLength?: number;
	maxOutputTokens?: number;
	vision?: boolean;
	visionProxyModelId?: string | null;
	temperature?: number | null;
	topP?: number | null;
	reasoningEffort?: string;
	thinking?: "enabled" | "disabled";
	extraBody?: Record<string, unknown>;
	hints?: ModelParameterHints;
}

interface ProviderSeed {
	provider: string;
	providerDisplayName: string;
	baseUrl: string;
	documentationUrl: string;
	hints: ModelParameterHints;
	models: readonly ModelSeed[];
}

export const PROVIDER_CATALOG: readonly ProviderSeed[] = [
	{
		provider: "deepseek",
		providerDisplayName: "DeepSeek",
		baseUrl: "https://api.deepseek.com",
		documentationUrl: "https://api-docs.deepseek.com/zh-cn/",
		hints: DEEPSEEK_HINTS,
		models: [
			{ id: "deepseek-v4-pro", displayName: "DeepSeek v4 Pro", category: "Reasoning / Agent", contextLength: 1048576, maxOutputTokens: 32768, vision: false, temperature: 1, topP: 1, reasoningEffort: "max", thinking: "enabled", visionProxyModelId: "" },
			{ id: "deepseek-v4-flash", displayName: "DeepSeek v4 Flash", category: "Fast / General", contextLength: 1048576, maxOutputTokens: 32768, vision: false, temperature: 1, topP: 1, reasoningEffort: "max", thinking: "enabled", visionProxyModelId: "" }
		]
	},
	{
		provider: "zhipu",
		providerDisplayName: "Zhipu / Z.AI",
		baseUrl: "https://open.bigmodel.cn/api/paas/v4",
		documentationUrl: "https://docs.bigmodel.cn/cn/api/introduction",
		hints: {
			...ZHIPU_REASONING_HINTS
		},
		models: []
	},
	{
		provider: "minimax",
		providerDisplayName: "MiniMax",
		baseUrl: "https://api.minimax.io/v1",
		documentationUrl: "https://platform.minimax.io/docs/api-reference/text-openai-api",
		hints: MINIMAX_HINTS,
		models: [
			{ id: "MiniMax-M2.7", displayName: "MiniMax M2.7", category: "Agentic / Reasoning", contextLength: 204800, maxOutputTokens: 128000, temperature: 1, topP: 1, thinking: "enabled", extraBody: { reasoning_split: true } },
			{ id: "MiniMax-M2.7-highspeed", displayName: "MiniMax M2.7 Highspeed", category: "Fast Agentic / Reasoning", contextLength: 204800, maxOutputTokens: 128000, temperature: 1, topP: 1, thinking: "enabled", extraBody: { reasoning_split: true } },
			{ id: "MiniMax-M2.5", displayName: "MiniMax M2.5", category: "Coding / Reasoning", contextLength: 204800, maxOutputTokens: 128000, temperature: 1, topP: 1, thinking: "enabled", extraBody: { reasoning_split: true } },
			{ id: "MiniMax-M2.5-highspeed", displayName: "MiniMax M2.5 Highspeed", category: "Fast Coding / Reasoning", contextLength: 204800, maxOutputTokens: 128000, temperature: 1, topP: 1, thinking: "enabled", extraBody: { reasoning_split: true } },
			{ id: "MiniMax-M2.1", displayName: "MiniMax M2.1", category: "Legacy Agentic / Reasoning", contextLength: 204800, maxOutputTokens: 128000, temperature: 1, topP: 1, thinking: "enabled", extraBody: { reasoning_split: true } },
			{ id: "MiniMax-M2.1-highspeed", displayName: "MiniMax M2.1 Highspeed", category: "Legacy Fast Reasoning", contextLength: 204800, maxOutputTokens: 128000, temperature: 1, topP: 1, thinking: "enabled", extraBody: { reasoning_split: true } },
			{ id: "MiniMax-M2", displayName: "MiniMax M2", category: "Agentic / Function Calling", contextLength: 204800, maxOutputTokens: 128000, temperature: 1, topP: 1, thinking: "enabled", extraBody: { reasoning_split: true } }
		]
	},
	{
		provider: "kimi",
		providerDisplayName: "Kimi / Moonshot",
		baseUrl: "https://api.moonshot.ai/v1",
		documentationUrl: "https://platform.kimi.ai/docs/models",
		hints: KIMI_K26_HINTS,
		models: []
	},
	{
		provider: "qwen",
		providerDisplayName: "Qwen / DashScope",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		documentationUrl: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope",
		hints: QWEN_HINTS,
		models: []
	}
];

export const BUILT_IN_PRESETS: readonly ModelConfig[] = PROVIDER_CATALOG.flatMap((provider) => {
	if (provider.provider === "qwen") {
		return QWEN_MODEL_FAMILIES.map((family) => createModelFromFamily(provider, family));
	}
	if (provider.provider === "kimi") {
		return KIMI_MODEL_FAMILIES.map((family) => createModelFromFamily(provider, family));
	}
	if (provider.provider === "zhipu") {
		return ZHIPU_MODEL_FAMILIES.map((family) => createModelFromFamily(provider, family));
	}
	return provider.models.map((seed) => createModel(provider, seed));
});

function ids(category: string, modelIds: string[], contextLength: number, maxOutputTokens: number, extra: Partial<ModelSeed> = {}): ModelSeed[] {
	return modelIds.map((id) => ({ id, category, contextLength, maxOutputTokens, ...extra }));
}

function createModel(provider: ProviderSeed, seed: ModelSeed): ModelConfig {
	const hints = seed.hints ?? provider.hints;
	const thinkingType = seed.thinking ?? hints.thinking?.recommended;
	return {
		id: seed.id,
		displayName: seed.displayName ?? seed.id,
		provider: provider.provider,
		providerDisplayName: provider.providerDisplayName,
		category: seed.category,
		baseUrl: provider.baseUrl,
		family: "oai-compatible",
		contextLength: seed.contextLength ?? DEFAULT_CONTEXT_LENGTH,
		maxOutputTokens: seed.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
		vision: seed.vision ?? false,
		visionProxyModelId: seed.vision === true
			? (seed.visionProxyModelId ?? null)
			: seed.visionProxyModelId,
		toolCalling: true,
		temperature: seed.temperature ?? hints.temperature?.recommended,
		topP: seed.topP ?? hints.topP?.recommended,
		reasoningEffort: seed.reasoningEffort ?? hints.reasoningEffort?.recommended,
		thinking: thinkingType ? { type: thinkingType as "enabled" | "disabled" } : undefined,
		headers: {},
		extraBody: seed.extraBody ?? {},
		includeReasoningInRequest: false,
		editTools: EDIT_TOOLS,
		parameterHints: hints,
		documentationUrl: provider.documentationUrl,
		builtIn: true
	};
}
