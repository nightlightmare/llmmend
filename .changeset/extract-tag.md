---
'llmmend': minor
---

Add `extractTag` and `extractAllTags` to `llmmend/json`, for answers in tags such as `<answer>…</answer>`: attributes are returned, the closing tag may differ in case (new Issue `tag_case_mismatch`), nested tags of the same name match by depth, tags inside fenced code blocks don't count, and a tag cut off after the last closed one is `truncated` with its text so far.
