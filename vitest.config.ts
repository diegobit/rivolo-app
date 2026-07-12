import { mergeConfig } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      clearMocks: true,
      restoreMocks: true,
      // Agentic-QA runs write throwaway *.test.ts probes under this path; keep
      // them out of `npm test` (.gitignore alone does not, since vitest
      // discovers by glob, not git status).
      exclude: [...configDefaults.exclude, 'tests/agentic-qa-tests/**'],
    },
  }),
)
