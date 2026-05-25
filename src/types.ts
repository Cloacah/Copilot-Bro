export type LogLevel = "off" | "error" | "warn" | "info" | "debug";

export interface RetrySettings {
	enabled: boolean;
	maxAttempts: number;
	baseDelayMs: number;
	statusCodes: number[];
}

export interface ThinkingSettings {
	type?: "enabled" | "disabled";
	keep?: "all";
}

export interface NumberParameterHint {
	min: number;
	max: number;
	step: number;
	recommended: number;
}

export interface SelectParameterHint {
	options: string[];
	recommended: string;
}

export interface ModelParameterHints {
	temperature?: NumberParameterHint;
	topP?: NumberParameterHint;
	maxOutputTokens?: NumberParameterHint;
	reasoningEffort?: SelectParameterHint;
	thinking?: SelectParameterHint;
}

export type ModelSource = "remote" | "vscode-lm-wrapper";

export interface ModelConfig {
	id: string;
	displayName?: string;
	/** Stable picker identity within a provider; API model id is in `id`. */
	modelFamilyKey?: string;
	configId?: string;
	provider: string;
	providerDisplayName?: string;
	category?: string;
	baseUrl?: string;
	family?: string;
	contextLength: number;
	maxOutputTokens: number;
	maxCompletionTokens?: number;
	vision: boolean;
	visionProxyModelId?: string | null;
	toolCalling: boolean;
	temperature?: number | null;
	topP?: number | null;
	reasoningEffort?: string;
	thinking?: ThinkingSettings;
	headers: Record<string, string>;
	extraBody: Record<string, unknown>;
	includeReasoningInRequest: boolean;
	editTools: string[];
	parameterHints?: ModelParameterHints;
	documentationUrl?: string;
	modelSource?: ModelSource;
	wrappedLanguageModelId?: string;
	wrappedLanguageModelVendor?: string;
	wrappedLanguageModelFamily?: string;
	builtIn?: boolean;
}

export interface VisionProxySettings {
	enabled: boolean;
	defaultModelId: string;
	customPrompt: string;
}

export type ConfigWriteScope = "workspace" | "global";

export interface PromptPresetSettings {
	selectedId: string;
}

export type VisionAgentAutoClosePolicy = "afterMainTask" | "afterTimeout" | "never";

export interface VisionAgentConfig {
	enabled: boolean;
	keepAliveMs: number;
	maxBatchSize: number;
	maxConcurrentBatches: number;
	resetContextPerBatch: boolean;
	deduplicateImages: boolean;
	dedupeByHash: boolean;
	retryOnFailure: boolean;
	autoClosePolicy: VisionAgentAutoClosePolicy;
}

export type VisionRoiMode = "full" | "roi-split" | "smart";
export type VisionDetailPriority = "balanced" | "high" | "low";

export interface VisionIntegrityConfig {
	enabled: boolean;
	strictIntegrity: boolean;
	certaintyThreshold: number;
	checkCount: boolean;
	checkDimensions: boolean;
	checkDigest: boolean;
	trackResize: boolean;
	trackByteSummary: boolean;
	roiMode: VisionRoiMode;
	tileMaxPixels: number;
	detailPriority: VisionDetailPriority;
}

export type VisionOutputVerbosity = "conservative" | "balanced" | "verbose";
export type SvgDecisionPolicy = "auto" | "always" | "never";
export type RasterPolicy = "auto" | "segment" | "skip";

export interface VisionProcessingConfig {
	svgOptimize: boolean;
	imagePreprocess: boolean;
	mlSegment: boolean;
	outputVerbosity: VisionOutputVerbosity;
	chatDebugVisibility: boolean;
	tokenBudgetMode: VisionOutputVerbosity;
	needVisionGate: boolean;
	svgDecisionPolicy: SvgDecisionPolicy;
	rasterPolicy: RasterPolicy;
	spatialSchemaVersion: string;
	highFidelityPrompt: string;
	/** When false (default), proxy SVG mode must not emit bbox-only placeholder SVG. */
	allowBBoxPlaceholderSvg?: boolean;
	/** When true (default), raster buffers are traced to SVG via imagetracerjs before SVGO/path fit. */
	rasterVectorize?: boolean;
	/** Max long edge (px) before raster vectorization; reduces path count and vision retry cost. */
	maxVectorizeEdgePx?: number;
}


export interface RequestAttributionConfig {
	enabled: boolean;
	includeSessionId: boolean;
	includeBatchId: boolean;
}

export interface ExtensionSettings {
	includeBuiltInPresets: boolean;
	/** @deprecated Provider-owned URLs only; always empty at runtime. */
	defaultBaseUrl: string;
	/** Workspace preference: provider key → catalog profile id (multi-region gateways). */
	providerEndpoints: Record<string, string>;
	/** Custom base URL per provider when endpoint profile is "custom". */
	providerCustomBaseUrls: Record<string, string>;
	/** Custom API model ids per family (`provider::familyKey` → version ids). */
	modelFamilyCustomVersions: Record<string, string[]>;
	models: ModelConfig[];
	visionProxy: VisionProxySettings;
	promptPresets: PromptPresetSettings;
	retry: RetrySettings;
	requestTimeoutMs: number;
	logLevel: LogLevel;
	uiLanguage: "zh" | "en";
	configWriteScope: ConfigWriteScope;
	visionAgent: VisionAgentConfig;
	visionIntegrity: VisionIntegrityConfig;
	visionProcessing: VisionProcessingConfig;
	requestAttribution: RequestAttributionConfig;
}

export interface ProviderErrorDetails {
	status?: number;
	code?: string;
	body?: string;
	url?: string;
	retryable?: boolean;
}

export interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | OpenAIContentPart[] | null;
	name?: string;
	tool_call_id?: string;
	tool_calls?: OpenAIToolCall[];
	reasoning_content?: string;
}

export type OpenAIContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } };

export interface OpenAIToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface OpenAIToolDefinition {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters: unknown;
	};
}

export interface ChatCompletionRequestBody {
	model: string;
	messages: OpenAIMessage[];
	stream: true;
	stream_options?: { include_usage: boolean };
	tools?: OpenAIToolDefinition[];
	tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } };
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	max_completion_tokens?: number;
	reasoning_effort?: string;
	thinking?: ThinkingSettings;
	[key: string]: unknown;
}

export interface ChatCompletionUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_cache_hit_tokens?: number;
	prompt_cache_miss_tokens?: number;
	prompt_tokens_details?: {
		cached_tokens?: number;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export type StreamEvent =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string; id?: string }
	| { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
	| { type: "usage"; usage: ChatCompletionUsage }
	| { type: "finish"; reason: string };
