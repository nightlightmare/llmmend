---
'llmmend': minor
---

New module `llmmend/prompt`: `safePrompt`, a template tag that escapes each substitution for the tags the template itself uses, so untrusted text can't close `<document>` or open `<instructions>`; `trusted` to insert a built prompt as is; and `escapeTags` for the same escaping without a template.
