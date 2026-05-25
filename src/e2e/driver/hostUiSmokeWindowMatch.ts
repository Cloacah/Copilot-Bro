export function isHostUiSmokeWindowTitle(title: string, workspaceTitleHint = ""): boolean {
	if (!title.includes("Visual Studio Code")) {
		return false;
	}
	const normalizedHint = workspaceTitleHint.trim();
	return (normalizedHint.length > 0 && title.includes(normalizedHint)) || /HostUiSmokeWorkspace-\d+/u.test(title);
}

/** Exact titles for disposable VS Code welcome windows the smoke harness may Alt+F4-dismiss. */
export function isSmokeVscodeWelcomeWindowTitle(title: string): boolean {
	const trimmed = title.trim();
	return trimmed === "Welcome - Visual Studio Code" || trimmed === "Getting Started - Visual Studio Code";
}
