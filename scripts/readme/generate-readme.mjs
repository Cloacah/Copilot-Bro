/**
 * Generate README.md from docs/readme.config.json + docs/readme.sections.json.
 * Injects compatibility matrix and config defaults from compiled out/.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const configPath = path.join(repoRoot, "docs", "readme.config.json");
const sectionsPath = path.join(repoRoot, "docs", "readme.sections.json");
const readmePath = path.join(repoRoot, "README.md");

const config = JSON.parse(await readFile(configPath, "utf8"));
const sections = JSON.parse(await readFile(sectionsPath, "utf8"));
const notice = `<!-- ${String(config.generatedNotice)} -->`;

const {
	DEFAULT_VISION_AGENT,
	DEFAULT_VISION_INTEGRITY,
	DEFAULT_VISION_PROCESSING,
	DEFAULT_REQUEST_ATTRIBUTION
} = require(path.join(repoRoot, "out", "config", "contractConfig.js"));
const { getCompatibilityMatrixEntry } = require(path.join(repoRoot, "out", "toolCooperation", "compatibilityMatrix.js"));
const { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } = require(path.join(
	repoRoot,
	"out",
	"config",
	"highFidelityRestoreImagePipelineSuspended.js"
));

const generatedBlocks = {
	"compatibility-matrix": buildCompatibilityMatrixSection(),
	"config-reference": buildConfigReferenceSection()
};

function buildCompatibilityMatrixSection() {
	const modelTypes = ["builtin", "bro"];
	const visionCapabilities = ["vision", "non-vision"];
	const toolsAvailability = ["tools-available", "no-tools"];
	const agentFlags = [true, false];
	const zhRows = [];
	const enRows = [];
	for (const modelType of modelTypes) {
		for (const visionCapability of visionCapabilities) {
			for (const toolsAvailable of toolsAvailability) {
				for (const agentEnabled of agentFlags) {
					const entry = getCompatibilityMatrixEntry({
						modelType,
						visionCapability,
						toolsAvailable,
						agentEnabled
					});
					const tools = toolsAvailable === "tools-available" ? "tools" : "no-tools";
					const agent = agentEnabled ? "on" : "off";
					const fallback = entry.fallbackStrategy ?? "-";
					zhRows.push(`| ${modelType} | ${visionCapability} | ${tools} | ${agent} | ${entry.strategy} | ${fallback} |`);
					enRows.push(`| ${modelType} | ${visionCapability} | ${tools} | ${agent} | ${entry.strategy} | ${fallback} |`);
				}
			}
		}
	}
	return {
		zh: [
			"### 兼容矩阵",
			"",
			"组合标签表示 `primary + fallback`，不是新的枚举值。运行时策略枚举仍为 `native`、`proxy`、`wrapper-proxy`、`text-fallback`、`plan-only`、`disabled`。",
			"",
			"| modelType | visionCapability | tools | agent | primary | fallback |",
			"| --- | --- | --- | --- | --- | --- |",
			...zhRows
		].join("\n"),
		en: [
			"### Compatibility Matrix",
			"",
			"Combination labels describe `primary + fallback`; they are not new enum values. Runtime strategy enums remain `native`, `proxy`, `wrapper-proxy`, `text-fallback`, `plan-only`, and `disabled`.",
			"",
			"| modelType | visionCapability | tools | agent | primary | fallback |",
			"| --- | --- | --- | --- | --- | --- |",
			...enRows
		].join("\n")
	};
}

function buildConfigReferenceSection() {
	const rows = [
		["(top)", "includeBuiltInPresets", "true", "是否在模型选择器显示内置预设", "show built-in presets in picker"],
		["(top)", "customProviders", "[]", "自定义供应商标识列表", "custom provider keys"],
		["(top)", "models", "[]", "自定义/覆盖的模型条目", "custom model overrides"],
		["(top)", "providerEndpoints", "{}", "各供应商区域网关 profile", "per-provider endpoint profile"],
		["(top)", "providerCustomBaseUrls", "{}", "供应商自定义 Base URL", "custom base URLs per provider"],
		["(top)", "requestTimeoutMs", "120000", "连接与流空闲超时（毫秒）", "connection/stream idle timeout ms"],
		["(top)", "logLevel", "info", "Output 通道日志级别", "output channel log level"],
		["(top)", "uiLanguage", "zh", "设置页界面语言 zh/en", "settings UI language"],
		["(top)", "configWriteScope", "global", "未定义字段的默认写入范围", "default write scope for new fields"],
		["retry", "enabled", "true", "可重试错误时自动重试", "retry retryable errors"],
		["retry", "maxAttempts", "3", "最大重试次数", "max retry attempts"],
		["visionProxy", "enabled", "true", "模型级 proxy 留空时才会使用全局配置", "applies only when the model-level proxy is empty"],
		["visionProxy", "defaultModelId", '""', "留空时自动选择可用视觉模型", "empty means auto-pick an available vision model"],
		["visionProxy", "customPrompt", '""', "追加在高保真识图契约后", "appended after high-fidelity vision contract"],
		["promptPresets", "selectedId", '""', "空表示不追加预设提示词", "empty means no preset is prepended"],
		[
			"visionAgent",
			"enabled",
			String(DEFAULT_VISION_AGENT.enabled),
			"启用会话内识图调度；紧急回滚可手动设为 `false`",
			"in-session orchestration master switch; set `false` for emergency rollback"
		],
		[
			"visionAgent",
			"keepAliveMs",
			String(DEFAULT_VISION_AGENT.keepAliveMs),
			"会话调度窗口毫秒数；`0` 表示不保留额外窗口（非宿主常驻）",
			"session scheduling window only; `0` disables the extra window (not host residency)"
		],
		[
			"visionAgent",
			"maxBatchSize",
			String(DEFAULT_VISION_AGENT.maxBatchSize),
			"推荐范围 `4-8`；超过 `8` 前建议先压测",
			"recommended operating range is `4-8`"
		],
		[
			"visionAgent",
			"maxConcurrentBatches",
			String(DEFAULT_VISION_AGENT.maxConcurrentBatches),
			"默认串行，避免跨批污染",
			"default serial processing"
		],
		[
			"visionAgent",
			"resetContextPerBatch",
			String(DEFAULT_VISION_AGENT.resetContextPerBatch),
			"每批默认重置上下文，防止跨批污染",
			"reset context per batch by default"
		],
		[
			"visionAgent",
			"deduplicateImages",
			String(DEFAULT_VISION_AGENT.deduplicateImages),
			"默认同批图片去重，减少重复识图成本",
			"dedupe images within a batch by default"
		],
		[
			"visionAgent",
			"retryOnFailure",
			String(DEFAULT_VISION_AGENT.retryOnFailure),
			"默认可重试错误重试，降低偶发失败率",
			"retry retriable failures by default"
		],
		[
			"visionAgent",
			"autoClosePolicy",
			DEFAULT_VISION_AGENT.autoClosePolicy,
			"用户语义固定为 `afterMainTask / afterTimeout / never`",
			"user-facing values are `afterMainTask / afterTimeout / never`"
		],
		["visionIntegrity", "enabled", String(DEFAULT_VISION_INTEGRITY.enabled), "默认开启完整性校验", "integrity checks enabled by default"],
		[
			"visionIntegrity",
			"strictIntegrity",
			String(DEFAULT_VISION_INTEGRITY.strictIntegrity),
			"默认非阻断；开启后完整性失败可直接阻断下游",
			"non-blocking by default; when true, failures can block downstream"
		],
		[
			"visionIntegrity",
			"certaintyThreshold",
			String(DEFAULT_VISION_INTEGRITY.certaintyThreshold),
			"ROI 置信度阈值，越高越保守",
			"ROI confidence gate"
		],
		[
			"visionIntegrity",
			"checkCount",
			String(DEFAULT_VISION_INTEGRITY.checkCount),
			"处理前后图片数量一致",
			"image count consistency"
		],
		[
			"visionIntegrity",
			"checkDimensions",
			String(DEFAULT_VISION_INTEGRITY.checkDimensions),
			"检测异常宽高变化",
			"detect unexpected dimension changes"
		],
		[
			"visionIntegrity",
			"checkDigest",
			String(DEFAULT_VISION_INTEGRITY.checkDigest),
			"摘要/哈希防内容被替换",
			"digest/hash anti-substitution"
		],
		[
			"visionIntegrity",
			"trackResize",
			String(DEFAULT_VISION_INTEGRITY.trackResize),
			"记录缩放步骤便于排障",
			"log resize operations"
		],
		[
			"visionIntegrity",
			"trackByteSummary",
			String(DEFAULT_VISION_INTEGRITY.trackByteSummary),
			"记录字节级摘要",
			"log byte-level summaries"
		],
		[
			"visionIntegrity",
			"roiMode",
			DEFAULT_VISION_INTEGRITY.roiMode,
			"可选 `full / roi-split / smart`",
			"`full / roi-split / smart`"
		],
		[
			"visionIntegrity",
			"tileMaxPixels",
			String(DEFAULT_VISION_INTEGRITY.tileMaxPixels),
			"约 4MP；超大图建议切片",
			"about 4MP"
		],
		[
			"visionIntegrity",
			"detailPriority",
			DEFAULT_VISION_INTEGRITY.detailPriority,
			"`balanced / high / low`",
			"`balanced / high / low`"
		],
		[
			"models[]",
			"vision",
			"false",
			"模型级 Vision Input 能力标记",
			"per-model Vision Input capability flag"
		],
		[
			"models[]",
			"visionProxyModelId",
			'""',
			"留空=全局；`__vision_proxy_disabled__`=禁用代理",
			"empty=global; `__vision_proxy_disabled__`=no proxy"
		],
		["visionProcessing", "svgOptimize", String(DEFAULT_VISION_PROCESSING.svgOptimize), "默认开启 SVGO 优化", "enabled by default"],
		[
			"visionProcessing",
			"imagePreprocess",
			String(DEFAULT_VISION_PROCESSING.imagePreprocess),
			"默认开启 preprocess chain",
			"enabled by default"
		],
		[
			"visionProcessing",
			"mlSegment",
			String(DEFAULT_VISION_PROCESSING.mlSegment),
			"仅可选增强；主链路不依赖它",
			"optional enhancement only"
		],
		[
			"visionProcessing",
			"outputVerbosity",
			DEFAULT_VISION_PROCESSING.outputVerbosity,
			"与 `tokenBudgetMode` 同义",
			"alias of `tokenBudgetMode`"
		],
		[
			"visionProcessing",
			"chatDebugVisibility",
			String(DEFAULT_VISION_PROCESSING.chatDebugVisibility),
			"只控制 Chat 面板内部调试/进度展示",
			"chat-panel-only internal debug visibility"
		],
		[
			"visionProcessing",
			"needVisionGate",
			String(DEFAULT_VISION_PROCESSING.needVisionGate),
			"无视觉需求时不触发识图",
			"do not trigger vision unless needed"
		],
		[
			"visionProcessing",
			"spatialSchemaVersion",
			DEFAULT_VISION_PROCESSING.spatialSchemaVersion,
			"GeometryProtocol 当前版本",
			"current GeometryProtocol version"
		],
		["modelCompatibility", "mode", "proxy", "可选 `native / proxy / wrapper-proxy / disabled`", "`native / proxy / wrapper-proxy / disabled`"],
		[
			"modelCompatibility",
			"fallbackStrategy",
			"text-fallback",
			"可选 `text-fallback / plan-only / disabled`",
			"`text-fallback / plan-only / disabled`"
		],
		["requestAttribution", "enabled", String(DEFAULT_REQUEST_ATTRIBUTION.enabled), "默认开启 request 链路字段追踪", "tracing is enabled by default"],
		[
			"requestAttribution",
			"includeSessionId",
			String(DEFAULT_REQUEST_ATTRIBUTION.includeSessionId),
			"控制是否暴露 sessionId",
			"visibility control only"
		],
		[
			"requestAttribution",
			"includeBatchId",
			String(DEFAULT_REQUEST_ATTRIBUTION.includeBatchId),
			"控制是否暴露 batchId / batchIndex",
			"visibility control only"
		]
	];

	const zhNotes = [
		"",
		"以下默认值来自 `src/config/contractConfig.ts`，文档与运行时保持一致：",
		"",
		"| config | key | default | notes |",
		"| --- | --- | --- | --- |",
		...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`),
		"",
		"额外说明：",
		"",
		"- `visionAgent` 只表达会话调度语义，不代表宿主可实现长期常驻。",
		"- `visionAgent.enabled = false` 是最安全的紧急回滚开关，会回到现有 `visionProxy.ts` 旧流程。",
		"- `mlSegment = true` 仍然是可选增强；不要把它当成主链路阻塞项。",
		"- wrapper profile 是运行时发现的内置模型视图，不需要手工写入 `extendedModels.models`。",
		"- 原生视觉模型默认走 native 结构化识图；仅在为非视觉模型指定代理 ID 时才走 proxy。",
		"- 关闭 `visionProxy.enabled` 后，Bro 视觉模型仍走 native（日志含 `vision.native.structured.resolving`）。",
		"- 视觉代理强制单层，禁止代理模型再次走代理。",
		"- 设置页可见项逐项说明见「可见配置项说明」；native/proxy 流程图见「高保真识图流程」。"
	];
	const enNotes = [
		"",
		"These defaults are sealed by `src/config/contractConfig.ts` and should match runtime behavior:",
		"",
		"| config | key | default | notes |",
		"| --- | --- | --- | --- |",
		...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[4]} |`),
		"",
		"Additional guidance:",
		"",
		"- `visionAgent` settings express in-session orchestration only and do not imply persistent host residency.",
		"- `visionAgent.enabled = false` keeps the legacy `visionProxy.ts` route available for emergency rollback.",
		"- `mlSegment = true` is still optional and should not become a blocking production dependency.",
		"- Wrapped built-in models are discovered at runtime; you do not need to hand-author them in `extendedModels.models`.",
		"- Native vision defaults to the structured native pass; proxy applies when explicitly configured for non-vision models.",
		"- With `visionProxy.enabled = false`, Bro vision models still use native structured vision.",
		"- Proxy depth is fixed at one layer (no recursive proxy chains).",
		"- See Visible Settings Guide for UI field mapping; High-Fidelity Vision Flow for native vs proxy diagrams."
	];
	if (HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED) {
		zhNotes.push(
			"- 图像矢量化/整页还原链当前未对用户开放；下文未列出 `rasterVectorize` / `allowBBoxPlaceholderSvg` 等还原专用项。"
		);
		enNotes.push(
			"- Raster/SVG restore pipeline is not documented here while suspended; restore-only keys are omitted from the table."
		);
	}

	return {
		zh: ["### 配置参考", ...zhNotes].join("\n"),
		en: ["### Configuration Reference", ...enNotes].join("\n")
	};
}

function renderLanguage(lang) {
	const order = config.sectionOrder ?? ["intro", ...Object.keys(sections)];
	const generatedSet = new Set(config.generatedSections ?? []);
	const insertAfter = config.generatedSectionsPlacement?.after;
	const insertIds = config.generatedSectionsPlacement?.insert ?? config.generatedSections ?? [];
	const parts = [];

	for (const id of order) {
		if (generatedSet.has(id)) {
			continue;
		}
		const block = sections[id];
		if (!block) {
			continue;
		}
		const body = String(block[lang] ?? "").trim();
		if (id === "intro") {
			if (body) {
				parts.push(body, "");
			}
			continue;
		}
		const title = block.title?.[lang] ?? block.title?.zh ?? id;
		parts.push(`### ${title}`, "", body, "");

		if (id === insertAfter) {
			for (const genId of insertIds) {
				const gen = generatedBlocks[genId];
				if (gen?.[lang]) {
					parts.push(gen[lang], "");
				}
			}
		}
	}

	return parts.join("\n").trim();
}

const zh = renderLanguage("zh");
const en = renderLanguage("en");
const langLine = (config.languages ?? [])
	.map((language) => `[${language.label}](#${language.anchor})`)
	.join(" | ");

const markdown = [
	`# ${config.title ?? "Copilot Bro"}`,
	"",
	notice,
	"",
	`**语言 / Language：** ${langLine}**`,
	"",
	"## 中文",
	"",
	zh,
	"",
	"## English",
	"",
	en,
	""
].join("\n");

if (process.argv.includes("--check")) {
	const current = await readFile(readmePath, "utf8");
	if (current !== markdown) {
		console.error("README.md is out of date. Run: npm run readme:generate");
		process.exitCode = 1;
	}
} else {
	await writeFile(readmePath, markdown);
	console.log("Generated README.md");
}
