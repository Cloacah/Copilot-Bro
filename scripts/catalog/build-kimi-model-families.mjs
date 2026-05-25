/**
 * Build Kimi / Moonshot model families from curated cards JSON.
 *
 * Regenerate: npm run catalog:kimi
 * @see https://platform.moonshot.ai/docs/models
 */
import fs from "node:fs";
import path from "node:path";
import { resolveRepoRoot } from "../lib/repo-root.mjs";

const rootDir = resolveRepoRoot(import.meta.url);
const outTsPath = path.join(rootDir, "src/config/kimiModelFamilies.ts");
const catalogJsonPath = path.join(rootDir, "resources/kimi-moonshot-model-catalog.json");
const cardsJsonPath = path.join(rootDir, "resources/kimi-model-cards.json");

function loadCards() {
	const payload = JSON.parse(fs.readFileSync(cardsJsonPath, "utf8"));
	if (!Array.isArray(payload.families) || payload.families.length === 0) {
		throw new Error(`${cardsJsonPath} must contain a non-empty "families" array`);
	}
	return payload;
}

function writeOutputs(families, meta) {
	const modelCount = families.reduce((sum, family) => sum + family.versionIds.length, 0);
	const catalog = {
		...meta,
		familyCount: families.length,
		modelCount,
		grouping: "moonshot-model-card",
		families
	};
	fs.writeFileSync(catalogJsonPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

	const header = `import type { ModelFamilyDefinition } from "./modelFamilyCatalog";

/**
 * Kimi / Moonshot families synced from curated platform docs cards.
 * Regenerate: npm run catalog:kimi
 * @see https://platform.moonshot.ai/docs/models
 */
`;
	const body = `export const KIMI_MODEL_FAMILIES: readonly ModelFamilyDefinition[] = ${JSON.stringify(families, null, "\t")};\n`;
	fs.writeFileSync(outTsPath, header + body, "utf8");
}

function main() {
	const cards = loadCards();
	const families = cards.families.map((family) => {
		const versionIds = [...family.versionIds];
		return {
			familyKey: family.familyKey,
			displayName: family.displayName,
			category: family.category,
			defaultVersionId: family.defaultVersionId ?? versionIds[0],
			versionIds,
			...(family.contextLength !== undefined ? { contextLength: family.contextLength } : {}),
			...(family.maxOutputTokens !== undefined ? { maxOutputTokens: family.maxOutputTokens } : {}),
			...(family.vision ? { vision: true } : {}),
			...(family.temperature !== undefined ? { temperature: family.temperature } : {}),
			...(family.topP !== undefined ? { topP: family.topP } : {}),
			...(family.thinking ? { thinking: family.thinking } : {}),
			...(family.reasoningEffort ? { reasoningEffort: family.reasoningEffort } : {})
		};
	});
	writeOutputs(families, {
		source: cards.source ?? "kimi-model-cards.json",
		docsUrl: cards.docsUrl ?? "https://platform.moonshot.ai/docs/models",
		cardCount: families.length
	});
	const modelIdCount = families.reduce((sum, family) => sum + family.versionIds.length, 0);
	console.log(`Wrote ${families.length} families (${modelIdCount} model ids) to ${path.relative(rootDir, outTsPath)}`);
}

main();
