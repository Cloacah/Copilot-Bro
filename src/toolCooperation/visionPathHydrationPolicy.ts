export interface ImagePathHydrationPolicy {
	allowNonUserTextPaths: boolean;
}

export interface ImagePathHydrationMessage {
	role?: unknown;
	content: readonly unknown[];
}

export function createImagePathHydrationPolicy(
	messages: readonly Pick<ImagePathHydrationMessage, "content">[]
): ImagePathHydrationPolicy {
	return {
		allowNonUserTextPaths: !messages.some((message) => message.content.some((part) => isImageLikePart(part)))
	};
}

export function shouldHydrateTextPathsForMessage(
	message: Pick<ImagePathHydrationMessage, "role">,
	policy: ImagePathHydrationPolicy
): boolean {
	return policy.allowNonUserTextPaths || String(message.role).trim().toLowerCase() === "user";
}

function isImageLikePart(part: unknown): boolean {
	if (!part || typeof part !== "object") {
		return false;
	}
	const record = part as Record<string, unknown>;
	return typeof record.mimeType === "string"
		&& record.mimeType.startsWith("image/")
		&& record.data !== undefined;
}