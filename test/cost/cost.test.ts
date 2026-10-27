import { describe, expect, it } from 'vitest'
import { estimateCost, type Prices, toUsage } from '../../src/cost/index'

const sonnet: Prices = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }

describe('estimateCost', () => {
  it('prices uncached input, cache reads and writes, and output per million tokens', () => {
    const cost = estimateCost(
      { inputTokens: 10_000, cacheReadTokens: 6_000, cacheWriteTokens: 2_000, outputTokens: 1_000 },
      sonnet,
    )
    expect(cost).toEqual({
      total: expect.closeTo(0.0018 + 0.0075 + 0.006 + 0.015, 12),
      input: expect.closeTo(0.006, 12),
      cacheRead: expect.closeTo(0.0018, 12),
      cacheWrite: expect.closeTo(0.0075, 12),
      output: expect.closeTo(0.015, 12),
    })
    expect(cost).not.toHaveProperty('missing')
  })

  it('prices cached tokens as input when the cache prices are left out', () => {
    const cost = estimateCost(
      {
        inputTokens: 1_000_000,
        cacheReadTokens: 400_000,
        cacheWriteTokens: 100_000,
        outputTokens: 0,
      },
      { input: 2, output: 8 },
    )
    expect(cost).toMatchObject({ input: 1, cacheRead: 0.8, cacheWrite: 0.2, total: 2 })
  })

  it('applies the highest tier below the input tokens to the whole call', () => {
    const prices: Prices = {
      input: 1.25,
      output: 10,
      cacheRead: 0.125,
      tiers: [
        { above: 200_000, input: 2.5, output: 15 },
        { above: 100_000, input: 2 },
      ],
    }
    const usage = (inputTokens: number) => ({ inputTokens, cacheReadTokens: 0, outputTokens: 1e6 })
    expect(estimateCost(usage(100_000), prices)).toMatchObject({ input: 0.125, output: 10 })
    expect(estimateCost(usage(200_000), prices)).toMatchObject({ input: 0.4, output: 10 })
    expect(estimateCost(usage(150_000), prices)).toMatchObject({ input: 0.3, output: 10 })
    expect(estimateCost(usage(1_000_000), prices)).toMatchObject({ input: 2.5, output: 15 })
    // A price the tier leaves out comes from the base prices.
    const cached = estimateCost({ inputTokens: 300_000, cacheReadTokens: 200_000 }, prices)
    expect(cached.cacheRead).toBeCloseTo(0.025, 12)
  })

  it('lists missing input or output counts and costs them as 0', () => {
    // An Anthropic stream cut off after `message_start`: input, no output.
    expect(estimateCost({ inputTokens: 1_000_000 }, sonnet)).toEqual({
      total: 3,
      input: 3,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      missing: ['output'],
    })
    expect(estimateCost({}, sonnet)).toMatchObject({ total: 0, missing: ['input', 'output'] })
  })

  it('never prices uncached input below zero', () => {
    const cost = estimateCost({ inputTokens: 10, cacheReadTokens: 20, outputTokens: 0 }, sonnet)
    expect(cost.input).toBe(0)
  })
})

describe('toUsage', () => {
  it('adds Anthropic’s cached tokens to the input', () => {
    const raw = {
      input_tokens: 100,
      cache_read_input_tokens: 5_000,
      cache_creation_input_tokens: 0,
      output_tokens: 300,
    }
    expect(toUsage(raw)).toEqual({
      inputTokens: 5_100,
      outputTokens: 300,
      cacheReadTokens: 5_000,
      cacheWriteTokens: 0,
    })
  })

  it('treats Anthropic’s null cache counts as absent', () => {
    const raw = { input_tokens: 12, cache_read_input_tokens: null, output_tokens: 3 }
    expect(toUsage(raw)).toEqual({ inputTokens: 12, outputTokens: 3 })
  })

  it('reads OpenAI Chat Completions usage', () => {
    const raw = {
      prompt_tokens: 2_000,
      completion_tokens: 500,
      total_tokens: 2_500,
      prompt_tokens_details: { cached_tokens: 1_024, audio_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 320 },
    }
    expect(toUsage(raw)).toEqual({
      inputTokens: 2_000,
      outputTokens: 500,
      cacheReadTokens: 1_024,
      reasoningTokens: 320,
    })
  })

  it('reads OpenAI Responses usage', () => {
    const raw = {
      input_tokens: 2_000,
      input_tokens_details: { cached_tokens: 1_024 },
      output_tokens: 500,
      output_tokens_details: { reasoning_tokens: 320 },
      total_tokens: 2_500,
    }
    expect(toUsage(raw)).toEqual({
      inputTokens: 2_000,
      outputTokens: 500,
      cacheReadTokens: 1_024,
      reasoningTokens: 320,
    })
  })

  it('reads Gemini usageMetadata, thoughts counted as output', () => {
    const raw = {
      promptTokenCount: 900,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 50,
      cachedContentTokenCount: 600,
      totalTokenCount: 1_050,
    }
    expect(toUsage(raw)).toEqual({
      inputTokens: 900,
      outputTokens: 150,
      cacheReadTokens: 600,
      reasoningTokens: 50,
    })
  })

  it('reads plain input and output tokens the same for Anthropic and Responses', () => {
    expect(toUsage({ input_tokens: 10, output_tokens: 2 })).toEqual({
      inputTokens: 10,
      outputTokens: 2,
    })
  })

  it('gives {} for an unknown shape, so estimateCost reports what is missing', () => {
    for (const raw of [undefined, null, 42, 'usage', {}, { tokens: 5 }])
      expect(toUsage(raw)).toEqual({})
    expect(estimateCost(toUsage(undefined), sonnet).missing).toEqual(['input', 'output'])
  })
})
