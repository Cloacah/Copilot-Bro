import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PHASE1_CONFIG_SECTIONS, countVisiblePhase1SettingFields, getVisiblePhase1Sections, isCompatibilityField, sanitizePhase1SectionValue } from "../ui/phase1ConfigUi";

function loadConfigurationProperties(): Record<string, any> {
	const packageJsonPath = path.join(process.cwd(), "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
		contributes?: {
			configuration?: {
				properties?: Record<string, any>;
			};
		};
	};
	return packageJson.contributes?.configuration?.properties ?? {};
}

test("countVisiblePhase1SettingFields matches manual sum", () => {
	let manual = 0;
	for (const section of getVisiblePhase1Sections()) {
		manual += section.fields.length;
	}
	assert.equal(countVisiblePhase1SettingFields(), manual);
	assert.ok(countVisiblePhase1SettingFields() >= 10);
});

test("Phase 1 UI specs account for every schema field", () => {
	const properties = loadConfigurationProperties();
	for (const section of PHASE1_CONFIG_SECTIONS) {
		const schema = properties[`extendedModels.${section.key}`];
		assert.ok(schema, `missing schema for section ${section.key}`);
		const schemaProperties = schema.properties ?? {};
		assert.equal(section.fields.length, Object.keys(schemaProperties).length, `${section.key} field count drifted from schema`);
		for (const field of section.fields) {
			assert.ok(schemaProperties[field.key], `missing schema field ${section.key}.${field.key}`);
		}
	}
});

test("visible Phase 1 UI field specs stay aligned with schema enum and bounds", () => {
	const properties = loadConfigurationProperties();
	for (const section of getVisiblePhase1Sections()) {
		const schemaProperties = properties[`extendedModels.${section.key}`].properties ?? {};
		for (const field of section.fields) {
			const schemaField = schemaProperties[field.key];
			assert.ok(schemaField, `missing schema field for visible UI field ${section.key}.${field.key}`);
			if (field.kind === "select") {
				assert.deepEqual(schemaField.enum, field.options, `${section.key}.${field.key} enum drifted from schema`);
			}
			if (field.kind === "number" && field.minimum !== undefined) {
				assert.equal(schemaField.minimum, field.minimum, `${section.key}.${field.key} minimum drifted from schema`);
			}
			const fieldMaximum = "maximum" in field ? field.maximum : undefined;
			if (field.kind === "number" && fieldMaximum !== undefined) {
				assert.equal(schemaField.maximum, fieldMaximum, `${section.key}.${field.key} maximum drifted from schema`);
			}
		}
	}
});

test("compatibility-only Phase 1 fields are explicitly documented", () => {
	const hiddenFields = PHASE1_CONFIG_SECTIONS.flatMap((section) => section.fields
		.filter((field) => isCompatibilityField(field))
		.map((field) => {
			const hiddenReason = "hiddenReason" in field ? field.hiddenReason?.en ?? "" : "";
			return `${section.key}.${field.key}:${hiddenReason}`;
		}));
	assert.deepEqual(hiddenFields, [
		"visionAgent.dedupeByHash:Compatibility-only alias used for legacy reads; hidden to avoid duplicating the canonical field.",
		"visionProcessing.tokenBudgetMode:Compatibility-only alias used for legacy reads; hidden to avoid duplicating the canonical field."
	]);
});

test("Phase 1 UI sanitizer keeps only visible fields and clamps payloads to schema-like bounds", () => {
	assert.deepEqual(sanitizePhase1SectionValue("visionAgent", {
		enabled: true,
		keepAliveMs: 700000,
		maxBatchSize: 0,
		maxConcurrentBatches: 3,
		deduplicateImages: false,
		dedupeByHash: true,
		autoClosePolicy: "never",
		retryOnFailure: true,
		rogue: "drop-me"
	}), {
		enabled: true,
		keepAliveMs: 600000,
		maxBatchSize: 1,
		maxConcurrentBatches: 3,
		deduplicateImages: false,
		retryOnFailure: true,
		autoClosePolicy: "never"
	});

	assert.deepEqual(sanitizePhase1SectionValue("visionProcessing", {
		chatDebugVisibility: false,
		outputVerbosity: "verbose",
		tokenBudgetMode: "conservative",
		rasterPolicy: "bad-value",
		spatialSchemaVersion: "  v2  "
	}), {
		chatDebugVisibility: false,
		outputVerbosity: "verbose",
		spatialSchemaVersion: "v2"
	});
});