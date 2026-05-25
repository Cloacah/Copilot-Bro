import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type VisionArtifactKind = "png" | "svg";

export interface VisionArtifactRecord {
	id: string;
	evidenceId: string;
	taskId: string;
	kind: VisionArtifactKind;
	filePath: string;
	sha256: string;
	byteLength: number;
	createdAt: string;
}

export interface SaveVisionArtifactInput {
	rootDir: string;
	evidenceId: string;
	taskId: string;
	kind: VisionArtifactKind;
	bytes: Buffer | Uint8Array | string;
}

export async function saveVisionArtifact(input: SaveVisionArtifactInput, now = new Date()): Promise<VisionArtifactRecord> {
	const bytes = normalizeArtifactBytes(input.bytes);
	if (bytes.length === 0) {
		throw new Error("Vision artifact bytes must not be empty.");
	}
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const evidenceSlug = toArtifactSlug(input.evidenceId);
	const taskSlug = toArtifactSlug(input.taskId);
	const artifactId = `${evidenceSlug}:${taskSlug}:${input.kind}:${sha256.slice(0, 16)}`;
	const fileName = `${evidenceSlug}__${taskSlug}__${sha256.slice(0, 16)}.${input.kind}`;
	const directory = path.join(input.rootDir, "vision-artifacts", evidenceSlug);
	const filePath = path.join(directory, fileName);
	await mkdir(directory, { recursive: true });
	await writeFile(filePath, bytes);
	const persisted = await readFile(filePath);
	const persistedHash = createHash("sha256").update(persisted).digest("hex");
	if (persistedHash !== sha256) {
		throw new Error(`Vision artifact hash mismatch for ${filePath}.`);
	}
	return {
		id: artifactId,
		evidenceId: input.evidenceId,
		taskId: input.taskId,
		kind: input.kind,
		filePath,
		sha256,
		byteLength: bytes.length,
		createdAt: now.toISOString()
	};
}

function normalizeArtifactBytes(value: Buffer | Uint8Array | string): Buffer {
	return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

function toArtifactSlug(value: string): string {
	const slug = value.trim().replace(/[^a-z0-9._-]+/giu, "-").replace(/^-+|-+$/gu, "");
	if (!slug) {
		throw new Error("Vision artifact id parts must not be empty.");
	}
	return slug.slice(0, 120);
}
