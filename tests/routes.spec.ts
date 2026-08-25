import { describe, expect, it } from 'vitest'
import { LlmRatesService } from '../src/llmrates.ts'
import { makeLlmQuotesRoutes } from '../src/server/routes.ts'
import { LlmQuotesStore } from '../src/server/store.ts'

describe('makeLlmQuotesRoutes', () => {
  it('does not register the same exact path twice', () => {
    const routes = makeLlmQuotesRoutes(new LlmRatesService(), new LlmQuotesStore())
    const paths = routes
      .filter((route) => route.kind === 'exact')
      .map((route) => route.path)
    expect(new Set(paths).size).toBe(paths.length)
    // Watch/alerts endpoints were removed with the watch feature.
    expect(paths).not.toContain('/api/llm-quotes/watch')
    expect(paths).not.toContain('/api/llm-quotes/alerts')
    expect(paths).toContain('/api/llm-quotes/settings')
    expect(paths).toContain('/api/llm-quotes/associations')
    expect(paths).toContain('/api/llm-quotes/provider-models')
  })
})