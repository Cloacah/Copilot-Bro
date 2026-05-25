import test from "node:test";
import assert from "node:assert/strict";
import { HOST_UI_MODEL_PROFILE_REGISTRY } from "../e2e/hostUi/chat/hostUiModelProfiles";
import { isTransientProviderFailure } from "../providerTransientErrors";

test("Provider API 429/1305 combined message is transient (stream-phase failures)", () => {
	const message = [
		"Provider API error: [429] Too Many Requests",
		"{\"error\":{\"code\":\"1305\",\"message\":\"该模型当前访问量过大，请您稍后再试\"}}"
	].join("\n");
	assert.equal(isTransientProviderFailure(new Error(message)), true);
});

test("zhipu.vision-native profile includes paid GLM-4.6V fallbacks after free flash", () => {
	const chain = HOST_UI_MODEL_PROFILE_REGISTRY["zhipu.vision-native"];
	assert.deepEqual(chain.slice(0, 3), [
		"glm-4.6v-flash::zhipu",
		"glm-4.6v-flashx::zhipu",
		"glm-4.6v::zhipu"
	]);
});
