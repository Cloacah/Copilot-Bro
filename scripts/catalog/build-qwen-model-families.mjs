/**
 * Build Qwen model families from Bailian model market (same catalog as the console).
 * Data source: DashScope GET /api/v1/models with console filters.
 *
 * Grouping matches Bailian model cards (modelCard__qFRdr):
 * - One family per console card (name__PljoN + topRightTagText__kR_J2).
 * - English displayName / category (see resources/bailian-model-cards.json).
 *
 * Regenerate: npm run catalog:qwen
 * @see https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market/all?providers=qwen%2Cwan&capabilities=TG%2CReasoning%2CVU
 */
import fs from "node:fs";
import path from "node:path";
import { resolveRepoRoot } from "../lib/repo-root.mjs";

const rootDir = resolveRepoRoot(import.meta.url);
const outTsPath = path.join(rootDir, "src/config/qwenModelFamilies.ts");
const catalogJsonPath = path.join(rootDir, "resources/qwen-bailian-model-catalog.json");
const cardsJsonPath = path.join(rootDir, "resources/bailian-model-cards.json");

const BAILIAN_PROVIDERS = new Set(["qwen", "wan"]);
const BAILIAN_CAPABILITIES = new Set(["TG", "Reasoning", "VU"]);
const MARKET_QUERY =
	"providers=qwen,wan&capabilities=TG,Reasoning,VU&page_size=200";

/** Priority-ordered: first match assigns the API model to a console card family. */
const ASSIGNMENT_RULES = [
	["tongyi-intent-detect-v3", "intent-detect"],
	["qwen-flash-character", "qwen-flash-character"],
	["qvq-max", "qvq-max"],
	["qvq-plus", "qvq-plus"],
	["qwq-plus", "qwq-plus"],
	["qwen-vl-max", "qwen-vl-max"],
	[/^qwen-vl-plus/, "qwenvl-plus"],
	[/^qwen3\.6-(27b|35b-a3b)$/, "qwen3.6-open-source"],
	["qwen3.6-max-preview", "qwen3.6-max"],
	[/^qwen3\.7-max/, "qwen3.7-max"],
	[/^qwen3\.6-plus/, "qwen3.6-plus"],
	[/^qwen3\.6-flash/, "qwen3.6-flash"],
	[/^qwen3\.5-(27b|35b-a3b|122b-a10b|397b-a17b)$/, "qwen3.5-open-source"],
	[/^qwen3\.5-plus/, "qwen3.5-plus"],
	[/^qwen3\.5-flash/, "qwen3.5-flash"],
	[/^qwen3-vl-235b-a22b-instruct/, "qwen3-vl-open-source"],
	[/^qwen3-vl-235b-a22b-thinking/, "qwen3-vl-open-source"],
	[/^qwen3-vl-30b-a3b-instruct/, "qwen3-vl-open-source"],
	[/^qwen3-vl-30b-a3b-thinking/, "qwen3-vl-open-source"],
	[/^qwen3-vl-32b-instruct/, "qwen3-vl-open-source"],
	[/^qwen3-vl-32b-thinking/, "qwen3-vl-open-source"],
	[/^qwen3-vl-8b-instruct/, "qwen3-vl-open-source"],
	[/^qwen3-vl-8b-thinking/, "qwen3-vl-open-source"],
	[/^qwen3-vl-plus/, "qwen3-vl-plus"],
	[/^qwen3-vl-flash/, "qwen3-vl-flash"],
	["qwen3-coder-next", "qwen3-open-source"],
	[/^qwen3-next-80b-a3b-instruct/, "qwen3-open-source"],
	[/^qwen3-next-80b-a3b-thinking/, "qwen3-open-source"],
	["qwen3-14b", "qwen3-open-source"],
	["qwen3-8b", "qwen3-open-source"],
	["qwen3-32b", "qwen3-open-source"],
	["qwen3-30b-a3b", "qwen3-open-source"],
	["qwen3-235b-a22b", "qwen3-open-source"],
	[/^qwen3-30b-a3b-instruct-2507/, "qwen3-open-source"],
	[/^qwen3-30b-a3b-thinking-2507/, "qwen3-open-source"],
	[/^qwen3-235b-a22b-instruct-2507/, "qwen3-open-source"],
	[/^qwen3-235b-a22b-thinking-2507/, "qwen3-open-source"],
	[/^qwen3-max/, "qwen3-max"],
	["qwen-max", "qwen-max"],
	[/^qwen-plus/, "qwen-plus"],
	[/^qwen-flash/, "qwen-flash"],
	["qwen-turbo", "qwen-turbo"]
];

/** @typedef {{ familyKey: string, displayName: string, category: string, defaultVersionHint?: string }} CardMeta */

/** @type {Map<string, CardMeta>} */
function loadCardMetadata() {
	/** @type {Map<string, CardMeta>} */
	const map = new Map();
	if (fs.existsSync(cardsJsonPath)) {
		const payload = JSON.parse(fs.readFileSync(cardsJsonPath, "utf8"));
		for (const card of payload.cards ?? []) {
			map.set(card.familyKey, card);
		}
	}
	return map;
}

const CARD_METADATA = loadCardMetadata();

/** @typedef {{ model: string, name: string, provider: string, capabilities?: string[], description?: string, equivalent_snapshot?: string }} ApiModel */

async function fetchBailianMarketModels(apiKey) {
	const url = `https://dashscope.aliyuncs.com/api/v1/models?${MARKET_QUERY}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiKey}` }
	});
	if (!response.ok) {
		throw new Error(`DashScope models API HTTP ${response.status}`);
	}
	const payload = await response.json();
	if (!payload.success) {
		throw new Error(`DashScope models API error: ${JSON.stringify(payload)}`);
	}
	return payload.output.models;
}

/** @param {ApiModel[]} models */
function filterBailianMarketModels(models) {
	return models.filter((entry) => {
		if (!BAILIAN_PROVIDERS.has(entry.provider)) {
			return false;
		}
		const capabilities = entry.capabilities ?? [];
		return capabilities.some((capability) => BAILIAN_CAPABILITIES.has(capability));
	});
}

/** @param {string} modelId */
function assignFamilyKey(modelId) {
	for (const [pattern, familyKey] of ASSIGNMENT_RULES) {
		if (pattern instanceof RegExp) {
			if (pattern.test(modelId)) {
				return familyKey;
			}
		} else if (modelId === pattern) {
			return familyKey;
		}
	}
	return null;
}

function sortVersionIds(versionIds) {
	return [...new Set(versionIds)].sort((left, right) => {
		const leftDated = /\d{4}-\d{2}-\d{2}/.test(left);
		const rightDated = /\d{4}-\d{2}-\d{2}/.test(right);
		if (leftDated !== rightDated) {
			return leftDated ? 1 : -1;
		}
		if (left.endsWith("-latest") !== right.endsWith("-latest")) {
			return left.endsWith("-latest") ? -1 : 1;
		}
		return right.localeCompare(left);
	});
}

/** @param {ApiModel[]} models @param {string} familyKey */
function pickDisplayName(models, familyKey) {
	const meta = CARD_METADATA.get(familyKey);
	if (meta?.displayName) {
		return meta.displayName;
	}
	const latin = models.find((entry) => /^[\x00-\x7F]+$/.test(entry.name.trim()));
	if (latin) {
		return latin.name
			.trim()
			.replace(/-Latest$/i, "")
			.replace(/-Preview$/i, "");
	}
	return familyKey;
}

/** @param {string} familyKey */
function pickCategory(familyKey) {
	return CARD_METADATA.get(familyKey)?.category ?? "qwen3";
}

function scoreDefaultVersionCandidate(modelId) {
	let score = 0;
	if (/-preview$/i.test(modelId)) {
		score += 40;
	}
	if (/-latest$/i.test(modelId)) {
		score += 35;
	}
	const dated = modelId.match(/(\d{4}-\d{2}-\d{2})/);
	if (dated) {
		score += 30 + Number(dated[1].replaceAll("-", ""));
	}
	if (/\bmax\b/i.test(modelId)) {
		score += 25;
	}
	if (/\bplus\b/i.test(modelId)) {
		score += 18;
	}
	if (/\b235b\b/i.test(modelId)) {
		score += 22;
	}
	if (/\b122b\b/i.test(modelId)) {
		score += 16;
	}
	if (/\b80b\b/i.test(modelId)) {
		score += 14;
	}
	if (/\b32b\b/i.test(modelId)) {
		score += 10;
	}
	if (/\b30b\b/i.test(modelId)) {
		score += 8;
	}
	if (/\b27b\b/i.test(modelId)) {
		score += 6;
	}
	if (/-instruct$/i.test(modelId) && !/-thinking$/i.test(modelId)) {
		score += 4;
	}
	if (/-thinking$/i.test(modelId)) {
		score -= 2;
	}
	if (/-turbo$/i.test(modelId) || /-flash$/i.test(modelId)) {
		score -= 4;
	}
	return score;
}

/** @param {ApiModel[]} models @param {string} familyKey */
function pickDefaultVersionId(models, familyKey) {
	const hint = CARD_METADATA.get(familyKey)?.defaultVersionHint;
	if (hint && models.some((entry) => entry.model === hint)) {
		return hint;
	}
	const preferred = models.find((entry) => entry.equivalent_snapshot);
	if (preferred?.model) {
		return preferred.model;
	}
	const ranked = [...models].sort((left, right) => {
		const scoreDelta = scoreDefaultVersionCandidate(right.model) - scoreDefaultVersionCandidate(left.model);
		if (scoreDelta !== 0) {
			return scoreDelta;
		}
		return right.model.localeCompare(left.model);
	});
	return ranked[0]?.model ?? sortVersionIds(models.map((entry) => entry.model))[0];
}

function shouldEnableThinking(familyKey, displayName, capabilities) {
	if (/qvq|qwq|thinking/i.test(familyKey) || /thinking/i.test(displayName)) {
		return true;
	}
	const caps = new Set(capabilities ?? []);
	return caps.has("Reasoning") && !caps.has("TG") && !caps.has("VU");
}

/** @param {ApiModel[]} filtered */
function buildFamilies(filtered) {
	/** @type {Map<string, ApiModel[]>} */
	const grouped = new Map();
	const unassigned = [];
	for (const entry of filtered) {
		const familyKey = assignFamilyKey(entry.model);
		if (!familyKey) {
			unassigned.push(entry);
			continue;
		}
		if (!grouped.has(familyKey)) {
			grouped.set(familyKey, []);
		}
		grouped.get(familyKey).push(entry);
	}
	if (unassigned.length > 0) {
		const ids = unassigned.map((entry) => entry.model).join(", ");
		throw new Error(`Unassigned Bailian models (${unassigned.length}): ${ids}`);
	}

	/** @type {object[]} */
	const families = [];
	for (const [familyKey, models] of grouped.entries()) {
		const versionIds = sortVersionIds(models.map((entry) => entry.model));
		const capabilities = [...new Set(models.flatMap((entry) => entry.capabilities ?? []))];
		const displayName = pickDisplayName(models, familyKey);
		const family = {
			familyKey,
			displayName,
			category: pickCategory(familyKey),
			defaultVersionId: pickDefaultVersionId(models, familyKey),
			versionIds
		};
		if (capabilities.includes("VU") || /vl|qvq/i.test(familyKey)) {
			family.vision = true;
		}
		if (shouldEnableThinking(familyKey, displayName, capabilities)) {
			family.thinking = "enabled";
		}
		families.push(family);
	}

	const categoryOrder = ["qwen3.6", "qwen3.5", "qwen3", "qwen", "legacy", "tools"];
	families.sort((left, right) => {
		const leftIndex = categoryOrder.indexOf(left.category);
		const rightIndex = categoryOrder.indexOf(right.category);
		const li = leftIndex === -1 ? categoryOrder.length : leftIndex;
		const ri = rightIndex === -1 ? categoryOrder.length : rightIndex;
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
		grouping: "bailian-model-card",
		families
	};
	fs.writeFileSync(catalogJsonPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

	const header = `import type { ModelFamilyDefinition } from "./modelFamilyCatalog";

/**
 * Qwen families synced from Bailian model market (DashScope /api/v1/models).
 * Regenerate: DASHSCOPE_API_KEY=... node scripts/build-qwen-model-families.mjs
 * @see https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market/all?providers=qwen%2Cwan&capabilities=TG%2CReasoning%2CVU
 */
`;
	const body = `export const QWEN_MODEL_FAMILIES: readonly ModelFamilyDefinition[] = ${JSON.stringify(families, null, "\t")};\n`;
	fs.writeFileSync(outTsPath, header + body, "utf8");
}

async function loadFilteredModels() {
	const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
	if (apiKey) {
		const all = await fetchBailianMarketModels(apiKey);
		const filtered = filterBailianMarketModels(all);
		return {
			filtered,
			meta: {
				source: "dashscope-api-v1-models",
				fetchedAt: new Date().toISOString(),
				apiTotal: filtered.length
			}
		};
	}
	if (!fs.existsSync(catalogJsonPath)) {
		throw new Error(
			"Set DASHSCOPE_API_KEY to refresh from Bailian, or commit resources/qwen-bailian-model-catalog.json"
		);
	}
	const catalog = JSON.parse(fs.readFileSync(catalogJsonPath, "utf8"));
	return {
		filtered: null,
		families: catalog.families,
		meta: {
			source: catalog.source ?? "qwen-bailian-model-catalog.json",
			fetchedAt: catalog.fetchedAt,
			apiTotal: catalog.modelCount ?? catalog.apiTotal
		}
	};
}

const loaded = await loadFilteredModels();
const families = loaded.families ?? buildFamilies(loaded.filtered);
const meta = {
	...loaded.meta,
	filters: {
		providers: [...BAILIAN_PROVIDERS],
		capabilities: [...BAILIAN_CAPABILITIES]
	},
	consoleUrl:
		"https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market/all?providers=qwen%2Cwan&capabilities=TG%2CReasoning%2CVU"
};
writeOutputs(families, meta);
const modelIdCount = families.reduce((sum, family) => sum + family.versionIds.length, 0);
console.log(`Wrote ${families.length} families (${modelIdCount} model ids) to ${path.relative(rootDir, outTsPath)}`);
