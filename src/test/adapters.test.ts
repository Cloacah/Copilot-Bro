import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { imageJsAdapter } from "../toolCooperation/adapters/imageJsAdapter";
import { jimpAdapter } from "../toolCooperation/adapters/jimpAdapter";
import {
	getAdapterCapabilities,
	getImageAnalyzeAdapter,
	getImagePreprocessAdapter,
	getMlSegmentAdapter,
	getSvgOptimizeAdapter,
	getSvgPathAdapter,
	resetAdapterRegistryForTests,
	setImagePreprocessAdapterOverrideForTests
} from "../toolCooperation/adapters/registry";
import { setSharpAvailabilityForTests, sharpAdapter, sharpAvailable } from "../toolCooperation/adapters/sharpAdapter";
import { svgPathAdapter } from "../toolCooperation/adapters/svgPathAdapter";
import { svgoAdapter } from "../toolCooperation/adapters/svgoAdapter";
import {
	ALLOWED_ADAPTER_LICENSES,
	BLOCKED_ADAPTER_DEPENDENCIES,
	type AdapterCapability
} from "../toolCooperation/adapters/types";

interface SharpMetadataLike {
	width?: number;
	height?: number;
	channels?: number;
}

interface SharpPipelineLike {
	png(): SharpPipelineLike;
	metadata(): Promise<SharpMetadataLike>;
	toBuffer(): Promise<Buffer>;
}

interface SharpCreateInput {
	create: {
		width: number;
		height: number;
		channels: number;
		background: { r: number; g: number; b: number; alpha?: number };
	};
}

type SharpFactoryLike = (input: Buffer | SharpCreateInput) => SharpPipelineLike;

const sharpModule = require("sharp") as SharpFactoryLike | { default?: SharpFactoryLike };
const resolvedSharpFactory = typeof sharpModule === "function" ? sharpModule : sharpModule.default;

if (!resolvedSharpFactory) {
	throw new Error("sharp test dependency is unavailable");
}

const sharpFactory: SharpFactoryLike = resolvedSharpFactory;

const allowedLicenses = new Set<string>(ALLOWED_ADAPTER_LICENSES);
const SIMPLE_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"> <path d=\"M0 0 H20 V20 H0 Z\"/> </svg>";

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

async function createSamplePng(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
	return sharpFactory({
		create: {
			width,
			height,
			channels: 3,
			background: color
		}
	})
		.png()
		.toBuffer();
}

async function readDimensions(input: Buffer): Promise<{ width: number; height: number }> {
	const metadata = await sharpFactory(input).metadata();
	return {
		width: metadata.width ?? 0,
		height: metadata.height ?? 0
	};
}

function readLicense(packageName: string): string {
	const packageJsonPath = path.resolve(__dirname, "../../node_modules", packageName, "package.json");
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { license?: string };
	return packageJson.license ?? "";
}

test("adapter contracts expose allowlisted capabilities and stable registry surfaces", () => {
	const adapters = [svgoAdapter, sharpAdapter, jimpAdapter, imageJsAdapter, svgPathAdapter];
	for (const adapter of adapters) {
		const capability = adapter.capability as AdapterCapability;
		assert.ok(capability.name.length > 0);
		assert.ok(allowedLicenses.has(capability.license));
		assert.ok(["none", "native-addon", "wasm"].includes(capability.runtimeRequirement));
		assert.ok(["A", "B", "C"].includes(capability.performanceTier));
	}
	assert.deepEqual(getAdapterCapabilities().map((capability) => capability.name).sort(), [
		"image-js",
		"jimp",
		"sharp",
		"svg-path-commander",
		"svgo"
	]);
	assert.equal(getSvgOptimizeAdapter(), svgoAdapter);
	assert.equal(getImageAnalyzeAdapter(), imageJsAdapter);
	assert.equal(getSvgPathAdapter(), svgPathAdapter);
	assert.equal(getImagePreprocessAdapter(), sharpAvailable ? sharpAdapter : jimpAdapter);
	assert.equal(getMlSegmentAdapter({ mlSegment: false }), null);
});

test("golden adapter outputs stay structurally valid", async () => {
	const optimizedSvg = await getSvgOptimizeAdapter().optimize(SIMPLE_SVG);
	assert.equal(
		normalizeWhitespace(optimizedSvg),
		"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><path d=\"M0 0h20v20H0Z\"/></svg>"
	);

	const samplePng = await createSamplePng(20, 20, { r: 255, g: 255, b: 255 });
	assert.deepEqual(await getImageAnalyzeAdapter().getMetadata(samplePng), {
		width: 20,
		height: 20,
		channels: 3
	});

	const thresholded = await getImageAnalyzeAdapter().threshold(samplePng, 128);
	const thresholdMetadata = await readDimensions(thresholded);
	assert.equal(thresholdMetadata.width, 20);
	assert.equal(thresholdMetadata.height, 20);

	assert.equal(getSvgPathAdapter().normalize("M10 90s20 -80 40 -80s20 80 40 80"), "M10 90C10 90 30 10 50 10C70 10 70 90 90 90");
	assert.deepEqual(getSvgPathAdapter().getBBox("M10 10H30V30H10Z"), {
		x: 10,
		y: 10,
		w: 20,
		h: 20
	});
});

test("registry falls back to jimp when sharp is unavailable and keeps resize semantics", async () => {
	const samplePng = await createSamplePng(40, 40, { r: 0, g: 255, b: 0 });
	const sharpBaseline = await sharpAdapter.resize(samplePng, 20, 20);
	const sharpDimensions = await readDimensions(sharpBaseline);

	try {
		setSharpAvailabilityForTests(false);
		assert.equal(getImagePreprocessAdapter(), jimpAdapter);

		const fallbackOutput = await getImagePreprocessAdapter().resize(samplePng, 20, 20);
		const fallbackDimensions = await readDimensions(fallbackOutput);

		assert.deepEqual(sharpDimensions, { width: 20, height: 20 });
		assert.deepEqual(fallbackDimensions, sharpDimensions);
	} finally {
		resetAdapterRegistryForTests();
	}
});

test("preprocess registry override remains replaceable with jimp", async () => {
	const samplePng = await createSamplePng(40, 40, { r: 0, g: 0, b: 255 });

	try {
		setImagePreprocessAdapterOverrideForTests(jimpAdapter);
		const output = await getImagePreprocessAdapter().crop(samplePng, 10, 10, 20, 20);
		assert.deepEqual(await readDimensions(output), { width: 20, height: 20 });
	} finally {
		resetAdapterRegistryForTests();
	}
});

test("adapter dependency licenses stay compliant and blocked libraries remain absent", () => {
	for (const packageName of ["svgo", "sharp", "image-js", "svg-path-commander", "jimp"]) {
		assert.ok(allowedLicenses.has(readLicense(packageName)));
	}
	for (const blockedDependency of BLOCKED_ADAPTER_DEPENDENCIES) {
		assert.equal(fs.existsSync(path.resolve(__dirname, "../../node_modules", blockedDependency)), false);
	}
});