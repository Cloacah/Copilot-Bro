import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	HOST_UI_MODEL_PROFILE_REGISTRY,
	resolveHostUiRuntimeModelCandidates
} from "../e2e/hostUi/chat/hostUiModelProfiles";

test("scenario id pins tool-call-model-chat to zhipu.text.tool chain", () => {
	const candidates = resolveHostUiRuntimeModelCandidates({
		id: "tool-call-model-chat",
		requiredApiKeyProvider: "zhipu"
	});
	assert.ok(candidates.includes("glm-5.1::zhipu"));
});

test("host-ui-model-profiles.json mirrors registry keys and chains", async () => {
	const jsonPath = path.join(process.cwd(), "resources", "host-ui-model-profiles.json");
	const raw = JSON.parse(await readFile(jsonPath, "utf8")) as {
		profiles: Record<string, string[]>;
	};
	assert.deepEqual(Object.keys(raw.profiles).sort(), Object.keys(HOST_UI_MODEL_PROFILE_REGISTRY).sort());
	for (const [profileId, expected] of Object.entries(HOST_UI_MODEL_PROFILE_REGISTRY)) {
		assert.deepEqual(raw.profiles[profileId], [...expected], `profile ${profileId}`);
	}
});
