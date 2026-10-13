# ACTVERO account recovery

English | [中文](account-recovery.zh.md)

## Persistence

Electron Main stores the device session, selected service, login cancellation proof and refresh recovery record in `actvero-device-account.enc` under the isolated Electron user-data directory. System encryption is required; plaintext fallback is refused. Atomic replacement flushes the file and, on POSIX, the containing directory. Renderer snapshots contain account details and quota only.

Refresh v2 persists the predecessor and request UUID before sending. A successor is stored before acknowledgement; crashes retry the durable predecessor with the same UUID or resume the durable successor acknowledgement. A recovered access token with zero lifetime is saved before a new rotation. All windows share one serialized authority and one refresh promise.

Network failures, throttling and temporary server failures retain credentials. Fatal device/account errors clear authorization and request sign-in. A refresh replay conflict preserves the recovery record. Logout invalidates in-flight results before clearing local authorization; pending remote revocation is encrypted and retried only against its original service.

Resource-token requests share this renewal queue. A server-rejected short access token is renewed and retried once. After temporary offline state, resource issuance revalidates the account; catalog subscribers are notified when availability changes even if the account and organization stay the same. A real server reauthentication requirement enters the account login flow. Browser confirmation remains mandatory before any resource token is issued.

## Platform inputs

The checked-in [OpenAPI subset](contracts/desktop-openapi.json) owns device-account DTOs. `pnpm exec tsx scripts/actvero-contract.ts` regenerates types; append `--check` to reject drift. Update the snapshot from the platform delivery before changing its consumers. Login uses contract version 1; refresh uses recovery version 2. Packaged product names and logos take precedence over anonymous platform branding from `/api/v1/auth/session`; uploaded same-origin PNG/JPEG/WebP logos are downloaded without credentials, limited to 2 MiB, and projected as inline image data. Organization logos are not used.

## Browser return

The local browser page follows the official desktop completion layout with ACTVERO copy. Main exchanges the callback for a provisional device session and validates `/desktop/me`, then shows the verified account with Continue and Switch account actions. Existing browser SSO is retained; it does not silently enter the desktop. Confirmation accepts the device session and opens the workspace once organization validation completes. This confirmation follows any successful browser authorization, including a fresh sign-in. The Return to desktop action uses the existing `dsh://open` shell handler. Authorization cancellation shows a receipt only and returns to sign-in.

The provisional session stays encrypted with a `browserPending` marker. It cannot enter the workspace, select an organization, query quota or open the personal center. Cancel, account switching or application restart retires it; failed remote revocation remains queued against the original platform. Main revalidates the displayed identity before accepting Continue. The browser receives display name and optional email only, never tokens, identifiers or OAuth proof. A random callback-owned page path, HttpOnly SameSite cookie, independent CSRF value, exact-origin POST checks and one serialized decision protect the local choices. The page removes authorization parameters, loads no remote assets and retains a hash-based content security policy. No platform API or authentication contract changes are required.

## Login entry and account confirmation

The left pane reuses the previous desktop's flowing artwork; the right uses native DSH typography, colors and buttons. Narrow windows hide decoration. Reduced motion, hidden windows and unavailable graphics stop animation and retain the still artwork. The browser return page shares the same local artwork and animation without external requests.

Startup restores the saved device session and organization, then shows the account for an explicit Continue action. Background renewal neither dismisses confirmation nor opens a browser. A new browser login enters the workspace after the browser's explicit account confirmation and validation of an eligible organization, without repeating confirmation in the desktop. Multiple organizations without a valid selection require the organization choice first. Confirmed sign-out returns to login immediately, including while remote cleanup is pending; opening the app again stays on login until sign-in or an explicit local-workspace action.

Switch account first persists encrypted device-revocation records and a reauthentication flag, clears the local account, then starts browser login with `reauthenticate=true`. Cancelling a switch does not silently restore the old account. A storage-write failure retains the old account and opens no browser. Failed remote revocation retries only against the original service. Local files and conversations are retained.

Sign out uses the existing desktop confirmation dialog. Cancel, Escape or closing the prompt preserves the current account and sends no revocation request. Repeated clicks share one prompt; approval after an account-context change or application disposal is ignored. Only explicit confirmation starts local sign-out and remote cleanup.

## Focused acceptance

```sh
pnpm exec vitest run apps/desktop/tests/actvero-account.spec.ts apps/desktop/tests/actvero-account-policy.spec.ts scripts/actvero-product.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/actvero-account.e2e.ts
pnpm exec tsc -b apps/desktop/tsconfig.json
```

The built-Host suite requires a successful repository build. It assembles a temporary official desktop project and verifies ACTVERO assets and the unchanged baseline. Synthetic tests cover rotation crashes, late logout results, scope transitions, PKCE and callback validation; they do not assert a real 30-day elapsed interval or Windows secure-storage behavior.

For native acceptance, sign in against the selected test platform, quit the isolated development app, restart the same profile and confirm the same account/org without a browser prompt. Verify the account menu, quota query, address form, Escape/outside-click dismissal and both themes. Test service failures and revocation on a test-only device. Preserve existing installation data.

## 2026-10-05 verification

The account-confirmation change passed 49 focused tests across seven files, the desktop TypeScript build and desktop bundle. Browser verification used the compiled welcome renderer with a synthetic account bridge: light/dark appearance, account-switch waiting state, address-edit focus, reduced-motion still artwork and the 600 × 560 minimum content size. The compiled callback layout and local animation also rendered under its content security policy. No horizontal overflow or hidden final action was observed at the tested sizes.

The isolated development app was started, but native window capture was unavailable in the automation environment. These browser fixtures do not verify a real account switch, operating-system secure storage or Windows behavior; no existing device session was signed out for this verification.

Sign-out confirmation validation: 38 focused desktop tests passed, with lint, TypeScript and desktop bundle checks passing. A local browser fixture using the actual dialog renderer confirmed the Chinese layout, Cancel and Escape responses. The isolated development desktop was restarted with the new bundle; the real account was not signed out for testing.

Login-entry validation: 41 focused tests passed, including signed-out restart, unavailable remote revocation, browser completion, organization eligibility and stale workspace-entry cancellation. Lint, TypeScript and the desktop bundle passed. The compiled browser fixture verified the centered artwork copy in light/dark layouts and the 600 × 560 minimum viewport; the isolated development desktop was restarted. Real browser authentication was not exercised by the synthetic fixture.

Browser account-choice validation: 57 focused tests passed across the account controller, callback policy, Main runtime, startup and welcome renderer. Lint, desktop TypeScript and the desktop bundle passed. Compiled browser fixtures verified Continue, keyboard account switching, a literal untrusted display name, light and forced-dark rules, and the 600 × 560 viewport without overflow or hidden actions. The isolated development desktop was restarted. These fixtures use synthetic accounts; live platform SSO, operating-system secure storage and Windows remain separate acceptance checks.
