import { normalizeGeometry } from "./normalizer";
import type { GeometryProtocol, ToolProtocolGeometry, VisionObject, VisionToolName } from "./types";

export function mapGeometryToToolPayload(tool: VisionToolName, geometry: GeometryProtocol, extra?: {
	objectId?: string;
	label?: string;
	attributes?: Record<string, unknown>;
}): ToolProtocolGeometry {
	const normalized = normalizeGeometry(geometry);
	return {
		tool,
		version: normalized.version,
		bbox: normalized.bbox,
		rationale: normalized.rationale,
		objectId: extra?.objectId,
		label: extra?.label,
		confidence: normalized.confidence,
		rotationDeg: normalized.rotationDeg,
		zIndex: normalized.zIndex,
		occlusion: normalized.occlusion,
		textSpan: normalized.textSpan,
		attributes: extra?.attributes
	};
}

export function mapVisionObjectToToolPayload(tool: VisionToolName, object: VisionObject): ToolProtocolGeometry {
	return mapGeometryToToolPayload(tool, object.geometry, {
		objectId: object.id,
		label: object.label,
		attributes: object.attributes
	});
}

export function mapToolPayloadToVisionObject(payload: ToolProtocolGeometry): VisionObject {
	const geometry = normalizeGeometry(payload);
	return {
		id: payload.objectId?.trim() || payload.tool,
		label: payload.label?.trim() || payload.tool,
		geometry,
		rationale: payload.rationale.trim() || geometry.rationale,
		attributes: payload.attributes
	};
}