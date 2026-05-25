import { readFileSync, writeFileSync } from "node:fs";

const transcript = readFileSync(
	"C:/Users/onemt/.cursor/projects/d-Workspace-Extended-Models-For-Copilot/agent-transcripts/5a403f32-b061-4459-9e22-f100b930e8e9/5a403f32-b061-4459-9e22-f100b930e8e9.jsonl",
	"utf8"
);

function unescapeJsonFragment(raw) {
	return raw
		.replace(/\\r\\n/g, "\n")
		.replace(/\\n/g, "\n")
		.replace(/\\t/g, "\t")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");
}

function stripToolJsonNoise(text) {
	let out = text;
	for (;;) {
		const next = out.replace(/\}\}\],\{"type":"tool_use"[\s\S]*?(?=\nexport |\nasync function |\nfunction )/g, "\n");
		if (next === out) {
			break;
		}
		out = next;
	}
	return out.replace(/\}\}\],\{"type":"tool_use"[\s\S]*$/g, "").trim();
}

const hydrateIdx = transcript.lastIndexOf("hydrateImagePartsFromTextPathsForSmoke");
const structuredIdx = transcript.lastIndexOf("async function resolveStructuredProxyDescription");
const nativeIdx = transcript.lastIndexOf("export async function resolveNativeVisionStructuredMessages");
const isEnabledIdx = transcript.lastIndexOf("export function isVisionProxyEnabledForModel");

let helpers = stripToolJsonNoise(unescapeJsonFragment(transcript.slice(hydrateIdx - 120_000, structuredIdx)));
const cut = helpers.indexOf("async function resolveStructuredProxyDescription");
if (cut > 0) {
	helpers = helpers.slice(0, cut).trim();
}

let native = "";
if (nativeIdx > 0 && isEnabledIdx > nativeIdx) {
	native = stripToolJsonNoise(unescapeJsonFragment(transcript.slice(nativeIdx, isEnabledIdx))).trim();
}

const header = readFileSync("scripts/dev/vision-proxy-routing-header.ts", "utf8");

writeFileSync("src/visionProxy.ts", `${header}\n${helpers}\n\n${native}\n`);
const all = `${header}\n${helpers}\n\n${native}\n`;
console.log({
	lines: all.split(/\n/).length,
	hasProxy: all.includes("resolveVisionProxyMessages"),
	hasNative: all.includes("resolveNativeVisionStructuredMessages"),
	hasHydrateSmoke: all.includes("hydrateImagePartsFromTextPathsForSmoke")
});
