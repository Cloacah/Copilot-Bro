import type { ProvideLanguageModelChatResponseOptions } from "vscode";
import type { ChatCompletionRequestBody, ModelConfig, OpenAIMessage, OpenAIToolDefinition } from "../types";

export function buildRequestBody(
	model: ModelConfig,
	messages: OpenAIMessage[],
	options: ProvideLanguageModelChatResponseOptions,
	toolChoice?: "required" | string
): ChatCompletionRequestBody {
	const tools = convertTools(options.tools ?? []);
	const body: ChatCompletionRequestBody = {
		model: model.id,
		messages,
		stream: true,
		stream_options: { include_usage: true }
	};

	if (model.temperature !== undefined && model.temperature !== null) {
		body.temperature = model.temperature;
	}
	if (model.topP !== undefined && model.topP !== null) {
		body.top_p = model.topP;
	}
	if (model.maxCompletionTokens !== undefined) {
		body.max_completion_tokens = model.maxCompletionTokens;
	} else {
		body.max_tokens = model.maxOutputTokens;
	}
	if (model.reasoningEffort) {
		body.reasoning_effort = model.reasoningEffort;
	}
	if (shouldSendThinking(model)) {
		body.thinking = buildThinkingPayload(model);
	}

	if (tools.length > 0 && model.toolCalling) {
		body.tools = tools;
		const supportsRequiredToolChoice = model.provider !== "kimi";
		body.tool_choice = toolChoice && supportsRequiredToolChoice
			? toolChoice === "required"
				? "required"
				: { type: "function", function: { name: toolChoice } }
			: "auto";
	}

	for (const [key, value] of Object.entries(model.extraBody)) {
		if (value !== undefined) {
			body[key] = value;
		}
	}

	return body;
}

export function buildHeaders(
	apiKey: string,
	model: ModelConfig,
	extraHeaders: Record<string, string> = {}
): Record<string, string> {
	return {
		"Authorization": `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		"Accept": "text/event-stream",
		"User-Agent": "copilot-bro/0.1.4",
		...extraHeaders,
		...model.headers
	};
}

function shouldSendThinking(model: ModelConfig): boolean {
	if (!model.thinking?.type) {
		return false;
	}
	const provider = model.provider.trim().toLowerCase();
	const baseUrl = model.baseUrl?.toLowerCase() ?? "";
	return provider.includes("deepseek")
		|| provider.includes("kimi")
		|| provider.includes("moonshot")
		|| provider.includes("zhipu")
		|| provider.includes("glm")
		|| provider.includes("minimax")
		|| baseUrl.includes("deepseek")
		|| baseUrl.includes("moonshot")
		|| baseUrl.includes("bigmodel")
		|| baseUrl.includes("minimax");
}

function isKimiModel(model: ModelConfig): boolean {
	const provider = model.provider.trim().toLowerCase();
	const baseUrl = model.baseUrl?.toLowerCase() ?? "";
	return provider.includes("kimi") || provider.includes("moonshot") || baseUrl.includes("moonshot");
}

/** Moonshot v1 rejects `thinking.keep`; multimodal K2.5/K2.6 support it for reasoning replay. */
export function kimiSupportsThinkingKeep(model: ModelConfig): boolean {
	const id = model.id.trim().toLowerCase();
	if (/moonshot-v1|moonshot-v1-/i.test(id)) {
		return false;
	}
	return id === "kimi-k2.5" || id === "kimi-k2.6";
}

function buildThinkingPayload(model: ModelConfig): { type: "enabled" | "disabled"; keep?: "all" } {
	const type = model.thinking?.type;
	if (type !== "enabled" && type !== "disabled") {
		return { type: "disabled" };
	}
	if (isKimiModel(model) && type === "enabled" && kimiSupportsThinkingKeep(model)) {
		return { type: "enabled", keep: "all" };
	}
	return { type };
}

function convertTools(tools: readonly unknown[]): OpenAIToolDefinition[] {
	return tools
		.filter((tool): tool is { name: string; description?: string; inputSchema?: unknown } => {
			return Boolean(tool)
				&& typeof tool === "object"
				&& typeof (tool as Record<string, unknown>).name === "string";
		})
		.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema ?? {
					type: "object",
					properties: {}
				}
			}
		}));
}
