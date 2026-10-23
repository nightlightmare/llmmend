import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'json/index': 'src/json/index.ts',
    'sse/index': 'src/sse/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'neutral',
  target: 'es2022',
  clean: true,
})
