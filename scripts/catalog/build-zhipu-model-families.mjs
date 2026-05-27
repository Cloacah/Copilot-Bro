/**
 * Build Zhipu GLM model families from BigModel docs cards + optional live API.
 *
 * Primary source: resources/zhipu-model-cards.json (scrape via scripts/catalog/scrape-zhipu-bigmodel-docs.mjs).
 * Live merge: GET https://open.bigmodel.cn/api/paas/v4/models (ZHIPU_API_KEY) — text ids only today.
 *
 * Regenerate: node scripts/catalog/build-zhipu-model-families.mjs
 * With API: ZHIPU_API_KEY=... node scripts/catalog/build-zhipu-model-families.mjs
 * @see https://docs.bigmodel.cn/cn/guide/start/model-overview
 */
import fs from "node:fs";
import path from "node:path";
import { resolveRepoRoot } from "../lib/repo-root.mjs";
import { applyZhipuFamilyDefaults, normalizeZhipuModelId } from "./lib/zhipuFamilyDefaults.mjs";

const rootDir = resolveRepoRoot(import.meta.url);
const outTsPath = path.join(rootDir, "src/config/zhipuModelFamilies.ts");
const catalogJsonPath = path.join(rootDir, "resources/zhipu-bigmodel-model-catalog.json");
const cardsJsonPath = path.join(rootDir, "resources/zhipu-model-cards.json");

/** Priority-ordered: first match assigns an API model id to a family. */
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
	[/^glm-ocr/i, "glm-ocr"],
	[/^autoglm-phone/i, "autoglm-phone"]
];

const CATEGORY_ORDER = [
	"Flagship / Agent Coding",
	"Flagship / Agent",
	"Flagship / Long Task",
	"Reasoning / Agent",
	"Agent Coding",
	"Fast Reasoning",
	"Fast / General",
	"Fast / Cost Efficient",
	"Ultra Long Context",
	"Vision / Multimodal Coding",
	"Vision / Agent Coding",
	"Vision / Reasoning",
	"Vision / OCR",
	"Vision / Agent Framework",
	"Free",
	"Free / Vision",
	"Free (deprecated)",
	"Free / Cost Efficient",
	"Legacy / General",
	"Legacy / Fast"
];

/** @typedef {{ familyKey: string, displayName: string, category: string, kind: string, contextLength?: number, maxOutputTokens?: number, defaultVersionHint?: string, additionalVersionIds?: string[], thinking?: string, legacy?: boolean }} ZhipuCard */

function loadCards() {
	const payload = JSON.parse(fs.readFileSync(cardsJsonPath, "utf8"));
	/** @type {ZhipuCard[]} */
	const cards = payload.cards ?? [];
	return { cards, meta: payload };
}

/** @param {string} modelId */
function assignFamilyKey(modelId) {
	const id = normalizeZhipuModelId(modelId);
	for (const [pattern, familyKey] of ASSIGNMENT_RULES) {
		if (pattern instanceof RegExp) {
			if (pattern.test(id)) {
				return familyKey;
			}
		} else if (id === pattern) {
			return familyKey;
		}
	}
	return undefined;
}

/** @param {string[]} ids */
function sortVersionIds(ids) {
	const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
	return unique.sort((left, right) => {
		const leftDate = left.match(/(\d{8})$/);
		const rightDate = right.match(/(\d{8})$/);
		if (leftDate && rightDate && leftDate[1] !== rightDate[1]) {
			return rightDate[1].localeCompare(leftDate[1]);
		}
		return right.localeCompare(left, "en");
	});
}

/** @param {string} modelId @param {ZhipuCard} card */
function scoreDefaultVersionCandidate(modelId, card) {
	let score = 0;
	if (modelId === card.defaultVersionHint) {
		score += 100;
	}
	if (modelId === card.familyKey) {
		score += 50;
	}
	if (!/-flash$/i.test(modelId) && !/-turbo$/i.test(modelId)) {
		score += 10;
	}
	if (/-flashx/i.test(modelId)) {
		score += 4;
	}
	if (/-flash$/i.test(modelId)) {
		score -= 6;
	}
	return score;
}

/** @param {string[]} versionIds @param {ZhipuCard} card */
function pickDefaultVersionId(versionIds, card) {
	const hint = card.defaultVersionHint?.trim();
	if (hint && versionIds.includes(hint)) {
		return hint;
	}
	const ranked = [...versionIds].sort(
		(left, right) => scoreDefaultVersionCandidate(right, card) - scoreDefaultVersionCandidate(left, card)
	);
	return ranked[0] ?? card.familyKey;
}

async function fetchZhipuApiModels(apiKey) {
	const response = await fetch("https://open.bigmodel.cn/api/paas/v4/models", {
		headers: { Authorization: `Bearer ${apiKey}` }
	});
	if (!response.ok) {
		throw new Error(`Zhipu models API HTTP ${response.status}`);
	}
	const payload = await response.json();
	const rows = payload.data ?? payload.models ?? [];
	return rows.map((entry) => (typeof entry === "string" ? entry : entry.id)).filter(Boolean);
}

/**
 * @param {ZhipuCard[]} cards
 * @param {string[]} [apiModelIds]
 */
function buildFamilies(cards, apiModelIds = []) {
	/** @type {Map<string, { card: ZhipuCard, versionIdSet: Set<string> }>} */
	const byFamily = new Map();
	for (const card of cards) {
		const versionIdSet = new Set();
		const seedIds = [
			card.defaultVersionHint,
			card.familyKey,
			...(card.additionalVersionIds ?? [])
		].filter(Boolean);
		for (const id of seedIds) {
			versionIdSet.add(normalizeZhipuModelId(id));
		}
		byFamily.set(card.familyKey, { card, versionIdSet });
	}

	const unassignedApi = [];
	for (const rawId of apiModelIds) {
		const modelId = normalizeZhipuModelId(rawId);
		const familyKey = assignFamilyKey(modelId);
		if (!familyKey || !byFamily.has(familyKey)) {
			unassignedApi.push(modelId);
			continue;
		}
		byFamily.get(familyKey).versionIdSet.add(modelId);
	}
	if (unassignedApi.length > 0) {
		console.warn(`Zhipu API models not mapped to a doc card (${unassignedApi.length}): ${unassignedApi.join(", ")}`);
	}

	/** @type {object[]} */
	const families = [];
	for (const [familyKey, { card, versionIdSet }] of byFamily.entries()) {
		const versionIds = sortVersionIds([...versionIdSet]);
		if (versionIds.length === 0) {
			versionIds.push(familyKey);
		}
		const base = {
			familyKey,
			displayName: card.displayName,
			category: card.category,
			defaultVersionId: pickDefaultVersionId(versionIds, card),
			versionIds
		};
		if (card.kind === "vision") {
			base.vision = true;
		}
		families.push(applyZhipuFamilyDefaults(base, card));
	}

	families.sort((left, right) => {
		const leftIndex = CATEGORY_ORDER.indexOf(left.category);
		const rightIndex = CATEGORY_ORDER.indexOf(right.category);
		const li = leftIndex === -1 ? CATEGORY_ORDER.length : leftIndex;
		const ri = rightIndex === -1 ? CATEGORY_ORDER.length : rightIndex;
		if (li !== ri) {
			return li - ri;
		}
		return left.displayName.localeCompare(right.displayName, "en");
	});
	return families;
}

function writeOutputs(families, meta) {
	const modelCount = families.reduce((sum, family) => sum + family.versionIds.length, 0);
	const catalog = {
		...meta,
		familyCount: families.length,
		modelCount,
		grouping: "bigmodel-model-card",
		families
	};
	fs.writeFileSync(catalogJsonPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

	const header = `import type { ModelFamilyDefinition } from "./modelFamilyCatalog";

/**
 * Zhipu GLM families synced from BigModel docs + optional /paas/v4/models API.
 * Regenerate: npm run catalog:zhipu
 * @see https://docs.bigmodel.cn/cn/guide/start/model-overview
 */
`;
	const body = `export const ZHIPU_MODEL_FAMILIES: readonly ModelFamilyDefinition[] = ${JSON.stringify(families, null, "\t")};\n`;
	fs.writeFileSync(outTsPath, header + body, "utf8");
}

function loadExistingApiMeta() {
	if (!fs.existsSync(catalogJsonPath)) {
		return {};
	}
	const catalog = JSON.parse(fs.readFileSync(catalogJsonPath, "utf8"));
	/** @type {Record<string, unknown>} */
	const preserved = {};
	if (catalog.apiSource) {
		preserved.apiSource = catalog.apiSource;
	}
	if (catalog.apiFetchedAt) {
		preserved.apiFetchedAt = catalog.apiFetchedAt;
	}
	if (typeof catalog.apiModelCount === "number") {
		preserved.apiModelCount = catalog.apiModelCount;
	}
	return preserved;
}

async function main() {
	const { cards, meta: cardsMeta } = loadCards();
	const apiKey = process.env.ZHIPU_API_KEY?.trim();
	let apiModelIds = [];
	let apiMeta = loadExistingApiMeta();
	if (apiKey) {
		apiModelIds = await fetchZhipuApiModels(apiKey);
		apiMeta = {
			apiSource: "zhipu-paas-v4-models",
			apiFetchedAt: new Date().toISOString(),
			apiModelCount: apiModelIds.length
		};
	}
	const families = buildFamilies(cards, apiModelIds);
	writeOutputs(families, {
		source: cardsMeta.source ?? "zhipu-model-cards.json",
		docsUrl: cardsMeta.docsUrl ?? "https://docs.bigmodel.cn/cn/guide/start/model-overview",
		cardCount: cards.length,
		...apiMeta
	});
	const modelIdCount = families.reduce((sum, family) => sum + family.versionIds.length, 0);
	console.log(`Wrote ${families.length} families (${modelIdCount} model ids) to ${path.relative(rootDir, outTsPath)}`);
}

await main();
