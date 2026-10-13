/** Main-owned browser pages; authorization parameters never enter their HTML. */
import { createHash } from 'node:crypto'

const defaultName = process.env.ACTVERO_PRODUCT_NAME ?? 'ACTVERO'
const htmlBrand = defaultName.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;').replaceAll("'", '&#39;')
const returnUrl = `${process.env.ACTVERO_PRODUCT_PROTOCOL ?? 'dsh'}://open`
const logo = process.env.ACTVERO_PRODUCT_LOGO ?? ''
const brandIcon = logo ? `<img class="brand-icon" src="${logo}" alt="">` : ''
const image = process.env.ACTVERO_FLOW_IMAGE ?? ''
const animation = process.env.ACTVERO_FLOW_SCRIPT ?? ''
const cleanAddress = "history.replaceState(null, '', location.pathname);"
// Standalone browser document mirrors the official welcome palette without remote assets.
const styles = `
:root{color-scheme:light dark;--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-button-primary-hover:#43454a;--page-background:#fff;--account-border:#e1e3e6;--account-fill:#f0f1f3;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif;font-weight:400;color:var(--dsw-alias-label-primary);background:var(--page-background)}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;grid-template-columns:1fr 1fr;-webkit-font-smoothing:antialiased}
main{min-width:0;grid-column:2;grid-row:1;display:grid;place-items:center;padding:48px 24px}.content{width:100%;max-width:360px;text-align:left}
.brand-icon{width:28px;height:28px;object-fit:contain;vertical-align:middle;margin-right:10px}
.brand{margin:0 0 48px;font-size:26px;font-weight:500;line-height:32px;letter-spacing:.025em}
h1{margin:0;font-size:20px;font-weight:400;line-height:32px}.description{margin:8px 0 0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary)}
.return{display:flex;align-items:center;justify-content:center;width:100%;max-width:360px;min-height:44px;margin:48px 0 0;padding:10px 16px;border-radius:12px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted);font-size:14px;font-weight:500;line-height:24px;text-decoration:none;transition:background-color .2s}
.return:hover{background:var(--dsw-alias-button-primary-hover)}.return:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:4px}
aside{color-scheme:light;position:relative;grid-column:1;grid-row:1;min-width:0;display:flex;flex-direction:column;padding:72px 40px 48px;color:#273842;background:#e7f3f8;overflow:hidden}
.atmosphere-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}.atmosphere-layer img,.atmosphere-layer canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.atmosphere-layer canvas[hidden]{display:none}
.art-brand{position:relative;margin:0;font-size:24px;font-weight:500;line-height:32px}.art-copy{position:relative;margin-block:auto}.art-copy>p:not(.tagline){font-size:14px;line-height:24px}
.tagline{margin:0;font-size:40px;font-weight:500;line-height:1.4;letter-spacing:-.02em}.tagline span{display:block}
.identity{display:flex;align-items:center;gap:12px;padding:16px;margin:24px 0 20px;border:1px solid var(--account-border);border-radius:12px}.identity>div{min-width:0;overflow-wrap:anywhere}.avatar{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--account-fill);color:var(--dsw-alias-label-secondary);font-size:20px}.name{font-size:14px;line-height:22px;font-weight:500}.email{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.actions{display:grid;gap:12px;margin-top:40px}.actions button{font-family:inherit;border:0;cursor:pointer}.actions .return{margin:0}.actions .secondary{color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--account-border)}.actions .secondary:hover{background:var(--account-fill)}button:disabled{cursor:wait;opacity:.6}[hidden]{display:none!important}
@media(prefers-color-scheme:dark){:root{--dsw-alias-label-primary:#f9fafb;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-label-tertiary:#adb2b8;--dsw-alias-label-primary-inverted:#353638;--dsw-alias-button-primary-hover:#ebeef2;--page-background:#16181b;--account-border:#45474b;--account-fill:#353638}}
@media(max-width:800px){body{grid-template-columns:1fr}main{grid-column:1}aside{display:none}}
@media(max-width:480px),(max-height:500px){main{padding:32px 24px}.brand{margin-bottom:48px}.return{margin-top:48px}}
@media(prefers-reduced-motion:reduce){.return{transition:none}}
`
const hash = (source: string) => "'sha256-" + createHash('sha256').update(source).digest('base64') + "'"
/**
 * Render callback receipt or cancellation, without claiming a completed token exchange.
 * @param cancelled - whether the browser returned an authorization error.
 * @returns static HTML and its hash-based content security policy.
 */
export function callbackPage(cancelled = false) {
  const title = cancelled ? '登录未完成' : '请返回桌面端'
  return {
    csp: `default-src 'none'; style-src ${hash(styles)}; script-src ${hash(cleanAddress)} ${hash(animation)}; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    html: `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${htmlBrand}</title><style>${styles}</style><script>${cleanAddress}</script></head>
<body><main aria-labelledby="title"><div class="content"><p class="brand">${brandIcon}${htmlBrand}</p>
<h1 id="title">${title}</h1>
<p class="description">${cancelled ? '本次登录未完成，请返回桌面端重新登录' : '桌面端正在确认登录，你可以关闭此页面'}</p>
<a class="return" href="${returnUrl}">返回桌面端</a>
</div></main><aside aria-label="${htmlBrand}"><div class="atmosphere-layer" data-actvero-atmosphere aria-hidden="true"><img src="${image}" alt=""></div>
<p class="art-brand">${brandIcon}${htmlBrand}</p><div class="art-copy"><p>你的桌面 AI 工作空间</p><p class="tagline"><span>让想法</span><span>更进一步。</span></p><p>从一个问题开始，把想法变成现实。</p></div></aside><script>${animation}</script></body></html>`,
  }
}

/**
 * Render browser account confirmation with fixed same-origin status and decision requests.
 * @param path - random Main-owned URL path, unrelated to OAuth state or credentials.
 * @param csrf - independent per-listener CSRF value; a private HttpOnly cookie is also required.
 * @returns Static HTML and its hash-based content security policy.
 */
export function browserAccountPage(path: string, csrf: string) {
  const script = `
(() => {
  history.replaceState(null, '', ${JSON.stringify(path)});
  const base = ${JSON.stringify(path)}, csrf = ${JSON.stringify(csrf)};
  const get = id => document.getElementById(id);
  let busy = false, timer, revision = 0;
  const render = state => {
    const confirm = state.phase === 'confirm-account' && state.user;
    get('identity').hidden = !confirm;
    get('choices').hidden = !confirm;
    get('return').hidden = !['complete', 'failed'].includes(state.phase);
    get('title').textContent = confirm ? '继续使用这个账号？' : state.phase === 'complete' ? '登录成功' : state.phase === 'switching' ? '正在切换账号' : state.phase === 'failed' ? '登录未完成' : '正在确认登录';
    get('description').textContent = confirm ? '确认账号后继续，或切换账号登录' : state.phase === 'complete' ? '账号已确认，请返回桌面端继续' : state.phase === 'switching' ? '请在打开的登录页面中使用其他账号登录' : state.phase === 'failed' ? '请返回桌面端重试，本次登录尚未完成' : '正在验证账号，请稍候';
    if (confirm) {
      get('name').textContent = state.user.name;
      get('email').textContent = state.user.email || '';
      get('avatar').textContent = state.user.name.slice(0, 1);
      if (state.brand) {
        document.title = '确认账号 · ' + state.brand;
        get('brand').textContent = state.brand;
        get('art-brand').textContent = state.brand;
      }
    } else {
      get('name').textContent = get('email').textContent = get('avatar').textContent = '';
    }
    for (const id of ['continue', 'switch']) get(id).disabled = busy;
  };
  const poll = async () => {
    const current = revision;
    try {
      const response = await fetch(base + '/state', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error();
      const state = await response.json();
      if (current !== revision) return;
      render(state);
      if (['checking', 'confirm-account'].includes(state.phase)) timer = setTimeout(poll, 750);
    } catch { if (current === revision) render({ phase: 'failed' }); }
  };
  const decide = async action => {
    if (busy) return;
    busy = true;
    revision++;
    clearTimeout(timer);
    for (const id of ['continue', 'switch']) get(id).disabled = true;
    try {
      const response = await fetch(base + '/' + action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf }) });
      if (!response.ok) throw new Error();
      const state = await response.json();
      busy = false;
      render(state);
      if (state.phase === 'checking' || state.phase === 'confirm-account') timer = setTimeout(poll, 750);
    } catch { busy = false; render({ phase: 'failed' }); }
  };
  get('continue').addEventListener('click', () => decide('continue'));
  get('switch').addEventListener('click', () => decide('switch'));
  void poll();
})();`
  return {
    csp: `default-src 'none'; style-src ${hash(styles)}; script-src ${hash(script)} ${hash(animation)}; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>确认账号 · ${htmlBrand}</title><style>${styles}</style></head><body>
<main aria-labelledby="title"><div class="content"><p class="brand">${brandIcon}<span id="brand">${htmlBrand}</span></p><h1 id="title">正在确认登录</h1>
<div class="identity" id="identity" hidden><span class="avatar" id="avatar" aria-hidden="true"></span><div><div class="name" id="name"></div><div class="email" id="email"></div></div></div>
<p class="description" id="description" role="status">正在验证账号，请稍候</p>
<div class="actions" id="choices" hidden><button id="continue" class="return" type="button">继续使用此账号</button><button id="switch" class="return secondary" type="button">切换账号登录</button></div>
<a class="return" id="return" href="${returnUrl}" hidden>返回桌面端</a></div></main>
<aside aria-label="${htmlBrand}"><div class="atmosphere-layer" data-actvero-atmosphere aria-hidden="true"><img src="${image}" alt=""></div><p class="art-brand">${brandIcon}<span id="art-brand">${htmlBrand}</span></p><div class="art-copy"><p>你的桌面 AI 工作空间</p><p class="tagline"><span>让想法</span><span>更进一步。</span></p><p>从一个问题开始，把想法变成现实。</p></div></aside><script>${animation}</script><script>${script}</script></body></html>`,
  }
}
