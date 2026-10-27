// Sends a request to Claude in Amazon Bedrock's Messages API endpoint (bedrock-mantle), signed with
// the AWS CLI's credentials. Shared by record-fixture.mjs and record-errors.mjs.
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { encoding: 'utf8' }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    ),
  )

let awsCredentials
// Temporary credentials of whatever the AWS CLI is logged in with (aws login, SSO, profile).
async function bedrockCredentials() {
  awsCredentials ??= JSON.parse(
    await run('aws', ['configure', 'export-credentials', '--format', 'process']),
  )
  return awsCredentials
}

// curl signs the request with SigV4 (service bedrock-mantle); the body goes in on stdin, the
// response bytes come out on stdout untouched, and the headers and status code on stderr. The
// credentials go in a curl config file readable only by this user and deleted right after, never
// on the command line, where any process on the machine could read them. `credentials` replaces
// the CLI's, e.g. with invalid ones to record an authentication error.
export async function sendViaBedrock(body, { credentials } = {}) {
  const region = process.env.AWS_REGION ?? 'us-east-1'
  const creds = credentials ?? (await bedrockCredentials())
  const lines = [`user = "${creds.AccessKeyId}:${creds.SecretAccessKey}"`]
  if (creds.SessionToken) lines.push(`header = "x-amz-security-token: ${creds.SessionToken}"`)
  const dir = await mkdtemp(join(tmpdir(), 'llmmend-record-'))
  const config = join(dir, 'curl.conf')
  try {
    await writeFile(config, lines.join('\n') + '\n', { mode: 0o600 })
    const curl = spawn('curl', [
      '-s',
      '-m',
      '300',
      '-K',
      config,
      `https://bedrock-mantle.${region}.api.aws/anthropic/v1/messages`,
      '--aws-sigv4',
      `aws:amz:${region}:bedrock-mantle`,
      '-H',
      'content-type: application/json',
      '-H',
      'anthropic-version: 2026-10-21',
      '--data-binary',
      '@-',
      '-w',
      '%{stderr}%{header_json}\n%{http_code}',
    ])
    const out = []
    let err = ''
    curl.stdout.on('data', (chunk) => out.push(chunk))
    curl.stderr.on('data', (chunk) => (err += chunk))
    curl.stdin.end(JSON.stringify({ ...body, model: `anthropic.${body.model}` }))
    await new Promise((resolve, reject) => curl.on('close', resolve).on('error', reject))
    // stderr: the response headers as JSON (each name maps to its values), then the status code.
    const split = err.trimEnd().lastIndexOf('\n')
    const status = Number(err.slice(split + 1))
    const headers = new Headers()
    for (const [name, values] of Object.entries(JSON.parse(err.slice(0, split) || '{}')))
      for (const value of values) headers.append(name, value)
    return { status, headers, bytes: new Uint8Array(Buffer.concat(out)) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
