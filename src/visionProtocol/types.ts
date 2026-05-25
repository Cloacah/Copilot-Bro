export interface TextSpanProtocol {
	start: number;
	end: number;
}

export interface BoundingBoxProtocol {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface GeometryProtocol {
	version: string;
	bbox: BoundingBoxProtocol;
	rotationDeg?: number;
	zIndex?: number;
	confidence?: number;
	occlusion?: number;
	textSpan?: TextSpanProtocol;
	rationale: string;
}

export interface VisionObject {
	id: string;
	label: string;
	geometry: GeometryProtocol;
	rationale?: string;
	attributes?: Record<string, unknown>;
}

export interface VisionResult {
	imageRef: string;
	imageHash: string;
	objects: VisionObject[];
	processingMs: number;
	warnings?: string[];
}

export interface VisionBatchResult {
	batchId: string;
	sessionId: string;
	results: VisionResult[];
	totalMs: number;
	failedRefs: string[];
}

export type VisionToolName = "svg_generate" | "image_segment" | "image_cleanup" | "image_export";

export interface ToolProtocolGeometry {
	tool: VisionToolName;
	version: string;
	bbox: BoundingBoxProtocol;
	rationale: string;
	objectId?: string;
	label?: string;
	confidence?: number;
	rotationDeg?: number;
	zIndex?: number;
	occlusion?: number;
	textSpan?: TextSpanProtocol;
	attributes?: Record<string, unknown>;
}

export interface ROIRecord {
	bbox: BoundingBoxProtocol;
	rotationDeg?: number;
	confidence?: number;
	rationale: string;
	targetLabel?: string;
}