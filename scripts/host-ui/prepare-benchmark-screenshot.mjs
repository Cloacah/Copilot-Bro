#!/usr/bin/env node
/**
 * Copy & downscale latest VS Code chat screenshot to `src/test/fixtures/chat-screenshot-benchmark.png`.
 * Source default: %APPDATA%/Code/User/workspaceStorage/vscode-chat-images/
 * (PNG only — no bundled JSON plan; structured regions come from the live vision model.)
 */
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const defaultSrcDir = path.join(
	process.env.APPDATA ?? "",
	"Code",
	"User",
	"workspaceStorage",
	"vscode-chat-images"
);
const outPath = path.resolve("src/test/fixtures/chat-screenshot-benchmark.png");
const targetW = Number(process.env.BENCHMARK_WIDTH ?? 1024);
const targetH = Number(process.env.BENCHMARK_HEIGHT ?? 640);

async function pickLatestPng(dir) {
	const names = await readdir(dir);
	const pngs = names.filter((n) => n.toLowerCase().endsWith(".png"));
	let best = null;
	for (const name of pngs) {
		const full = path.join(dir, name);
		const st = await stat(full);
		if (!best || st.mtimeMs > best.mtimeMs) {
			best = { full, mtimeMs: st.mtimeMs };
		}
	}
	return best?.full;
}

const srcDir = process.argv[2] ? path.resolve(process.argv[2]) : defaultSrcDir;
const srcFile = process.argv[3] ? path.resolve(process.argv[3]) : await pickLatestPng(srcDir);
if (!srcFile) {
	console.error(`No PNG found under ${srcDir}`);
	process.exit(1);
}

await mkdir(path.dirname(outPath), { recursive: true });
await sharp(srcFile).resize(targetW, targetH, { fit: "fill" }).png({ compressionLevel: 9 }).toFile(outPath);
const meta = await sharp(outPath).metadata();
const st = await stat(outPath);
console.log(
	JSON.stringify({
		source: srcFile,
		output: outPath,
		width: meta.width,
		height: meta.height,
		bytes: st.size
	})
);
