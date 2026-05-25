import type { Window } from "node-window-manager";

/** Minimum interval between foreground recovery attempts during log-driven waits. */
export const SMOKE_FOCUS_RECOVER_INTERVAL_MS = 8_000;

export function isSmokeWindowForegroundMatch(foregroundTitle: string, targetTitle: string): boolean {
	const fg = foregroundTitle.toLowerCase().trim();
	const target = targetTitle.toLowerCase().trim();
	if (!fg) {
		return false;
	}
	if (fg.includes("visual studio code")) {
		return true;
	}
	if (target && (fg.includes(target) || target.includes(fg))) {
		return true;
	}
	return false;
}

export type SmokeFocusKeeper = {
	maybeRecover: (force?: boolean) => Promise<void>;
};

export type SmokeFocusDeps = {
	getForegroundTitle: () => string;
	focusWindow: (window: Window, maximize?: boolean) => Promise<void>;
};

export function createSmokeFocusKeeper(
	window: Window,
	label: string,
	deps: SmokeFocusDeps
): SmokeFocusKeeper {
	let lastRecoverAt = 0;
	return {
		async maybeRecover(force = false): Promise<void> {
			const now = Date.now();
			if (!force && now - lastRecoverAt < SMOKE_FOCUS_RECOVER_INTERVAL_MS) {
				return;
			}
			const targetTitle = window.getTitle();
			const foregroundTitle = deps.getForegroundTitle();
			if (!force && isSmokeWindowForegroundMatch(foregroundTitle, targetTitle)) {
				return;
			}
			lastRecoverAt = now;
			console.log(
				JSON.stringify({
					type: "host-ui-smoke.focus.recovered",
					label,
					previousForeground: foregroundTitle.slice(0, 160),
					targetTitle: targetTitle.slice(0, 160),
					forced: force
				})
			);
			await deps.focusWindow(window, true);
		}
	};
}
