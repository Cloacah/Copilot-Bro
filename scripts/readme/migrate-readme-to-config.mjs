/**
 * One-shot: split README.md into docs/readme.sections.json (zh/en pairs per section id).
 * Run: node scripts/migrate-readme-to-config.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readmePath = path.join(repoRoot, "README.md");
const sectionsPath = path.join(repoRoot, "docs", "readme.sections.json");
const configPath = path.join(repoRoot, "docs", "readme.config.json");

const raw = await readFile(readmePath, "utf8");
const withoutNotice = raw.replace(/<!--[\s\S]*?-->\r?\n\r?\n?/u, "").trim();
const langNavMatch = withoutNotice.match(/^\*\*语言[\s\S]*?\*\*\r?\n\r?\n/u);
const body = langNavMatch ? withoutNotice.slice(langNavMatch[0].length) : withoutNotice;

const zhStart = body.indexOf("## 中文");
const enStart = body.indexOf("## English");
if (zhStart < 0 || enStart < 0) {
	throw new Error("README must contain ## 中文 and ## English");
}
const zhBody = body.slice(zhStart + "## 中文".length, enStart).trim();
const enBody = body.slice(enStart + "## English".length).trim();

/** Canonical section ids — zh/en paired by document order (not slug). */
const SECTION_IDS = [
	"features",
	"screenshots",
	"built-in-providers",
	"quick-start",
	"api-key-safety",
	"visual-configuration",
	"custom-providers-and-models",
	"vision-proxy",
	"prompt-presets",
	"glossary",
	"visual-protocol",
	"vision-prompt-contract",
	"downgrade-behavior",
	"observability",
	"migration-guide",
	"development",
	"test-vsix-vs-release-vsix",
	"host-ui-chat-simulation",
	"local-vsix-install",
	"vs-code-marketplace",
	"license"
];

function splitSections(markdown) {
	const parts = markdown.split(/\r?\n(?=### )/u);
	const sections = [];
	let preamble = "";
	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) {
			continue;
		}
		const head = trimmed.match(/^### ([^\r\n]+)/u);
		if (!head) {
			preamble = trimmed;
			continue;
		}
		const title = head[1].trim();
		const content = trimmed.replace(/^### [^\r\n]+\r?\n?/u, "").trim();
		sections.push({ title, content });
	}
	return { preamble, sections };
}

const GENERATED_TITLE = /^(兼容矩阵|Compatibility Matrix|配置参考|Configuration Reference)$/u;

function dropGenerated(sections) {
	return sections.filter((s) => !GENERATED_TITLE.test(s.title));
}

/** English ### title → canonical id (when EN section order differs from zh). */
const EN_TITLE_TO_ID = new Map(
	Object.entries({
		Features: "features",
		Screenshots: "screenshots",
		"📦 Built-In Providers": "built-in-providers",
		"🚀 Quick Start": "quick-start",
		"🔐 API Key Safety": "api-key-safety",
		"⚙️ Visual Configuration": "visual-configuration",
		"🧩 Custom Providers and Models": "custom-providers-and-models",
		"Vision Proxy": "vision-proxy",
		"Prompt Presets": "prompt-presets",
		Glossary: "glossary",
		"Visual Protocol and Built-In Paths": "visual-protocol",
		"Vision Prompt Contract and Schema Examples": "vision-prompt-contract",
		"Downgrade Behavior": "downgrade-behavior",
		Observability: "observability",
		"Migration Guide": "migration-guide",
		"🧪 Development": "development",
		"🧪 Test VSIX vs Release VSIX": "test-vsix-vs-release-vsix",
		"🛠️ Local VSIX Install": "local-vsix-install",
		"📤 VS Code Marketplace": "vs-code-marketplace",
		"📄 License": "license"
	})
);

const ZH_TITLE_TO_ID = new Map(
	SECTION_IDS.map((id, i) => {
		const zhTitles = [
			"功能概览",
			"截图示意",
			"📦 内置供应商",
			"🚀 快速开始",
			"🔐 API Key 安全说明",
			"⚙️ 可视化设置",
			"🧩 添加自定义供应商和模型",
			"识图代理",
			"预设提示词",
			"术语表",
			"视觉协议与双轨接入",
			"视觉提示词契约与 Schema 示例",
			"降级路径与用户可见输出",
			"可观测性",
			"迁移指南",
			"🧪 本地开发",
			"🧪 测试包与发布包",
			"🧪 实际人机 Chat 模拟",
			"🛠️ 本地安装 VSIX",
			"📤 发布到 VS Code Marketplace",
			"📄 License"
		];
		return [zhTitles[i], id];
	})
);

const zhParsed = splitSections(zhBody);
const enParsed = splitSections(enBody);
const zhById = new Map(
	dropGenerated(zhParsed.sections).map((s) => [ZH_TITLE_TO_ID.get(s.title) ?? s.title, s])
);
const enById = new Map(
	dropGenerated(enParsed.sections).map((s) => [EN_TITLE_TO_ID.get(s.title) ?? s.title, s])
);

const merged = {
	intro: {
		title: { zh: "简介", en: "Introduction" },
		zh: zhParsed.preamble,
		en: enParsed.preamble
	}
};
for (const id of SECTION_IDS) {
	const zh = zhById.get(id);
	const en = enById.get(id);
	if (!zh) {
		throw new Error(`Missing zh section for id=${id}`);
	}
	merged[id] = {
		title: {
			zh: zh.title,
			en: en?.title ?? zh.title
		},
		zh: zh.content,
		en: en?.content ?? ""
	};
}

const sectionOrder = Object.keys(merged);
const config = JSON.parse(await readFile(configPath, "utf8"));
config.sectionOrder = sectionOrder;
config.title = "Copilot Bro";
config.sectionOrder = ["intro", ...SECTION_IDS];
config.generatedSections = ["compatibility-matrix", "config-reference"];
delete config.preservedMarkdownPath;
config.generatedSectionsPlacement = {
	after: "vision-prompt-contract",
	insert: ["compatibility-matrix", "config-reference"]
};

await writeFile(sectionsPath, `${JSON.stringify(merged, null, "\t")}\n`, "utf8");
await writeFile(configPath, `${JSON.stringify(config, null, "\t")}\n`, "utf8");
console.log(`Wrote ${sectionOrder.length} sections to ${sectionsPath}`);
