import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // We only unit-test the pure logic (tag-analysis.js), which has no DOM or
        // SillyTavern dependencies, so a plain Node environment is enough.
        environment: 'node',
        include: ['test/**/*.test.js'],
    },
});
