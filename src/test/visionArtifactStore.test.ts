import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveVisionArtifact } from "../toolCooperation/visionArtifactStore";

test("saveVisionArtifact writes under vision-artifacts/<evidenceSlug> with evidenceId__taskId__hash16.ext", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "vision-art-"));
	try {
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
		const rec = await saveVisionArtifact({
			rootDir: root,
			evidenceId: "vision:abc123def",
			taskId: "extract-image",
			kind: "png",
			bytes: png
		});
		assert.match(rec.filePath, /vision-artifacts[/\\]vision-abc123def[/\\]/u);
		assert.match(rec.filePath, /vision-abc123def__extract-image__[a-f0-9]{16}\.png$/iu);
		assert.equal(rec.sha256.length, 64);
		assert.ok(rec.byteLength > 0);
		const disk = await readFile(rec.filePath);
		assert.deepEqual(Buffer.from(disk), png);
		assert.doesNotMatch(rec.filePath, /base64|data:image/iu);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("saveVisionArtifact rejects empty bytes", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "vision-art-empty-"));
	try {
		await assert.rejects(
			() => saveVisionArtifact({
				rootDir: root,
				evidenceId: "e1",
				taskId: "t1",
				kind: "svg",
				bytes: ""
			}),
			/must not be empty/u
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
