// A Worker that runs the smoke checks against the built ESM `dist`.
import * as root from '../../dist/index.js'
import * as json from '../../dist/json/index.js'
import * as sse from '../../dist/sse/index.js'
import * as chunk from '../../dist/chunk/index.js'
import { checks } from '../smoke-checks.mjs'

const modules = { '.': root, './json': json, './sse': sse, './chunk': chunk }

export default {
  async fetch() {
    try {
      for (const [subpath, check] of Object.entries(checks)) await check(modules[subpath])
      return new Response(`smoke ok (workers): ${Object.keys(checks).join(', ')}`)
    } catch (error) {
      return new Response(String(error?.stack ?? error), { status: 500 })
    }
  },
}
