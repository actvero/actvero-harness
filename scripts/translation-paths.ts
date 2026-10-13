/** Bilingual document paths, including the Chinese default repository README. */

/** The three repository-relative paths that form one bilingual pair. */
export interface TranslationPairPaths {
  /** English document path. */
  source: string
  /** Simplified Chinese document path. */
  zh: string
  /** Consistency-record path. */
  meta: string
}

/** The root README renders Chinese by default; other documents retain suffix-based pairing. */
export const ROOT_README_PAIR: TranslationPairPaths = {
  source: 'README.en.md',
  zh: 'README.md',
  meta: 'README.i18n.yaml',
}

/**
 * Identify Chinese documents without treating nested README files as Chinese.
 * @param file - Normalized repository-relative Markdown path.
 * @returns Whether the path names a Chinese document.
 */
export function isChineseTranslation(file: string): boolean {
  return file === ROOT_README_PAIR.zh || file.endsWith('.zh.md')
}

/**
 * Normalize any pair artifact or bare stem to its English document path.
 * @param argument - Repository-relative path, accepting platform separators.
 * @returns The English anchor path with forward slashes.
 */
export function pairAnchorOfArgument(argument: string): string {
  const normalized = argument.split('\\').join('/').replace(/^\.\//, '')
  const anchor = normalized.endsWith('.zh.md') ? `${normalized.slice(0, -'.zh.md'.length)}.md`
    : normalized.endsWith('.i18n.yaml') ? `${normalized.slice(0, -'.i18n.yaml'.length)}.md`
      : normalized.endsWith('.md') ? normalized : `${normalized}.md`
  return anchor === ROOT_README_PAIR.zh ? ROOT_README_PAIR.source : anchor
}

/**
 * Derive the counterpart and consistency record from an English document.
 * @param source - Repository-relative English Markdown path.
 * @returns The complete three-path pair.
 */
export function translationPairPaths(source: string): TranslationPairPaths {
  if (!source.endsWith('.md') || isChineseTranslation(source)) {
    throw new Error(`expected an English Markdown path, received ${JSON.stringify(source)}`)
  }
  if (source === ROOT_README_PAIR.source) return { ...ROOT_README_PAIR }
  return {
    source,
    zh: source.replace(/\.md$/, '.zh.md'),
    meta: source.replace(/\.md$/, '.i18n.yaml'),
  }
}

/**
 * Resolve the opposite language of a repository document.
 * @param file - Repository-relative Markdown path in either language.
 * @returns The other document's repository-relative path.
 */
export function translationCounterpartPath(file: string): string {
  const pair = translationPairPaths(pairAnchorOfArgument(file))
  return isChineseTranslation(file) ? pair.source : pair.zh
}
