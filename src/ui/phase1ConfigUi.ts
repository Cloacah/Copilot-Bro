import type {
	ExtensionSettings,
	RequestAttributionConfig,
	VisionAgentConfig,
	VisionIntegrityConfig,
	VisionProcessingConfig
} from "../types";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";

export type Phase1ConfigSectionKey = "visionAgent" | "visionIntegrity" | "visionProcessing" | "requestAttribution";
export type Phase1FieldKind = "boolean" | "string" | "number" | "select";
export type UiLocaleText = { zh: string; en: string };
export type Phase1FieldMode = "visible" | "compatibility";

export interface Phase1FieldSpec<FieldKey extends string> {
	key: FieldKey;
	kind: Phase1FieldKind;
	label: UiLocaleText;
	tip: UiLocaleText;
	options?: readonly string[];
	minimum?: number;
	maximum?: number;
	step?: number;
	multiline?: boolean;
	mode?: Phase1FieldMode;
	hiddenReason?: UiLocaleText;
}

type SectionSettings<SectionKey extends Phase1ConfigSectionKey> = ExtensionSettings[SectionKey];

export interface Phase1SectionSpec<SectionKey extends Phase1ConfigSectionKey> {
	key: SectionKey;
	title: UiLocaleText;
	help: UiLocaleText;
	fields: readonly Phase1FieldSpec<Extract<keyof SectionSettings<SectionKey>, string>>[];
}

export type AnyPhase1SectionSpec = typeof PHASE1_CONFIG_SECTIONS[number];
export type AnyPhase1FieldSpec = AnyPhase1SectionSpec["fields"][number];

/** Hidden from Phase 1 UI while {@link HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED} is true; settings keys remain in schema. */
const VISION_PROCESSING_UI_HIDDEN_WHEN_RESTORE_PIPELINE_SUSPENDED = new Set<string>([
	"svgOptimize",
	"imagePreprocess",
	"mlSegment",
	"svgDecisionPolicy",
	"rasterPolicy",
	"allowBBoxPlaceholderSvg",
	"rasterVectorize"
]);

const compatibilityAliasReason: UiLocaleText = {
	zh: "兼容旧字段读取，避免与规范字段重复展示。",
	en: "Compatibility-only alias used for legacy reads; hidden to avoid duplicating the canonical field."
};

export const PHASE1_CONFIG_SECTIONS = [
	
	{
		key: "visionAgent",
		title: {
			zh: "识图会话调度策略",
			en: "Vision Session Orchestration"
		},
		help: {
			zh: "这组配置用于会话内识图调度（批处理、去重、重试与关闭策略）。它不代表宿主可长期驻留；仅控制当前会话链路中的调度行为。",
			en: "These settings control in-session vision orchestration (batching, dedupe, retries, and close policy). They do not imply persistent host residency."
		},
		fields: [
			{
				key: "enabled",
				kind: "boolean",
				label: { zh: "启用识图会话调度", en: "Enable Vision Session Orchestration" },
				tip: { zh: "开启后，识图任务在当前会话中按批次与去重策略协调执行；关闭后退回更简单的代理流程。", en: "When enabled, vision tasks in the current session follow batching and dedupe orchestration; when disabled, routing falls back to the simpler proxy flow." }
			},
			{
				key: "keepAliveMs",
				kind: "number",
				minimum: 0,
				maximum: 600000,
				step: 1000,
				label: { zh: "调度窗口毫秒数", en: "Scheduling Window (ms)" },
				tip: { zh: "控制会话内调度状态维持时长，不等同宿主进程常驻。0 表示不保留额外调度窗口。", en: "Controls in-session scheduling state duration, not host-process residency. 0 means no extra scheduling window." }
			},
			{
				key: "maxBatchSize",
				kind: "number",
				minimum: 1,
				maximum: 20,
				step: 1,
				label: { zh: "最大批大小", en: "Max Batch Size" },
				tip: { zh: "单批次最多处理多少张图。数值越大吞吐可能更高，但单次失败影响面也更大。", en: "Maximum images per batch. Larger values may improve throughput but increase blast radius on failures." }
			},
			{
				key: "maxConcurrentBatches",
				kind: "number",
				minimum: 1,
				maximum: 20,
				step: 1,
				label: { zh: "最大并发批次", en: "Max Concurrent Batches" },
				tip: { zh: "同一时刻允许并行执行多少个批次。提高并发可加速处理，但会增加瞬时资源占用。", en: "How many batches can run in parallel. Higher concurrency speeds up processing but increases resource spikes." }
			},
			{
				key: "resetContextPerBatch",
				kind: "boolean",
				label: { zh: "每批重置上下文", en: "Reset Context Per Batch" },
				tip: { zh: "开启时每批次都从干净上下文开始，隔离性更好；关闭时可继承上下文，适合强关联多批任务。", en: "When on, each batch starts clean for stronger isolation; when off, context can carry over across batches." }
			},
			{
				key: "deduplicateImages",
				kind: "boolean",
				label: { zh: "去重图片", en: "Deduplicate Images" },
				tip: { zh: "自动跳过同一批次中的重复图片，减少无效识图成本。", en: "Skip duplicate images within a run to reduce redundant cost." }
			},
			{
				key: "dedupeByHash",
				kind: "boolean",
				mode: "compatibility",
				label: { zh: "旧字段 dedupeByHash", en: "Legacy dedupeByHash Alias" },
				tip: { zh: "旧版别名，由 deduplicateImages 兼容读取。", en: "Legacy alias read compatibly through deduplicateImages." },
				hiddenReason: compatibilityAliasReason
			},
			{
				key: "retryOnFailure",
				kind: "boolean",
				label: { zh: "失败时重试（会话批次）", en: "Retry On Failure (session batches)" },
				tip: {
					zh: "仅影响识图代理会话批次编排（agentSession/retryStrategy）；不作用于 Copilot Chat 直连 LM，也不替代「请求重试」里的 HTTP/格式重试。",
					en: "Applies only to vision agent session batch orchestration (agentSession/retryStrategy), not direct Copilot Chat LM calls or the global Request Retry HTTP/format loops."
				}
			},
			{
				key: "autoClosePolicy",
				kind: "select",
				options: ["afterMainTask", "afterTimeout", "never"],
				label: { zh: "自动关闭策略", en: "Auto Close Policy" },
				tip: { zh: "afterMainTask: 主任务后结束调度；afterTimeout: 超时后结束调度；never: 不自动结束会话调度（仅会话语义）。", en: "afterMainTask ends orchestration after the main task, afterTimeout ends it on timeout, and never keeps orchestration open (session semantics only)." }
			}
		]
	} satisfies Phase1SectionSpec<"visionAgent">,
	{
		key: "visionIntegrity",
		title: {
			zh: "识图完整性校验",
			en: "Vision Integrity Checks"
		},
		help: {
			zh: "用于保证识图输入在处理链路中没有被意外篡改或错配。建议保持开启：它会校验数量、尺寸、摘要并记录关键转换痕迹，便于排障和审计。",
			en: "Protects image integrity across the processing chain by validating counts, dimensions, digests, and transform traces."
		},
		fields: [
			{ key: "enabled", kind: "boolean", label: { zh: "启用完整性校验", en: "Enable Integrity Checks" }, tip: { zh: "总开关。建议保持开启，关闭后将无法发现输入被替换、错序或尺寸异常等问题。", en: "Master switch. Keep enabled to catch substitutions, ordering mistakes, and size anomalies." } },
			{ key: "strictIntegrity", kind: "boolean", label: { zh: "严格完整性", en: "Strict Integrity" }, tip: { zh: "启用后，完整性检查失败会阻断下游处理并返回仅计划回退。", en: "When enabled, integrity check failures block downstream and return plan-only fallback." } },
			{ key: "certaintyThreshold", kind: "number", minimum: 0, maximum: 1, step: 0.1, label: { zh: "置信度阈值", en: "Certainty Threshold" }, tip: { zh: "ROI 置信度阈值，用于破坏性操作的门控。", en: "ROI confidence threshold for destructive-operation gating." } },
			{ key: "checkCount", kind: "boolean", label: { zh: "校验图片数量", en: "Check Image Count" }, tip: { zh: "确保处理前后图片数量一致，防止漏图或重复图。", en: "Ensures image count consistency before/after processing." } },
			{ key: "checkDimensions", kind: "boolean", label: { zh: "校验图片尺寸", en: "Check Dimensions" }, tip: { zh: "检测宽高是否异常变化，避免尺寸错误影响模型判断。", en: "Detects unexpected width/height changes that can harm model judgments." } },
			{ key: "checkDigest", kind: "boolean", label: { zh: "校验摘要", en: "Check Digest" }, tip: { zh: "通过摘要/哈希确认图像内容身份，防止内容被意外替换。", en: "Uses digest/hash identity checks to detect accidental content replacement." } },
			{ key: "trackResize", kind: "boolean", label: { zh: "跟踪缩放", en: "Track Resize" }, tip: { zh: "记录缩放动作和结果，便于复盘为何识图结果变化。", en: "Records resize operations to explain output differences." } },
			{ key: "trackByteSummary", kind: "boolean", label: { zh: "跟踪字节摘要", en: "Track Byte Summary" }, tip: { zh: "记录字节级摘要，用于更快定位传输和编码问题。", en: "Tracks byte-level summaries for faster transport/encoding troubleshooting." } },
			{ key: "roiMode", kind: "select", options: ["full", "roi-split", "smart"], label: { zh: "ROI 模式", en: "ROI Mode" }, tip: { zh: "full: 全图处理；roi-split: 分区域处理；smart: 自动策略。复杂界面建议 smart。", en: "full processes whole images, roi-split processes regions, smart auto-selects strategy." } },
			{ key: "tileMaxPixels", kind: "number", minimum: 1, maximum: 16777216, step: 1, label: { zh: "单块最大像素", en: "Tile Max Pixels" }, tip: { zh: "控制单块图像上限。过大易超预算，过小会增加切块数量与开销。", en: "Upper bound for a single tile. Too large risks budget spikes, too small increases segmentation overhead." } },
			{ key: "detailPriority", kind: "select", options: ["balanced", "high", "low"], label: { zh: "细节优先级", en: "Detail Priority" }, tip: { zh: "high: 更重细节；low: 更重速度/成本；balanced: 通用默认。", en: "high favors detail, low favors speed/cost, balanced is the general default." } }
		]
	} satisfies Phase1SectionSpec<"visionIntegrity">,
	{
		key: "visionProcessing",
		title: {
			zh: "识图预处理与输出",
			en: "Vision Processing And Output"
		},
		help: {
			zh: "控制图片送入模型前如何预处理，以及输出说明的详细程度。合理配置可在质量、速度、成本之间平衡。",
			en: "Controls preprocessing before model inference and output detail level, balancing quality, speed, and cost."
		},
		fields: [
			{ key: "svgOptimize", kind: "boolean", label: { zh: "优化 SVG", en: "Optimize SVG" }, tip: { zh: "针对 SVG 做结构优化，通常能减少噪声并提升识图稳定性。", en: "Optimizes SVG structure to reduce noise and improve stability." } },
			{ key: "imagePreprocess", kind: "boolean", label: { zh: "图片预处理", en: "Image Preprocess" }, tip: { zh: "在识图前统一做基础处理（如归一化、清理），建议开启。", en: "Applies baseline preprocessing before vision analysis; usually recommended." } },
			{ key: "mlSegment", kind: "boolean", label: { zh: "机器学习分割", en: "ML Segmentation" }, tip: { zh: "使用 ML 对复杂图像做更细粒度切分。质量可能提升，但耗时与资源更高。", en: "Uses ML segmentation for complex images. May improve quality at higher cost/latency." } },
			{ key: "outputVerbosity", kind: "select", options: ["conservative", "balanced", "verbose"], label: { zh: "输出详略", en: "Output Verbosity" }, tip: { zh: "conservative: 精简输出省 token；verbose: 更详细利于复杂分析；balanced: 默认推荐。", en: "conservative saves tokens, verbose gives richer detail, balanced is recommended default." } },
			{ key: "chatDebugVisibility", kind: "boolean", label: { zh: "Chat 调试展示", en: "Chat Debug Visibility" }, tip: { zh: "只控制 Chat 面板里的 [Vision]、[text-fallback] 等内部调试/进度展示，不影响日志与实际处理链路。", en: "Controls only chat-panel debug/progress markers such as [Vision] and [text-fallback], without changing logs or runtime behavior." } },
			{ key: "tokenBudgetMode", kind: "select", options: ["conservative", "balanced", "verbose"], mode: "compatibility", label: { zh: "旧字段 tokenBudgetMode", en: "Legacy tokenBudgetMode Alias" }, tip: { zh: "旧版别名，由 outputVerbosity 兼容读取。", en: "Legacy alias read compatibly through outputVerbosity." }, hiddenReason: compatibilityAliasReason },
			{ key: "needVisionGate", kind: "boolean", label: { zh: "需要视觉门控", en: "Need Vision Gate" }, tip: { zh: "先判断请求是否真的需要识图，再进入处理链路，可减少不必要调用。", en: "Checks whether vision is truly required before entering the processing pipeline." } },
			{ key: "svgDecisionPolicy", kind: "select", options: ["auto", "always", "never"], label: { zh: "SVG 决策策略", en: "SVG Decision Policy" }, tip: { zh: "auto: 自动判断；always: 总是按 SVG 路径；never: 不走 SVG 专用路径。", en: "auto decides dynamically, always enforces SVG path, never bypasses SVG-specific handling." } },
			{ key: "rasterPolicy", kind: "select", options: ["auto", "segment", "skip"], label: { zh: "栅格图策略", en: "Raster Policy" }, tip: { zh: "auto: 自动；segment: 强制分块；skip: 跳过栅格细化处理。", en: "auto decides, segment forces tiling, skip bypasses raster refinement." } },
			{ key: "spatialSchemaVersion", kind: "string", label: { zh: "空间协议版本", en: "Spatial Schema Version" }, tip: { zh: "用于标记坐标/区域等空间数据的结构版本，便于前后兼容与排障。一般保持默认 v1；只有升级协议时才需要调整。", en: "Version tag for coordinate/region schema compatibility. Keep default v1 unless protocol migration is required." } },
			{ key: "allowBBoxPlaceholderSvg", kind: "boolean", label: { zh: "允许 bbox 占位 SVG", en: "Allow BBox Placeholder SVG" }, tip: { zh: "仅调试用途。关闭时禁止仅含矩形的占位 SVG 作为高保真还原交付产物。", en: "Debug only. When off, bbox-only placeholder SVG cannot ship as production restore output." } },
			{ key: "rasterVectorize", kind: "boolean", label: { zh: "栅格矢量化", en: "Raster Vectorize" }, tip: { zh: "使用 imagetracerjs 将裁切后的 PNG 追踪为 SVG，再经 SVGO/路径拟合优化。高保真还原应开启。", en: "Traces cropped PNG to SVG via imagetracerjs before SVGO/path fitting. Keep on for high-fidelity restore." } }
		]
	} satisfies Phase1SectionSpec<"visionProcessing">,
	{
		key: "requestAttribution",
		title: {
			zh: "请求追踪",
			en: "Request Tracing"
		},
		help: {
			zh: "启用后，每次请求会自动附带 requestId；识图批处理路径还会附加 sessionId / batchId，可在扩展诊断输出中追踪完整的请求链路。",
			en: "When enabled, each request automatically carries a requestId. Vision batch paths also attach sessionId and batchId, which can be traced in the extension's diagnostics output."
		},
		fields: [
			{ key: "enabled", kind: "boolean", label: { zh: "启用请求追踪", en: "Enable Request Tracing" }, tip: { zh: "启用后每次请求自动生成 requestId，并在诊断日志中输出。", en: "Each request gets an auto-generated requestId logged to diagnostics." } },
			{ key: "includeSessionId", kind: "boolean", label: { zh: "追踪 Session ID", en: "Trace Session ID" }, tip: { zh: "识图代理会话路径会附加 sessionId，用于关联同一批次中的所有请求。", en: "Vision agent sessions attach a sessionId to correlate all requests within the same session." } },
			{ key: "includeBatchId", kind: "boolean", label: { zh: "追踪 Batch ID", en: "Trace Batch ID" }, tip: { zh: "识图批处理路径会附加 batchId，用于区分同一会话中的不同批次。", en: "Vision batch paths attach a batchId to distinguish different batches within a session." } }
		]
	} satisfies Phase1SectionSpec<"requestAttribution">
] as const satisfies readonly [
	Phase1SectionSpec<"visionAgent">,
	Phase1SectionSpec<"visionIntegrity">,
	Phase1SectionSpec<"visionProcessing">,
	Phase1SectionSpec<"requestAttribution">
];

export function getVisiblePhase1Sections(): AnyPhase1SectionSpec[] {
	return PHASE1_CONFIG_SECTIONS.map((section) => ({
		...section,
		fields: section.fields.filter((field) => {
			if (isCompatibilityField(field)) {
				return false;
			}
			if (
				HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED
				&& section.key === "visionProcessing"
				&& VISION_PROCESSING_UI_HIDDEN_WHEN_RESTORE_PIPELINE_SUSPENDED.has(field.key)
			) {
				return false;
			}
			return true;
		})
	})) as unknown as Array<AnyPhase1SectionSpec>;
}

/** Count of non-compatibility Phase 1 fields across all sections (Host UI exhaustive contract). */
export function countVisiblePhase1SettingFields(): number {
	return getVisiblePhase1Sections().reduce((total, section) => total + section.fields.length, 0);
}

export function getPhase1SectionSpec(key: Phase1ConfigSectionKey): AnyPhase1SectionSpec | undefined {
	return PHASE1_CONFIG_SECTIONS.find((section) => section.key === key) as AnyPhase1SectionSpec | undefined;
}

export function getPhase1SectionValue(settings: ExtensionSettings, key: Phase1ConfigSectionKey): VisionAgentConfig | VisionIntegrityConfig | VisionProcessingConfig | RequestAttributionConfig {
	return settings[key];
}

export function isCompatibilityField(field: AnyPhase1FieldSpec): boolean {
	return (field as { mode?: Phase1FieldMode }).mode === "compatibility";
}

export function sanitizePhase1SectionValue(sectionKey: Phase1ConfigSectionKey, value: unknown): Record<string, unknown> {
	const section = getPhase1SectionSpec(sectionKey);
	if (!section || !value || typeof value !== "object") {
		return {};
	}
	const record = value as Record<string, unknown>;
	const sanitized: Record<string, unknown> = {};
	for (const field of section.fields) {
		if (isCompatibilityField(field)) {
			continue;
		}
		const rawValue = record[field.key];
		switch (field.kind) {
			case "boolean":
				if (typeof rawValue === "boolean") {
					sanitized[field.key] = rawValue;
				}
				break;
			case "number": {
				if (rawValue === undefined || rawValue === null || rawValue === "") {
					break;
				}
				const numeric = Number(rawValue);
				if (!Number.isFinite(numeric)) {
					break;
				}
				const minimum = "minimum" in field ? field.minimum : undefined;
				const maximum = "maximum" in field ? field.maximum : undefined;
				const clamped = Math.min(maximum ?? numeric, Math.max(minimum ?? numeric, numeric));
				sanitized[field.key] = clamped;
				break;
			}
			case "select": {
				if (typeof rawValue !== "string") {
					break;
				}
				const option = rawValue.trim();
				if (field.options?.includes(option)) {
					sanitized[field.key] = option;
				}
				break;
			}
			case "string": {
				if (typeof rawValue !== "string") {
					break;
				}
				sanitized[field.key] = rawValue.trim();
				break;
			}
		}
	}
	return sanitized;
}