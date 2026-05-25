import type { VisionProcessingConfig } from "../types";
import type { OpenAIMessage } from "../types";
import type { ModelCapabilities } from "./toolSelector";

export function needsVision(
	messages: OpenAIMessage[],
	modelCaps: ModelCapabilities,
	config: Pick<VisionProcessingConfig, "needVisionGate"> & { keywords?: string[] } = { needVisionGate: true }
): boolean {
	if (!config.needVisionGate) {
		return false;
	}
	const hasActionableImages = messages.some(hasImagePayload);
	if (!hasActionableImages) {
		return false;
	}
	return modelCaps.nativeVision || modelCaps.proxyVision || modelCaps.wrapperProxyAvailable;
}

function hasImagePayload(message: OpenAIMessage): boolean {
	if (typeof message.content === "string") {
		return containsInlineImageData(message.content);
	}
	if (!Array.isArray(message.content)) {
		return false;
	}
	return message.content.some(
		(part) => part.type === "image_url" || (part.type === "text" && containsInlineImageData(part.text))
	);
}

/** Only inline base64 image payloads count — not file paths or filenames mentioned in agent text. */
function containsInlineImageData(text: string): boolean {
	return /data:image\/[a-z0-9+.-]+;base64,/i.test(text);
}
