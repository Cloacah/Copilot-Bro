import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (parent of `scripts/`). */
export function resolveRepoRoot(fromImportMetaUrl = import.meta.url) {
	return path.resolve(path.dirname(fileURLToPath(fromImportMetaUrl)), "../..");
}
