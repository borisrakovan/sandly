import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			eqeqeq: ['warn', 'always'],
			// Disabled rules
			'@typescript-eslint/restrict-template-expressions': 'off',
			// The convention is to use types as the default unless you need the extra features of interfaces
			'@typescript-eslint/consistent-type-definitions': 'off',
			// Disabled because we're using noUncheckedIndexedAccess in tsconfig
			'@typescript-eslint/no-non-null-assertion': 'off',

			// Extra rules
			'@typescript-eslint/strict-boolean-expressions': 'error',
			'@typescript-eslint/prefer-nullish-coalescing': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
		},
	},
	{
		files: ['test/**', '**/*.test.ts'],
		rules: {
			'@typescript-eslint/unbound-method': 'off',
			'@typescript-eslint/no-extraneous-class': 'off',
		},
	},
	{
		ignores: ['**/dist/**', 'eslint.config.js', '**/*.local.*'],
	}
);
