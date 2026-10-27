# llmmend

Tools for dependable text at the boundary with an LLM, in both directions: structured values pulled out of model replies, provider streams, text sized for a model's context, and prompts that untrusted input cannot break out of.

## Language

### JSON from replies

**Reply**:
The raw text a model returned, as the user received it, before any processing.
_Avoid_: response, output, completion

**Extraction**:
Locating the JSON inside a Reply and discarding the surrounding text (code fences, preambles, afterwords). Extraction never changes the JSON text itself.
_Avoid_: stripping, unwrapping, cleaning

**Candidate**:
An object or array found in a Reply that parses under the chosen Repair level. Scalars are never Candidates. When a Reply holds several, one is picked.
_Avoid_: match, block, fragment

**Repair**:
Changing the JSON text itself so it parses: fixing syntax the model got wrong or closing structures cut off by truncation. A value is _repaired_ only if Repair happened; Extraction alone does not count.
_Avoid_: fixing, healing, sanitizing

**Truncation**:
A Reply that ends before its JSON does, typically because the model hit its token limit. Closing a truncated value is a kind of Repair, but the result may be missing data the model never wrote.
_Avoid_: cut-off, incomplete, partial (Partial is reserved for in-progress streams)

**Partial value**:
The best current reading of JSON that is still arriving. Finished values in it never change later; only an unfinished string may grow, and unfinished numbers, literals and keys are left out until they finish.
_Avoid_: draft, preview, incomplete value

**Issue**:
A record of one thing Extraction or Repair did to get from the Reply to the value, so the caller can judge how far the result strays from what the model wrote.
_Avoid_: warning, fix, diagnostic

**Tag**:
A named span a model wraps part of its Reply in, like `<answer>…</answer>`, so a program can find that part. Not real XML: no escaping, and the closing tag may differ in case.
_Avoid_: element, XML node, marker

### Streams

**Provider**:
A model API whose streaming wire format llmmend knows how to read. Many vendors share one Provider format (e.g. OpenAI-compatible APIs).
_Avoid_: vendor, backend, model

**Provider adapter**:
The translation from one Provider's stream events into LLM events, created fresh for each stream because it must remember earlier events of that stream.
_Avoid_: mapper, normalizer, driver

**LLM event**:
One provider-neutral unit of a streamed model answer: a piece of text or reasoning, the start or a piece of a tool call, usage, an error, or the end.
_Avoid_: chunk (reserved for text splitting), delta, message

**Stop reason**:
Why a streamed answer ended, in provider-neutral terms: finished, hit the token limit, wants a tool, hit a stop sequence, refused, paused, failed, or unknown.
_Avoid_: finish reason, end reason

**Block**:
One part of a single model answer (text, reasoning or a tool call), numbered by its position in that answer. An answer is one sequence of Blocks; alternative answers to the same request are out of scope.
_Avoid_: content part, choice, segment

**Tool call**:
A Block in which the model asks the application to run a named tool with arguments: JSON for most tools, free-form text for a custom tool. A tool call is usable only when its arguments are complete and, if the tool has a schema, valid against it.
_Avoid_: function call, tool use

### Text for a context window

**Chunk**:
A piece of a text cut to fit a token budget, at the coarsest separator that fits, with its position in the source text. Chunks follow each other without gaps; with overlap, a chunk repeats the end of the previous one.
_Avoid_: split, segment, window

**Overlap**:
The end of the previous Chunk that a Chunk repeats at its start, so that a sentence cut at a boundary still appears whole in one of them.
_Avoid_: stride, context

**Separator**:
A string or pattern a text may be cut after, tried from coarse (headings, paragraphs) to fine (sentences, words, grapheme clusters).
_Avoid_: delimiter, boundary

**Heading path**:
The Markdown headings in effect where a Chunk's own text starts, outermost first: the section a Chunk belongs to, as context for search.
_Avoid_: breadcrumb, section title

### Prompts

**Prompt**:
Text an application sends to a model, assembled from its own template and untrusted input such as documents or user messages.
_Avoid_: instruction, query

**Own tag**:
A Tag the prompt's template itself uses to mark a section (`<document>`, `<instructions>`). Untrusted input must not close or open an Own tag; other tags in it are just content.
_Avoid_: reserved tag, delimiter

**Escaping**:
Making an Own tag in untrusted input harmless by writing its `<` as `&lt;`. Nothing reads it back: the model sees the text with that one character changed.
_Avoid_: sanitizing, encoding

### Failures

**Error kind**:
What went wrong with a model call, in provider-neutral terms: a rate limit, an exhausted quota, overload, a server error, a timeout, a network failure, a prompt over the context window, bad credentials, an invalid request, an abort, or unknown. It decides whether the same request may succeed later.
_Avoid_: error code (Providers' own codes), error type
