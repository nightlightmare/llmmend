---
'llmmend': minor
---

New option `coerce` on `extractJson`, `extractJsonAsync`, `extractAllJson` and `streamJson`, and for tool arguments on `collectText` and `streamToolCalls`: when the schema rejects a value, it tries the type slips models make (`"42"` ↔ `42`, `"true"` ↔ `true`, `"null"` → `null`) at the paths the schema's issues name, and keeps a change only when the issue at that path goes away. Each change is a new Issue `coerced` with the path and the types before and after. It works the same with Zod, Valibot and ArkType: only the issues' paths are read, never their messages.
