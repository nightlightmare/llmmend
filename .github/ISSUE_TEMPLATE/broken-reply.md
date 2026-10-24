---
name: Broken reply
about: A model reply that llmmend cannot extract or repair correctly
labels: needs-triage
---

<!-- Accepted replies become test fixtures in the public repo: remove anything private first. -->

**Version:** <!-- e.g. 0.1.0 -->
**Model:** <!-- e.g. claude-opus-5-5, gpt-5-mini, qwen2.5:3b -->

**Playground link:** <!-- optional: paste the reply at https://nightlightmare.github.io/llmmend/, press Share and paste the link here -->

**Raw reply** (exactly as the model returned it, including the text around the JSON)

````text

````

**Call and options**

```ts
extractJson(reply, { /* options used, e.g. repair: 'syntax', pick: 'first' */ })
```

**Expected value**

```json

```

**What llmmend returned** (the result or the error, with `issues`)

```json

```
