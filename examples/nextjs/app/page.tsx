'use client'

import { useState } from 'react'
import type { Recipe, RecipeLine } from './api/recipe/route'

// Renders the recipe while the model writes it: each NDJSON line from the route replaces the
// partial recipe, so ingredients and steps appear one by one.
export default function Page() {
  const [dish, setDish] = useState('pancakes')
  const [recipe, setRecipe] = useState<Partial<Recipe>>({})
  const [status, setStatus] = useState('')

  async function generate() {
    setRecipe({})
    setStatus('Writing…')
    const response = await fetch('/api/recipe', { method: 'POST', body: JSON.stringify({ dish }) })
    if (!response.ok || !response.body) {
      setStatus(`Failed: ${response.status}`)
      return
    }
    let buffer = ''
    for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const message = JSON.parse(line) as RecipeLine
        if ('partial' in message) setRecipe(message.partial)
        else if ('recipe' in message) {
          setRecipe(message.recipe)
          setStatus(`Done (${message.stopReason})`)
        } else setStatus(`Failed: ${message.error}`)
      }
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', fontFamily: 'system-ui' }}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void generate()
        }}
      >
        <input value={dish} onChange={(event) => setDish(event.target.value)} />
        <button type="submit">Write a recipe</button> <span>{status}</span>
      </form>
      <h1>{recipe.title}</h1>
      <ul>
        {recipe.ingredients?.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      <ol>
        {recipe.steps?.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </main>
  )
}
