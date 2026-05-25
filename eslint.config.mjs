import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: [
			"out",
			"node_modules",
			"*.vsix"
		]
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: [
			"src/**/*.ts"
		],
		languageOptions: {
			globals: {
				console: "readonly",
				process: "readonly"
			},
			parserOptions: {
				project: [
					"./tsconfig.extension.json",
					"./tsconfig.test.json"
				]
			}
		},
		rules: {
			"curly": "error",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					"argsIgnorePattern": "^_",
					"varsIgnorePattern": "^_"
				}
			]
		}
	},
	{
		files: [
			"scripts/**/*.mjs"
		],
		languageOptions: {
			globals: {
				console: "readonly",
				process: "readonly"
			}
		}
	}
);
