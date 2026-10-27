---
'llmmend': minor
---

JSON errors say where: `LlmmendJsonError` gains `at`, `line` and `column` (from 1, counting characters, so an emoji is one), and its message gives the line, the column and a one-line snippet of about 40 characters with a `^` under the place, newlines shown as `⏎`. `extractJson` failures `unparseable` and `truncated` gain `at`.
