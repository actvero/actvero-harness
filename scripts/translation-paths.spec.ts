/** Root README locale discovery and rejection checks through the pairing CLI. */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { isChineseTranslation, pairAnchorOfArgument, translationCounterpartPath, translationPairPaths } from './translation-paths.ts'

it('uses Chinese only for the root README while nested README pairs retain their locales', () => {
  expect(translationPairPaths(pairAnchorOfArgument('README.md'))).toEqual({
    source: 'README.en.md', zh: 'README.md', meta: 'README.i18n.yaml',
  })
  expect(pairAnchorOfArgument('README.i18n.yaml')).toBe('README.en.md')
  expect(translationCounterpartPath('README.en.md')).toBe('README.md')
  expect(translationCounterpartPath('README.md')).toBe('README.en.md')
  expect(translationPairPaths('actvero/README.md').zh).toBe('actvero/README.zh.md')
  expect(isChineseTranslation('actvero/README.md')).toBe(false)
  expect(() => translationPairPaths('README.md')).toThrow('expected an English Markdown path')
})

it('discovers the root pair and rejects wrong-language links and a missing English counterpart', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-readme-locales-'))
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'docs'))
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'junction')
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
    writeFileSync(join(root, 'scripts/translation-pairing.manifest.json'), '{"excluded":[]}\n')
    for (const file of [
      'verify-translation-pairing.ts', 'translation-pairing.ts', 'translation-pairing-record.ts',
      'translation-pairing-git.ts', 'translation-paths.ts', 'translation-links.ts', 'markdown.ts',
    ]) copyFileSync(resolve('scripts', file), join(root, 'scripts', file))
    writeFileSync(join(root, 'README.en.md'), '# Harness\n\nEnglish | [中文](README.md)\n\nSee [guide](docs/guide.md).\n')
    writeFileSync(join(root, 'README.md'), '# Harness\n\n[English](README.en.md) | 中文\n\n参见[指南](docs/guide.zh.md)。\n')
    writeFileSync(join(root, 'docs/guide.md'), '# Guide\n\nEnglish | [中文](guide.zh.md)\n\n[Home](../README.en.md)\n')
    writeFileSync(join(root, 'docs/guide.zh.md'), '# 指南\n\n[English](guide.md) | 中文\n\n[首页](../README.md)\n')
    const run = (...args: string[]) => spawnSync(process.execPath, [
      '--import', 'tsx/esm', join(root, 'scripts/verify-translation-pairing.ts'), ...args,
    ], { cwd: root, encoding: 'utf8' })
    expect(run('--write', '--all').status).toBe(0)
    expect(existsSync(join(root, 'README.i18n.yaml'))).toBe(true)
    expect(run().status).toBe(0)
    const chinese = join(root, 'README.md')
    writeFileSync(chinese, readFileSync(chinese, 'utf8').replace('docs/guide.zh.md', 'docs/guide.md'))
    expect(run('--write', 'README.md').status).toBe(0)
    const wrongLocale = run('README.md')
    expect(wrongLocale.status).toBe(1)
    expect(wrongLocale.stderr).toContain('uses the wrong locale; expected "docs/guide.zh.md"')
    rmSync(join(root, 'README.en.md'))
    const missing = run()
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('incomplete pair — missing README.en.md')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
