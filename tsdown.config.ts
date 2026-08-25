import { defineConfig } from 'tsdown'
import { browserBundle } from './tsdown.shared.ts'

/** Dev build: node entry (host half) + the closure-factory browser bundle. */
export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    tsconfig: 'tsconfig.prepare.json',
    external: [/@deepseek-ai\//],
  },
  browserBundle('dsh-llm-quotes', 'src/client/index.ts'),
])
