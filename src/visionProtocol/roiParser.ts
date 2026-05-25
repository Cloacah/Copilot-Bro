import type { BoundingBoxProtocol, ROIRecord } from "./types";

const NUMBER_PATTERN = "[-+]?\\d*\\.?\\d+";

export function parseRoiRecordsFromVisionDescription(input: unknown): ROIRecord[] {
	const structured = parseStructuredRoiRecords(input);
	if (structured.length > 0) {
		return structured;
	}
	if (typeof input === "string") {
		return parseSemiStructuredText(input);
	}
	if (input && typeof input === "object") {
		const record = input as Record<string, unknown>;
		const textFields = [record.description, record.text, record.output, record.content].filter((item): item is string => typeof item === "string");
		for (const textField of textFields) {
			const parsed = parseSemiStructuredText(textField);
			if (parsed.length > 0) {
				return parsed;
			}
		}
	}
	return [];
}

function parseStructuredRoiRecords(input: unknown): ROIRecord[] {
	const candidates = collectCandidates(input);
	const parsed: ROIRecord[] = [];
	for (const candidate of candidates) {
		const roi = parseStructuredRoiRecord(candidate);
		if (roi) {
			parsed.push(roi);
		}
	}
	return parsed;
}

function collectCandidates(input: unknown): unknown[] {
	if (Array.isArray(input)) {
		return input;
	}
	if (!input || typeof input !== "object") {
		return [];
	}
	const record = input as Record<string, unknown>;
	if (Array.isArray(record.rois)) {
		return record.rois;
	}
	if (Array.isArray(record.objects)) {
		return record.objects;
	}
	if (Array.isArray(record.results)) {
		return record.results;
	}
	if (record.roi && typeof record.roi === "object") {
		return [record.roi];
	}
	return [record];
}

function parseStructuredRoiRecord(value: unknown): ROIRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const bbox = parseBBox(record.bbox ?? record.boundingBox ?? record.geometry ?? record.roi ?? record);
	if (!bbox) {
		return undefined;
	}
	const rationale = readString(record.rationale) || readString((record.geometry as Record<string, unknown> | undefined)?.rationale) || "auto";
	const confidence = readNonNegativeNumber(record.confidence ?? (record.geometry as Record<string, unknown> | undefined)?.confidence);
	const rotationDeg = readFiniteNumber(record.rotationDeg ?? (record.geometry as Record<string, unknown> | undefined)?.rotationDeg);
	const targetLabel = readString(record.targetLabel) || readString(record.label);
	return {
		bbox,
		rotationDeg,
		confidence,
		rationale,
		targetLabel
	};
}

function parseSemiStructuredText(text: string): ROIRecord[] {
	const rows = text.split(/\r?\n|;/).map((row) => row.trim()).filter((row) => row.length > 0);
	const parsed: ROIRecord[] = [];
	for (const row of rows) {
		const roi = parseSemiStructuredRow(row);
		if (roi) {
			parsed.push(roi);
		}
	}
	return parsed;
}

function parseSemiStructuredRow(row: string): ROIRecord | undefined {
	const x = extractNumberByKey(row, "x");
	const y = extractNumberByKey(row, "y");
	const w = extractNumberByKey(row, "w") ?? extractNumberByKey(row, "width");
	const h = extractNumberByKey(row, "h") ?? extractNumberByKey(row, "height");
	if (!isNonNegativeNumber(x) || !isNonNegativeNumber(y) || !isNonNegativeNumber(w) || !isNonNegativeNumber(h)) {
		return undefined;
	}
	const confidence = extractNumberByKey(row, "confidence");
	const rotationDeg = extractNumberByKey(row, "rotationDeg") ?? extractNumberByKey(row, "rotation");
	const rationale = extractStringByKey(row, "rationale") || "auto";
	const targetLabel = extractStringByKey(row, "targetLabel") || extractStringByKey(row, "label");
	return {
		bbox: { x, y, w, h },
		confidence: isNonNegativeNumber(confidence) ? confidence : undefined,
		rotationDeg: Number.isFinite(rotationDeg) ? rotationDeg : undefined,
		rationale,
		targetLabel
	};
}

function parseBBox(value: unknown): BoundingBoxProtocol | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (record.bbox && typeof record.bbox === "object" && !Array.isArray(record.bbox)) {
		return parseBBox(record.bbox);
	}
	const x = readNonNegativeNumber(record.x);
	const y = readNonNegativeNumber(record.y);
	const w = readNonNegativeNumber(record.w ?? record.width);
	const h = readNonNegativeNumber(record.h ?? record.height);
	if (!isNonNegativeNumber(x) || !isNonNegativeNumber(y) || !isNonNegativeNumber(w) || !isNonNegativeNumber(h)) {
		return undefined;
	}
	return { x, y, w, h };
}

function extractNumberByKey(text: string, key: string): number | undefined {
	const pattern = new RegExp(`(?:^|[\\s,])${escapeRegExp(key)}\\s*[:=]\\s*(${NUMBER_PATTERN})`, "i");
	const match = text.match(pattern);
	if (!match) {
		return undefined;
	}
	const value = Number.parseFloat(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

function extractStringByKey(text: string, key: string): string | undefined {
	const pattern = new RegExp(`(?:^|[\\s,])${escapeRegExp(key)}\\s*[:=]\\s*([^,]+)`, "i");
	const match = text.match(pattern);
	if (!match) {
		return undefined;
	}
	const value = match[1].trim().replace(/^['\"]|['\"]$/g, "");
	return value.length > 0 ? value : undefined;
}

function readString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}
