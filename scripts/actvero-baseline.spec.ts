import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { assertActveroBaseline } from './actvero-baseline.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'actvero-baseline-'))
  roots.push(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q')
  const version = '0.2.0-rc.2', tag = `dsh-v${version}`
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version }))
  mkdirSync(join(root, 'apps/cli'), { recursive: true })
  writeFileSync(join(root, 'apps/cli/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'release fixture')
  git('tag', tag)
  return { root, upstream: { schemaVersion: 1 as const, repository: 'https://example.com/dsh', branch: 'master', tag, version, commit: git('rev-parse', 'HEAD') } }
}
it('accepts a coherent release checkout', () => {
  const { root, upstream } = fixture()
  expect(() => assertActveroBaseline(root, upstream)).not.toThrow()
})
it('rejects development versions even when the root version agrees', () => {
  const { root, upstream } = fixture()
  expect(() => assertActveroBaseline(root, { ...upstream, version: '0.2.1-alpha.1', tag: 'dsh-v0.2.1-alpha.1' })).toThrow('alpha/beta')
})
it('rejects a lock pointing at a commit other than its tag', () => {
  const { root, upstream } = fixture()
  expect(() => assertActveroBaseline(root, { ...upstream, commit: '0'.repeat(40) })).toThrow('tag and commit')
})
it('rejects a mixed runtime even when the root and lock still match', () => {
  const { root, upstream } = fixture()
  writeFileSync(join(root, 'apps/cli/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-alpha.1' }))
  expect(() => assertActveroBaseline(root, upstream)).toThrow('apps/cli/package.json uses 0.2.1-alpha.1')
})

it('ignores packages removed from the working tree during baseline restoration', () => {
  const { root, upstream } = fixture()
  const path = join(root, 'packages/client/retired/package.json')
  mkdirSync(join(root, 'packages/client/retired'), { recursive: true })
  writeFileSync(path, JSON.stringify({ name: '@deepseek-ai/dsh-client-retired', version: '0.2.1-alpha.1' }))
  execFileSync('git', ['add', 'packages/client/retired/package.json'], { cwd: root })
  rmSync(path)
  expect(() => assertActveroBaseline(root, upstream)).not.toThrow()
})
