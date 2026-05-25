/**
 * Verify docs/readme.sections.json zh/en parity and sectionOrder coverage.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(readFileSync(path.join(repoRoot, "docs", "readme.config.json"), "utf8"));
const sections = JSON.parse(readFileSync(path.join(repoRoot, "docs", "readme.sections.json"), "utf8"));
const order = config.sectionOrder ?? [];
const generated = new Set(config.generatedSections ?? []);
let failed = false;

for (const id of order) {
	if (generated.has(id)) {
		continue;
	}
	const block = sections[id];
	if (!block) {
		console.error(`Missing section id in readme.sections.json: ${id}`);
		failed = true;
		continue;
	}
	const zh = String(block.zh ?? "").trim();
	const en = String(block.en ?? "").trim();
	if (!zh || !en) {
		console.error(`Empty zh/en for section: ${id} (zh=${zh.length} en=${en.length})`);
		failed = true;
	}
	if (!block.title?.zh || !block.title?.en) {
		console.error(`Missing title.zh/en for section: ${id}`);
		failed = true;
	}
}

for (const id of Object.keys(sections)) {
	if (!order.includes(id)) {
		console.error(`Section ${id} not listed in readme.config.json sectionOrder`);
		failed = true;
	}
}

if (failed) {
	process.exitCode = 1;
} else {
	console.log(`readme sections parity ok (${order.length} ids)`);
}
