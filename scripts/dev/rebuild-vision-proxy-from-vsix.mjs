/**
 * Rebuild src/visionProxy.ts routing layer from Host UI smoke VSIX out/visionProxy.js
 * (lines 80–1001). Structured pass lives in visionStructuredPass.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const vsixJs = readFileSync(
	join(
		root,
		"artifacts/host-ui/HostUiSmokeExtensions/cloacah.copilot-bro-0.1.9/out/visionProxy.js"
	),
	"utf8"
);
const header = readFileSync(join(root, "scripts/dev/vision-proxy-routing-header.ts"), "utf8").trimEnd();

const lines = vsixJs.split("\n");
/** 1-based inclusive line ranges from visionProxy.js */
const routingBody = lines.slice(79, 1001).join("\n");

function jsToTs(body) {
	let out = body;
	const moduleMap = {
		visionPathHydrationPolicy_1: "",
		visionMessageScan_1: "",
		visionHandoffIntent_1: "",
		outputSemantics_1: "",
		visionProxyStructuredSnapshot_1: "",
		visionProxyStructuredPlan_1: "",
		visionProxyPolicy_1: "",
		visionProxyModelSelection_1: "",
		settings_1: "",
		visionEvidenceStore_1: "",
		visionTaskStack_1: "",
		visionArtifactStore_1: "",
		imageMime_1: "",
		node_crypto_1: "",
		node_path_1: "",
		node_url_1: "",
		promises_1: "",
		node_fs_1: ""
	};
	for (const [mod] of Object.entries(moduleMap)) {
		out = out.replace(new RegExp(`\\(0, ${mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\w+)\\)`, "g"), "$1");
	}
	out = out
		.replace(/\boutputSemantics_1\.(\w+)/g, "$1")
		.replace(/\bvisionProxyStructuredPlan_1\.(\w+)/g, "$1")
		.replace(/\bvisionProxyStructuredSnapshot_1\.(\w+)/g, "$1")
		.replace(/\bnode_path_1\./g, "")
		.replace(/\bpromises_1\./g, "")
		.replace(/\bnode_fs_1\./g, "")
		.replace(/\bnode_crypto_1\./g, "")
		.replace(/\bnode_url_1\./g, "")
		.replace(/\bimageMime_1\./g, "")
		.replace(/\bvisionArtifactStore_1\./g, "")
		.replace(/await resolveStructuredProxyDescription\(/g, "await resolveStructuredProxyDescription(")
		.replace(/await resolveStructuredNativeDescription\(/g, "await resolveStructuredNativeDescription(");

	// Drop duplicate snapshot helper (import from visionProxyStructuredSnapshot).
	out = out.replace(
		/function extractNormalizedProxySnapshotJson\(description\) \{[\s\S]*?\n\}/,
		""
	);

	// Remove inlined native (replaced by _native_block.ts).
	out = out.replace(
		/\/\*\* On-model high-fidelity[\s\S]*?^}\n(?=function isVisionProxyEnabledForModel)/m,
		""
	);

	const exportFns = [
		"resolveVisionProxyMessages",
		"isVisionProxyEnabledForModel",
		"hydrateImagePartsFromTextPathsForSmoke"
	];
	for (const name of exportFns) {
		out = out.replace(new RegExp(`^async function ${name}\\(`, "m"), `export async function ${name}(`);
		out = out.replace(new RegExp(`^function ${name}\\(`, "m"), `export function ${name}(`);
	}

	// Types for public APIs
	out = out.replace(
		/^export async function resolveVisionProxyMessages\(messages, model, settings, logger, token, options = \{\}\)/m,
		"export async function resolveVisionProxyMessages(\n\tmessages: readonly vscode.LanguageModelChatRequestMessage[],\n\tmodel: ModelConfig,\n\tsettings: ExtensionSettings,\n\tlogger: Logger,\n\ttoken: vscode.CancellationToken,\n\toptions: ResolveVisionProxyOptions = {}\n): Promise<VisionProxyResolution>"
	);
	out = out.replace(
		/^export function isVisionProxyEnabledForModel\(model, settings\)/m,
		"export function isVisionProxyEnabledForModel(model: ModelConfig, settings: ExtensionSettings): boolean"
	);

	return out.trim();
}

const extraImports = `
import { resolveImageMimeType } from "./toolCooperation/imageMime";
import { saveVisionArtifact } from "./toolCooperation/visionArtifactStore";
import { extractNormalizedProxySnapshotJson } from "./visionProxyStructuredSnapshot";
`.trim();

const headerWithImports = header.includes("extractNormalizedProxySnapshotJson")
	? header
	: header.replace(
			'from "./visionProxyStructuredSnapshot";',
			`from "./visionProxyStructuredSnapshot";
import { extractNormalizedProxySnapshotJson } from "./visionProxyStructuredSnapshot";
import { resolveImageMimeType } from "./toolCooperation/imageMime";
import { saveVisionArtifact } from "./toolCooperation/visionArtifactStore";`
		);

// Fix duplicate import if we inserted twice
const fixedHeader = headerWithImports
	.replace(
		/import \{ buildStructuredProxyProgressFromDescription \} from "\.\/visionProxyStructuredSnapshot";\nimport \{ extractNormalizedProxySnapshotJson \}/,
		`import {
	buildStructuredProxyProgressFromDescription,
	extractNormalizedProxySnapshotJson
}`
	)
	.replace(
		/import \{ extractNormalizedProxySnapshotJson \} from "\.\/visionProxyStructuredSnapshot";\nimport \{ resolveImageMimeType \}/,
		`import { resolveImageMimeType }`
	);

let body = jsToTs(routingBody);
// patch header imports cleanly
const headerLines = fixedHeader.split("\n");
const snapshotImportIdx = headerLines.findIndex((l) => l.includes("visionProxyStructuredSnapshot"));
if (snapshotImportIdx >= 0 && !headerLines[snapshotImportIdx].includes("extractNormalizedProxySnapshotJson")) {
	headerLines[snapshotImportIdx] = `import {
	buildStructuredProxyProgressFromDescription,
	extractNormalizedProxySnapshotJson
} from "./visionProxyStructuredSnapshot";`;
	const insertAt = snapshotImportIdx + 1;
	if (!headerLines.some((l) => l.includes("imageMime"))) {
		headerLines.splice(insertAt, 0, 'import { resolveImageMimeType } from "./toolCooperation/imageMime";');
		headerLines.splice(insertAt + 1, 0, 'import { saveVisionArtifact } from "./toolCooperation/visionArtifactStore";');
	}
}

const finalHeader = headerLines.join("\n");

const out = `${finalHeader}\n\n${body}\n`;
writeFileSync(join(root, "src/visionProxy.ts"), out);
console.log("wrote visionProxy.ts", out.split("\n").length, "lines");
