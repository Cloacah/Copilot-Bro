export const ALLOWED_ADAPTER_LICENSES = ["MIT", "Apache-2.0"] as const;
export const BLOCKED_ADAPTER_DEPENDENCIES = ["node-potrace", "mobile-ffmpeg"] as const;

export type AdapterLicense = (typeof ALLOWED_ADAPTER_LICENSES)[number] | (string & {});
export type AdapterRuntimeRequirement = "none" | "native-addon" | "wasm";
export type AdapterPerformanceTier = "A" | "B" | "C";
export type SupportedImageFormat = "jpeg" | "png" | "webp";

export interface AdapterCapability {
	name: string;
	license: AdapterLicense;
	runtimeRequirement: AdapterRuntimeRequirement;
	performanceTier: AdapterPerformanceTier;
	fallbackAdapterName?: string;
}

export interface AdapterGeometryBounds {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ImageMetadata {
	width: number;
	height: number;
	channels: number;
}

export interface MlSegmentResult {
	label: string;
	mask: Buffer;
	confidence: number;
	width?: number;
	height?: number;
}

export interface SvgOptimizeOptions {
	plugins?: readonly unknown[];
	multipass?: boolean;
	[jsOption: string]: unknown;
}

export interface SvgOptimizeAdapter {
	capability: AdapterCapability;
	optimize(svgString: string, options?: SvgOptimizeOptions): Promise<string>;
}

export interface ImagePreprocessAdapter {
	capability: AdapterCapability;
	resize(input: Buffer, width: number, height: number): Promise<Buffer>;
	crop(input: Buffer, x: number, y: number, w: number, h: number): Promise<Buffer>;
	toFormat(input: Buffer, format: SupportedImageFormat): Promise<Buffer>;
}

export interface ImageAnalyzeAdapter {
	capability: AdapterCapability;
	getMetadata(input: Buffer): Promise<ImageMetadata>;
	threshold(input: Buffer, value: number): Promise<Buffer>;
}

export interface SvgPathAdapter {
	capability: AdapterCapability;
	normalize(pathData: string): string;
	getBBox(pathData: string): AdapterGeometryBounds;
}

export interface MlSegmentAdapter {
	capability: AdapterCapability;
	segment(input: Buffer): Promise<MlSegmentResult[]>;
}

export interface ImageDataLike {
	width: number;
	height: number;
	data: Uint8ClampedArray;
}

export interface RasterVectorizeOptions {
	ltres?: number;
	qtres?: number;
	numberofcolors?: number;
	pathomit?: number;
}

export interface RasterVectorizeResult {
	svg: string;
	engine: string;
	pathCount: number;
	width: number;
	height: number;
}

export interface RasterVectorizeAdapter {
	capability: AdapterCapability;
	vectorize(buffer: Buffer, options?: RasterVectorizeOptions): Promise<RasterVectorizeResult>;
}