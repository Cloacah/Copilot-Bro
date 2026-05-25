#!/usr/bin/env node
/**
 * Regenerates Qwen/Zhipu catalog outputs and fails if git would change committed artifacts.
 * Offline-safe when resources/*.json snapshots exist (no API key required).
 */
import { execSync } from "node:child_process";
import { resolveRepoRoot } from "../lib/repo-root.mjs";

const root = resolveRepoRoot(import.meta.url);
const tracked = [
	"resources/qwen-bailian-model-catalog.json",
	"resources/zhipu-bigmodel-model-catalog.json",
	"src/config/qwenModelFamilies.ts",
	"src/config/zhipuModelFamilies.ts"
];

process.chdir(root);
const buildEnv = { ...process.env };
delete buildEnv.DASHSCOPE_API_KEY;
delete buildEnv.ZHIPU_API_KEY;
execSync("npm run catalog:build", { stdio: "inherit", env: buildEnv });
const diff = execSync(`git diff -- ${tracked.map((p) => `"${p}"`).join(" ")}`, {
	encoding: "utf8",
	shell: true
}).trim();
if (diff) {
	console.error("catalog:verify failed — committed catalog artifacts drift after rebuild:\n");
	console.error(diff);
	process.exit(1);
}
console.log("catalog:verify OK — catalog TS/JSON match generator output");
