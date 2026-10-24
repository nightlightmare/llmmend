// Share links keep the whole playground state in the URL hash, deflated and base64url-encoded.
// The hash never reaches the server, so a shared reply stays between the people who have the link.

/** What a link restores: the input and the value of every option, by element id. */
export interface State {
  input: string
  options: Record<string, string>
}

/** Above this, a link gets unwieldy in chats and issue forms. */
export const MAX_HASH = 8192

const PREFIX = 's='

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

/** The hash for `state` (without `#`), or undefined when it would exceed MAX_HASH. */
export async function encodeState(state: State): Promise<string | undefined> {
  const json = new TextEncoder().encode(JSON.stringify(state))
  const hash = PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))
  return hash.length > MAX_HASH ? undefined : hash
}

/** The state in `hash` (with or without `#`), or undefined when it holds none or is damaged. */
export async function decodeState(hash: string): Promise<State | undefined> {
  const body = hash.replace(/^#/, '')
  if (!body.startsWith(PREFIX)) return undefined
  try {
    const bytes = await pipe(
      fromBase64Url(body.slice(PREFIX.length)),
      new DecompressionStream('deflate-raw'),
    )
    const state: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (
      typeof state === 'object' &&
      state !== null &&
      typeof (state as State).input === 'string' &&
      typeof (state as State).options === 'object' &&
      (state as State).options !== null
    )
      return state as State
  } catch {
    // A truncated or edited link: start from the default example instead.
  }
  return undefined
}
