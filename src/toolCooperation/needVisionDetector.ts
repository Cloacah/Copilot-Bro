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
		return containsImageReference(message.content);
	}
	if (!Array.isArray(message.content)) {
		return false;
	}
	return message.content.some((part) => part.type === "image_url" || (part.type === "text" && containsImageReference(part.text)));
}

function containsImageReference(text: string): boolean {
	return /(data:image\/|https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp|svg)|file:\/\/\/[^\s"'<>]+\.(png|jpe?g|gif|webp|bmp|svg)|[A-Za-z]:[\\/][^\s"'<>]+\.(png|jpe?g|gif|webp|bmp|svg)|(?:\.\.?[\\/])?[^\s"'<>]+\.(png|jpe?g|gif|webp|bmp|svg))/i.test(text);
}
