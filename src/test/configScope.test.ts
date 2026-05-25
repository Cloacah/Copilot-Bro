import test from "node:test";
import assert from "node:assert/strict";
import {
	buildScopedFieldWrite,
	readMergedObjectFromInspect,
	resolveFieldWriteTarget,
	SCOPED_CONFIG_ROOT_FIELD
} from "../ui/configPanelPersistence";
import { normalizeProviderEndpointsConfig } from "../config/providerEndpoints";

test("readMergedObjectFromInspect shallow-merges fields by scope priority", () => {
	const merged = readMergedObjectFromInspect(
		{
			globalValue: { kimi: "moonshot-global", qwen: "dashscope-intl" },
			workspaceValue: { qwen: "dashscope-cn" }
		},
		normalizeProviderEndpointsConfig
	);
	assert.equal(merged.kimi, "moonshot-global");
	assert.equal(merged.qwen, "dashscope-cn");
});

test("resolveFieldWriteTarget uses the highest scope that already defines the field", () => {
	assert.equal(
		resolveFieldWriteTarget(
			{
				globalValue: { kimi: "moonshot-global" },
				workspaceValue: { qwen: "dashscope-cn" }
			},
			"kimi",
			"workspace",
			true
		),
		"global"
	);
	assert.equal(
		resolveFieldWriteTarget(
			{
				globalValue: { kimi: "moonshot-global" },
				workspaceValue: { kimi: "moonshot-cn", qwen: "dashscope-cn" }
			},
			"kimi",
			"workspace",
			true
		),
		"workspace"
	);
});

test("resolveFieldWriteTarget uses default save scope when field is undefined everywhere", () => {
	assert.equal(resolveFieldWriteTarget(undefined, "kimi", "workspace", true), "workspace");
	assert.equal(resolveFieldWriteTarget(undefined, "kimi", "global", true), "global");
});

test("buildScopedFieldWrite patches one field without dropping sibling fields at the same layer", () => {
	const { value, target } = buildScopedFieldWrite(
		{
			workspaceValue: { qwen: "dashscope-cn" }
		},
		"kimi",
		"moonshot-cn",
		"workspace",
		true,
		normalizeProviderEndpointsConfig
	);
	assert.equal(target, "workspace");
	assert.equal(value.kimi, "moonshot-cn");
	assert.equal(value.qwen, "dashscope-cn");
});

test("buildScopedFieldWrite uses root field for whole-key settings", () => {
	const { target } = buildScopedFieldWrite(
		{ workspaceValue: [] },
		SCOPED_CONFIG_ROOT_FIELD,
		[{ id: "a" }],
		"workspace",
		true,
		(input) => (Array.isArray(input) ? input : [])
	);
	assert.equal(target, "workspace");
});
