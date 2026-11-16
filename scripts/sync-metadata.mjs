#!/usr/bin/env node
/**
 * Keep the version references that a DeepSeek Harness bump touches in step with
 * `package.json`.
 *
 * The migration Action edits manifests only: it raises each plugin's own version
 * and its `@deepseek-ai/dsh-*` ranges, and leaves the lockfile and the README
 * for the consumer. This script rewrites the README's compatibility list to the
 * versions the manifest now declares, and the workflow refreshes the lockfile
 * beside it, so a merged proposal leaves the repository consistent.
 *
 * A reference is left alone when it already matches: an exact version, or a
 * `MAJOR.MINOR.x` line whose floor agrees with the manifest.
 *
 * Usage:
 *   node scripts/sync-metadata.mjs [--check] [--root DIR]
 *
 * `--check` reports what would change and exits 1 instead of writing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A `@deepseek-ai/*` bullet of the README's compatibility list. */
const BULLET = /^- `(@deepseek-ai\/[a-z0-9-]+)` (\S+)$/gm

/** A README version written as `MAJOR.MINOR.x`. */
const FLOOR = /^(\d+)\.(\d+)\.x$/

/** The version a semver range admits, as the README names it. */
function versionOf(range) {
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(range)
  if (match === null) throw new Error(`cannot read a version out of the range: ${range}`)
  return match[0]
}

/** Whether the README already names the version the manifest declares. */
function current(listed, declared) {
  if (listed === declared) return true
  const floor = FLOOR.exec(listed)
  if (floor === null) return false
  const [major, minor] = declared.split('.')
  return floor[1] === major && floor[2] === minor
}

function main(argv) {
  const check = argv.includes('--check')
  const rootIndex = argv.indexOf('--root')
  const root = rootIndex === -1 ? '.' : (argv[rootIndex + 1] ?? '.')
  const readmePath = join(root, 'README.md')

  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const peers = manifest.peerDependencies ?? {}
  const before = readFileSync(readmePath, 'utf8')
  const changes = []

  const after = before.replace(BULLET, (line, name, listed) => {
    const range = peers[name]
    if (range === undefined) return line
    const declared = versionOf(range)
    if (current(listed, declared)) {
      changes.push({ name, listed, declared, changed: false })
      return line
    }
    changes.push({ name, listed, declared, changed: true })
    return `- \`${name}\` ${declared}`
  })

  for (const change of changes) {
    const detail = change.changed ? `${change.listed} -> ${change.declared}` : `${change.declared} (unchanged)`
    process.stdout.write(`README.md: ${change.name} ${detail}\n`)
  }
  if (changes.length === 0) process.stdout.write('README.md: no @deepseek-ai/* reference to sync\n')

  const stale = after !== before
  if (stale && !check) {
    writeFileSync(readmePath, after, 'utf8')
    process.stdout.write('README.md: written\n')
  }
  if (check && stale) {
    process.stderr.write('README.md: version references are stale; run this script without --check\n')
    return 1
  }
  return 0
}

process.exitCode = main(process.argv.slice(2))