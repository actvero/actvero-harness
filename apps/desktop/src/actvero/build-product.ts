/** Public product defaults embedded by the ACTVERO build; credentials are never accepted. */
export interface BuildProduct {
  readonly id: string
  readonly applicationId: string
  readonly protocolScheme: string
  readonly displayName: string
  readonly version: string
  readonly defaultLocale: 'zh-CN' | 'en-US'
  readonly defaultUrl: string
  readonly logoDataUrl: string
  readonly iconDataUrl: string
}
