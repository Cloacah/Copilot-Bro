/**
 * Scrape Zhipu BigModel guide pages (llms.txt + model-overview links) into zhipu-model-cards.json.
 *
 * Sources: text / vlm / free sections under https://docs.bigmodel.cn/cn/guide/models/
 * Hub pages with <Tab title="GLM-..."> yield per-tab API ids and params; parent slug is omitted when it has no model= sample.
 *
 * Run: node scripts/catalog/scrape-zhipu-bigmodel-docs.mjs
 * Then: npm run catalog:zhipu && npm run catalog:verify
 */
import fs from "node:fs";
import path from "node:path";
import { resolveRepoRoot } from "../lib/repo-root.mjs";
import { applyZhipuFamilyDefaults, normalizeZhipuModelId } from "./lib/zhipuFamilyDefaults.mjs";

const rootDir = resolveRepoRoot(import.meta.url);
const outPath = path.join(rootDir, "resources/zhipu-model-cards.json");
const LLMS_URL = "https://docs.bigmodel.cn/llms.txt";
const OVERVIEW_URL = "https://docs.bigmodel.cn/cn/guide/start/model-overview.md";
const DOCS_BASE = "https://docs.bigmodel.cn";

/** @type {readonly [string | RegExp, string][]} */
const ASSIGNMENT_RULES = [
	["glm-5.1", "glm-5.1"],
	["glm-5-turbo", "glm-5-turbo"],
	["glm-5", "glm-5"],
	[/^glm-5v(-turbo)?$/i, "glm-5v-turbo"],
	[/^glm-4\.7-flash(?!x)/i, "glm-4.7-flash"],
	[/^glm-4\.7-flashx/i, "glm-4.7-flashx"],
	[/^glm-4\.7/, "glm-4.7"],
	[/^glm-4\.6v-flashx/i, "glm-4.6v-flashx"],
	[/^glm-4\.6v-flash/i, "glm-4.6v-flash"],
	[/^glm-4\.6v/, "glm-4.6v"],
	[/^glm-4\.6/, "glm-4.6"],
	[/^glm-4\.5v/, "glm-4.5v"],
	[/^glm-4\.5-airx/i, "glm-4.5-airx"],
	[/^glm-4\.5-air/, "glm-4.5-air"],
	[/^glm-4\.5-flash/i, "glm-4.5-flash"],
	[/^glm-4\.5/, "glm-4.5"],
	[/^glm-4\.1v-thinking-flashx/i, "glm-4.1v-thinking-flashx"],
	[/^glm-4\.1v-thinking-flash(?!x)/i, "glm-4.1v-thinking-flash"],
	[/^glm-4-long/i, "glm-4-long"],
	[/^glm-4-flashx-\d{8}$/i, "glm-4-flashx"],
	[/^glm-4-flashx/i, "glm-4-flashx"],
	[/^glm-4-flash-\d{8}$/i, "glm-4-flash"],
	[/^glm-4v-flash/i, "glm-4v-flash"],
	[/^glm-4-flash$/i, "glm-4-flash"],
	[/^glm-4-plus/i, "glm-4-plus"],
	[/^glm-4-air/i, "glm-4-air"],
	[/^glm-4-9b/i, "glm-4-9b"],
	[/^glm-4(?!\.)/i, "glm-4"],
	[/^glm-ocr/i, "glm-ocr"],
	[/^autoglm-phone/i, "autoglm-phone"]
];

const SKIP_SLUGS = new Set([
	"cogvideox-flash",
	"cogview-3-flash"
]);

const CATEGORY_BY_SECTION = {
	text: "Fast / General",
	vlm: "Vision / Multimodal Coding",
	free: "Free"
};

/** Higher wins when the same family appears in text, vlm, and free pages. */
const SECTION_PRIORITY = { text: 3, vlm: 2, free: 1 };

function inferKind(meta, inputModalities) {
	if (meta.section === "vlm") {
		return "vision";
	}
	if (meta.section === "free" && /(?:^|[-/])(?:[^a-z]*v|ocr|autoglm|thinking)/i.test(meta.slug)) {
		return "vision";
	}
	if (/图像|视频|视觉|OCR|多模态/i.test(inputModalities)) {
		return "vision";
	}
	return "text";
}

function assignFamilyKey(modelId) {
	const normalized = normalizeZhipuModelId(modelId);
	for (const [pattern, familyKey] of ASSIGNMENT_RULES) {
		if (typeof pattern === "string") {
			if (normalized === pattern) {
				return familyKey;
			}
		} else if (pattern.test(normalized)) {
			return familyKey;
		}
	}
	return normalized;
}

function discoverGuideUrls(llmsText, overviewText) {
	/** @type {Map<string, { section: string, slug: string }>} */
	const urls = new Map();
	const patterns = [
		/https:\/\/docs\.bigmodel\.cn\/cn\/guide\/models\/(text|vlm|free)\/([a-z0-9.-]+)\.md/gi,
		/\/cn\/guide\/models\/(text|vlm|free)\/([a-z0-9.-]+)/gi
	];
	for (const text of [llmsText, overviewText]) {
		for (const pattern of patterns) {
			for (const match of text.matchAll(pattern)) {
				const section = match[1].toLowerCase();
				const slug = match[2].toLowerCase().replace(/\.md$/i, "");
				if (SKIP_SLUGS.has(slug)) {
					continue;
				}
				urls.set(`${section}/${slug}`, { section, slug });
			}
		}
	}
	return [...urls.values()];
}

/** @param {string} md @param {{ section: string, slug: string }} meta */
function discoverChildGuidesFromPage(md, meta) {
	/** @type {{ section: string, slug: string }[]} */
	const children = [];
	for (const match of md.matchAll(/<Tab\s+title="([^"]+)">/g)) {
		if (!isModelTabTitle(match[1])) {
			continue;
		}
		const slug = tabTitleToModelId(match[1]);
		if (slug && slug !== meta.slug) {
			children.push({ section: meta.section, slug });
		}
	}
	return children;
}

async function fetchText(url) {
	const response = await fetch(url, {
		headers: { "User-Agent": "Extended-Models-For-Copilot/catalog-scraper" },
		signal: AbortSignal.timeout(60_000)
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} for ${url}`);
	}
	return response.text();
}

function parseTokenCount(raw) {
	const text = String(raw || "").trim();
	const million = text.match(/(\d+(?:\.\d+)?)\s*M/i);
	if (million) {
		return Math.round(Number(million[1]) * 1_000_000);
	}
	const thousand = text.match(/(\d+(?:\.\d+)?)\s*K/i);
	if (thousand) {
		return Math.round(Number(thousand[1]) * 1000);
	}
	const plain = text.match(/^(\d+)$/);
	if (plain) {
		return Number(plain[1]);
	}
	return undefined;
}

function displayNameFromTitle(title) {
	return String(title || "")
		.replace(/^#+\s*/, "")
		.trim()
		.replace(/\bGLM\b/g, "GLM")
		.replace(/-/g, " ");
}

/** Strip trailing YYYYMMDD release suffix from ids when building display labels. */
function modelIdForDisplayName(modelId) {
	return normalizeZhipuModelId(modelId).replace(/-\d{8}$/, "");
}

function displayNameFromModelId(modelId) {
	return modelIdForDisplayName(modelId)
		.split("-")
		.map((part) => {
			const upper = part.toUpperCase();
			if (/^glm/.test(part)) {
				return upper.replace(/^GLM(?=\d)/, "GLM ");
			}
			if (part === "v") {
				return "V";
			}
			if (/^\d+(?:\.\d+)?v$/i.test(part)) {
				return part.replace(/v$/i, "V");
			}
			if (upper === "OCR" || upper === "AUTOGLM") {
				return upper === "AUTOGLM" ? "AutoGLM" : upper;
			}
			if (upper === "FLASHX") {
				return "FlashX";
			}
			if (upper === "A3B" || upper === "A22B") {
				return upper;
			}
			return part.charAt(0).toUpperCase() + part.slice(1);
		})
		.join(" ")
		.replace(/\b(\d+(?:\.\d+)?) V\b/g, "$1V")
		.replace(/\bGLM 4V\b/g, "GLM 4V")
		.replace(/\bGLM OCR\b/g, "GLM OCR");
}

function tabTitleToModelId(title) {
	return String(title || "").trim().toLowerCase();
}

function isModelTabTitle(title) {
	return /^(GLM|AutoGLM|Cog)/i.test(title) && !/实际|思考|综合|前端|编程|任务|能力|进化|表现|审美/i.test(title);
}

function splitModelTabSections(md) {
	const tabRe = /<Tab\s+title="([^"]+)">/g;
	const tabs = [...md.matchAll(tabRe)];
	if (tabs.length === 0) {
		return [{ title: null, body: md }];
	}
	/** @type {{ title: string | null, body: string }[]} */
	const sections = [{ title: null, body: md.slice(0, tabs[0].index) }];
	for (let i = 0; i < tabs.length; i++) {
		const start = tabs[i].index + tabs[i][0].length;
		const end = i + 1 < tabs.length ? tabs[i + 1].index : md.length;
		sections.push({ title: tabs[i][1], body: md.slice(start, end) });
	}
	return sections;
}

function parseSectionMetadata(sectionMd) {
	const contextLength = parseTokenCount(
		sectionMd.match(/Card\s+title="上下文窗口"[\s\S]*?>\s*([^<\n]+)/i)?.[1]
			?? sectionMd.match(/上下文窗口[\s\S]{0,120}?(\d+(?:\.\d+)?\s*[KMkm])/i)?.[1]
	);
	const maxOutputTokens = parseTokenCount(
		sectionMd.match(/Card\s+title="最大输出\s*Tokens?"[\s\S]*?>\s*(\d+\s*K)/i)?.[1]
			?? sectionMd.match(/最大输出\s*Tokens?[\s\S]{0,80}?(\d+\s*K)/i)?.[1]
	);
	const inputModalities = sectionMd.match(/Card\s+title="输入模态"[\s\S]*?>\s*([^<\n]+)/i)?.[1] ?? "";
	const hasThinking = /thinking[\s\S]*?enabled|深度思考|思考模式|内置深度思考/i.test(sectionMd);
	const thinking = hasThinking && !/thinking[\s\S]*?disabled/i.test(sectionMd) ? "enabled" : "disabled";
	return { contextLength, maxOutputTokens, inputModalities, thinking };
}

function extractApiIdsFromSection(sectionMd) {
	const fromSamples = [...sectionMd.matchAll(/model\s*=\s*["']([a-z0-9._-]+)["']/gi)].map((m) => normalizeZhipuModelId(m[1]));
	const fromCode = [...sectionMd.matchAll(/modelCode=([a-z0-9._-]+)/gi)].map((m) => normalizeZhipuModelId(m[1]));
	return [...new Set([...fromSamples, ...fromCode])];
}

/**
 * @param {string} md
 * @param {{ section: string, slug: string }} meta
 */
function parseGuidePage(md, meta) {
	const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? meta.slug;
	const slugId = normalizeZhipuModelId(meta.slug);
	const modelTabs = splitModelTabSections(md).filter((section) => section.title && isModelTabTitle(section.title));
	const wholePageApiIds = extractApiIdsFromSection(md);
	const parentHasSample = wholePageApiIds.includes(slugId);

	/** @type {{ modelId: string, tabTitle?: string, contextLength?: number, maxOutputTokens?: number, kind: string, thinking: string, section: string }[]} */
	const discoveries = [];

	if (modelTabs.length > 0) {
		for (const tab of modelTabs) {
			const tabModelId = normalizeZhipuModelId(tabTitleToModelId(tab.title));
			const apiIds = extractApiIdsFromSection(tab.body);
			const sectionMeta = parseSectionMetadata(tab.body);
			const ids = apiIds.length > 0 ? apiIds : [tabModelId];
			for (const modelId of ids) {
				if (!parentHasSample && modelId === slugId && apiIds.length === 0) {
					continue;
				}
				discoveries.push({
					modelId,
					tabTitle: tab.title,
					contextLength: sectionMeta.contextLength,
					maxOutputTokens: sectionMeta.maxOutputTokens,
					kind: inferKind(meta, sectionMeta.inputModalities),
					thinking: sectionMeta.thinking,
					section: meta.section
				});
			}
		}
	} else {
		const sectionMeta = parseSectionMetadata(md);
		const ids = wholePageApiIds.length > 0 ? wholePageApiIds : [slugId];
		for (const modelId of ids) {
			discoveries.push({
				modelId,
				contextLength: sectionMeta.contextLength,
				maxOutputTokens: sectionMeta.maxOutputTokens,
				kind: inferKind(meta, sectionMeta.inputModalities),
				thinking: sectionMeta.thinking,
				section: meta.section
			});
		}
	}

	return { title, discoveries };
}

function categoryForDiscovery(discovery, familyKey) {
	if (discovery.section === "free") {
		return discovery.kind === "vision" ? "Free / Vision" : "Free";
	}
	if (familyKey.includes("glm-5") && !familyKey.includes("v")) {
		return "Flagship / Agent Coding";
	}
	if (discovery.kind === "vision") {
		if (familyKey.includes("ocr")) {
			return "Vision / OCR";
		}
		if (familyKey.includes("thinking")) {
			return "Vision / Reasoning";
		}
		return "Vision / Agent Coding";
	}
	return CATEGORY_BY_SECTION.text;
}

function mergeDiscoveryRow(row, d, familyKey, pageTitle) {
	const priority = SECTION_PRIORITY[d.section] ?? 0;
	row.versionIds.add(d.modelId);
	if (priority > row.sectionPriority || (priority === row.sectionPriority && priority >= 2)) {
		row.sectionPriority = priority;
		row.displayName = displayNameFromModelId(familyKey) || displayNameFromTitle(d.tabTitle ?? pageTitle);
		row.category = categoryForDiscovery(d, familyKey);
		if (d.contextLength) {
			row.contextLength = d.contextLength;
		}
		if (d.maxOutputTokens) {
			row.maxOutputTokens = d.maxOutputTokens;
		}
		row.thinking = d.thinking;
		if (d.kind === "vision" || priority >= 2) {
			row.kind = d.kind;
		}
	} else if (d.kind === "vision") {
		row.kind = "vision";
	}
	if (!row.contextLength && d.contextLength) {
		row.contextLength = d.contextLength;
	}
	if (!row.maxOutputTokens && d.maxOutputTokens) {
		row.maxOutputTokens = d.maxOutputTokens;
	}
}

function buildCards(pageResults) {
	/** @type {Map<string, { familyKey: string, displayName: string, category: string, kind: string, contextLength?: number, maxOutputTokens?: number, versionIds: Set<string>, thinking: string, sectionPriority: number }>} */
	const families = new Map();

	for (const page of pageResults) {
		for (const d of page.discoveries) {
			const familyKey = assignFamilyKey(d.modelId);
			let row = families.get(familyKey);
			if (!row) {
				row = {
					familyKey,
					displayName: displayNameFromModelId(familyKey),
					category: categoryForDiscovery(d, familyKey),
					kind: d.kind,
					contextLength: d.contextLength,
					maxOutputTokens: d.maxOutputTokens,
					versionIds: new Set(),
					thinking: d.thinking,
					sectionPriority: SECTION_PRIORITY[d.section] ?? 0
				};
				families.set(familyKey, row);
			}
			mergeDiscoveryRow(row, d, familyKey, page.title);
		}
	}

	/** @type {import('./build-zhipu-model-families.mjs').ZhipuCard[]} */
	const cards = [];
	for (const row of families.values()) {
		const versionIds = [...row.versionIds].sort();
		const defaultVersionHint = versionIds.find((id) => id === row.familyKey)
			?? versionIds.find((id) => assignFamilyKey(id) === row.familyKey && !/-\d{8}$/.test(id))
			?? versionIds[0];
		const additionalVersionIds = versionIds.filter((id) => id !== defaultVersionHint);
		const card = {
			familyKey: row.familyKey,
			displayName: row.displayName,
			category: row.category,
			kind: row.kind,
			contextLength: row.contextLength,
			maxOutputTokens: row.maxOutputTokens,
			defaultVersionHint,
			...(additionalVersionIds.length > 0 ? { additionalVersionIds } : {}),
			thinking: row.thinking
		};
		cards.push(applyZhipuFamilyDefaults(card, card));
	}

	cards.sort((a, b) => a.familyKey.localeCompare(b.familyKey));
	return cards;
}

async function main() {
	const [llmsText, overviewText] = await Promise.all([
		fetchText(LLMS_URL),
		fetchText(OVERVIEW_URL)
	]);
	const initialGuides = discoverGuideUrls(llmsText, overviewText);
	/** @type {Map<string, { section: string, slug: string }>} */
	const guideMap = new Map(initialGuides.map((guide) => [`${guide.section}/${guide.slug}`, guide]));
	const seen = new Set();

	/** @type {Awaited<ReturnType<typeof parseGuidePage>>[]} */
	const pageResults = [];
	const queue = [...initialGuides];

	while (queue.length > 0) {
		const guide = queue.shift();
		const key = `${guide.section}/${guide.slug}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		guideMap.set(key, guide);
		const url = `${DOCS_BASE}/cn/guide/models/${guide.section}/${guide.slug}.md`;
		process.stdout.write(`  ${guide.section}/${guide.slug} ... `);
		try {
			const md = await fetchText(url);
			const parsed = parseGuidePage(md, guide);
			pageResults.push(parsed);
			console.log(`${parsed.discoveries.length} id(s)`);
			for (const child of discoverChildGuidesFromPage(md, guide)) {
				const childKey = `${child.section}/${child.slug}`;
				if (!guideMap.has(childKey)) {
					guideMap.set(childKey, child);
					queue.push(child);
				}
			}
		} catch (error) {
			console.log(`SKIP (${error instanceof Error ? error.message : error})`);
		}
		await new Promise((resolve) => setTimeout(resolve, 120));
	}

	console.log(`Fetched ${pageResults.length} pages (${guideMap.size} guide slugs discovered)`);
	const cards = buildCards(pageResults);
	const payload = {
		source: "bigmodel-docs-llms-scrape",
		description: "Zhipu chat/vision model cards scraped from BigModel guide (llms.txt + model-overview + per-page tabs/model= samples).",
		docsUrl: "https://docs.bigmodel.cn/cn/guide/models/",
		fetchedAt: new Date().toISOString(),
		cardCount: cards.length,
		cards
	};
	fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	console.log(`Wrote ${cards.length} cards to ${path.relative(rootDir, outPath)}`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
