import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        // Never lint tooling output or the Claude skill's Node CLIs (they run
        // under Node, not the browser).
        ignores: ['node_modules/**', 'coverage/**', '.claude/**'],
    },
    js.configs.recommended,
    {
        // The extension ships as browser ES modules loaded by SillyTavern.
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                // Injected by SillyTavern at runtime (see SillyTavern.getContext()).
                SillyTavern: 'readonly',
                toastr: 'readonly',
            },
        },
        rules: {
            // A catch that intentionally swallows (best-effort refresh, liveness probe)
            // is a deliberate pattern here, so allow an empty catch body.
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Warn (don't fail) on unused symbols; allow underscore-prefixed throwaways.
            'no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        // Unit tests run under Node/Vitest rather than the browser.
        files: ['test/**/*.js'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
];
