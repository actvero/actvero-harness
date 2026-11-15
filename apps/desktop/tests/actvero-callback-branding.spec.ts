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

it('renders the shared wordmark in browser sign-in without appending the product name', async () => {
  vi.stubEnv('ACTVERO_PRODUCT_NAME', 'XTD & Harness')
  vi.stubEnv('ACTVERO_PRODUCT_LOGO', 'data:image/png;base64,bG9nbw==')
  vi.stubEnv('ACTVERO_PRODUCT_WORDMARK', 'data:image/svg+xml;base64,d29yZG1hcms=')
  const { callbackPage, browserAccountPage } = await import('../src/actvero/callback-page.ts')
  for (const page of [callbackPage(), browserAccountPage('/confirm/test', 'csrf')]) {
    expect(page.html).toContain('<p class="art-brand"><img class="brand-wordmark" src="data:image/svg+xml;base64,d29yZG1hcms=" alt="XTD &amp; Harness"></p>')
    expect(page.html).not.toContain('class="brand-icon"')
  }
})
