import type { VisionProcessingConfig } from "../../types";
import { imageJsAdapter } from "./imageJsAdapter";
import { jimpAdapter } from "./jimpAdapter";
import { sharpAdapter, setSharpAvailabilityForTests, sharpAvailable } from "./sharpAdapter";
import { svgPathAdapter } from "./svgPathAdapter";
import { svgoAdapter } from "./svgoAdapter";
import type {
	AdapterCapability,
	ImageAnalyzeAdapter,
	ImagePreprocessAdapter,
	MlSegmentAdapter,
	SvgOptimizeAdapter,
	SvgPathAdapter
} from "./types";

const registeredAdapters = {
	svgo: svgoAdapter,
	sharp: sharpAdapter,
	jimp: jimpAdapter,
	"image-js": imageJsAdapter,
	"svg-path-commander": svgPathAdapter
} as const;

let imagePreprocessAdapterOverride: ImagePreprocessAdapter | null = null;
let mlSegmentAdapterOverride: MlSegmentAdapter | null | undefined;

export function getRegisteredAdapterCapabilities(): AdapterCapability[] {
	return Object.values(registeredAdapters).map((adapter) => adapter.capability);
}

export const getAdapterCapabilities = getRegisteredAdapterCapabilities;

export function getSvgOptimizeAdapter(): SvgOptimizeAdapter {
	return registeredAdapters.svgo;
}

export function getImagePreprocessAdapter(): ImagePreprocessAdapter {
	if (imagePreprocessAdapterOverride) {
		return imagePreprocessAdapterOverride;
	}
	return sharpAvailable ? registeredAdapters.sharp : registeredAdapters.jimp;
}

export function getImageAnalyzeAdapter(): ImageAnalyzeAdapter {
	return registeredAdapters["image-js"];
}

export function getSvgPathAdapter(): SvgPathAdapter {
	return registeredAdapters["svg-path-commander"];
}

export function getMlSegmentAdapter(
	config: Pick<VisionProcessingConfig, "mlSegment"> = { mlSegment: false }
): MlSegmentAdapter | null {
	if (mlSegmentAdapterOverride !== undefined) {
		return mlSegmentAdapterOverride;
	}
	return config.mlSegment ? null : null;
}

export function setImagePreprocessAdapterOverrideForTests(adapter: ImagePreprocessAdapter | null): void {
	imagePreprocessAdapterOverride = adapter;
}

export function setMlSegmentAdapterOverrideForTests(adapter: MlSegmentAdapter | null | undefined): void {
	mlSegmentAdapterOverride = adapter;
}

export function resetAdapterRegistryForTests(): void {
	imagePreprocessAdapterOverride = null;
	mlSegmentAdapterOverride = undefined;
	setSharpAvailabilityForTests(undefined);
}