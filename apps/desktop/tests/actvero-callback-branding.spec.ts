/** Browser login receipts retain the build identity and open the selected application. */
import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
it('embeds the configured fallback logo, escapes the name and targets its own return protocol', async () => {
  vi.stubEnv('ACTVERO_PRODUCT_NAME', 'Acme & Team')
  vi.stubEnv('ACTVERO_PRODUCT_PROTOCOL', 'acme-desktop')
  vi.stubEnv('ACTVERO_PRODUCT_LOGO', 'data:image/png;base64,dGVzdA==')
  vi.resetModules()
  const { callbackPage, browserAccountPage } = await import('../src/actvero/callback-page.ts')
  for (const page of [callbackPage(), callbackPage(true), browserAccountPage('/confirm/test', 'csrf')]) {
    expect(page.html).toContain('Acme &amp; Team')
    expect(page.html).toContain('href="acme-desktop://open"')
    expect(page.html).toContain('src="data:image/png;base64,dGVzdA=="')
    expect(page.html).not.toContain('href="dsh://open"')
    expect(page.csp).toContain('img-src data:')
  }
})
