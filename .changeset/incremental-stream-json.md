---
'llmmend': patch
---

`streamJson` parses incrementally: a text event costs about its own length instead of re-parsing the whole Reply, so a Reply of 100 kB streams in tens of milliseconds instead of seconds to minutes. Every yielded item is the same as before; successive `partial` values now share the parts that ended, so treat them as read-only. A cut-off `-Inf` (for `-Infinity`) is now a Truncation, like a cut-off `tru`, instead of failing the value. The parser grows by about 0.35 kB (min+brotli), `streamJson` by about 1 kB.
