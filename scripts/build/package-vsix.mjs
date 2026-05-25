import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stripHostUiSmokeContributes } from "./stripReleaseContributes.mjs";

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");
const originalPackageJson = readFileSync(packageJsonPath, "utf8");
const pkg = JSON.parse(originalPackageJson);
const mode = (process.argv[2] || "release").trim().toLowerCase();

const variants = {
	release: {
		ignoreFile: ".vscodeignore",
		outFile: `${pkg.name}-${pkg.version}.vsix`
	},
	test: {
		ignoreFile: ".vscodeignore.test",
		outFile: `${pkg.name}-${pkg.version}-test.vsix`
	}
};

const selected = variants[mode];
if (!selected) {
	throw new Error(`Unknown VSIX package mode: ${mode}. Expected one of: ${Object.keys(variants).join(", ")}`);
}

if (mode === "release") {
	writeFileSync(packageJsonPath, `${JSON.stringify(stripHostUiSmokeContributes(pkg), null, "\t")}\n`, "utf8");
}

const vsceCli = path.join(root, "node_modules", "@vscode", "vsce", "vsce");
const args = [
	"package",
	"--ignoreFile",
	selected.ignoreFile,
	"--out",
	selected.outFile
];

try {
	execFileSync(process.execPath, [vsceCli, ...args], {
		cwd: root,
		stdio: "inherit"
	});
} finally {
	if (mode === "release") {
		writeFileSync(packageJsonPath, originalPackageJson, "utf8");
	}
}
