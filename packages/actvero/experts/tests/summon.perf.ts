/** Local diagnostic: exact warm selection with deterministic network latency, no credentials. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Connectors } from '@actvero/dsh-connectors/main'
import { remoteFixture } from './remote-fixture.mjs'
import { Experts, ExpertSelections } from '../src/main.ts'
import { RemoteExperts } from '../src/remote-main.ts'

const baseline = process.argv[2], beforeMode = process.argv[3] === 'before'
const BaselineExperts: typeof Experts = baseline ? (await import(pathToFileURL(join(baseline, 'src/main.ts')).href) as typeof import('../src/main.ts')).Experts : Experts
const ExpertClass = beforeMode ? BaselineExperts : Experts
const BaselineRemote: typeof RemoteExperts = baseline ? (await import(pathToFileURL(join(baseline, 'src/remote-main.ts')).href) as typeof import('../src/remote-main.ts')).RemoteExperts : RemoteExperts
const RemoteClass = beforeMode ? BaselineRemote : RemoteExperts
const root = await mkdtemp(join(tmpdir(), 'expert-summon-perf-')), fixture = remoteFixture()
const remote = new RemoteClass({ root: join(root, 'remote'), identity: () => fixture.identity,
  skills: fixture.skills, issue: fixture.issue, changed: () => {}, createConnector: options => new Connectors(options),
  fetcher: async (...args) => { await delay(25); return fixture.fetcher(...args) } })
const engine = new ExpertClass({ root: join(root, 'experts'), scope: () => fixture.identity.key, skills: fixture.skills,
  remote, connectors: () => remote.rows(), changed: () => {} })
const selections = new ExpertSelections({ scope: () => fixture.identity.key, revision: () => 0, prepare: id => engine.prepareRuntime(id) })
try {
  const id = (await remote.list()).items[0]!.manifest.id
  await remote.plan(id); await remote.stage(id)
  globalThis.gc?.()
  const before = process.memoryUsage(), samples: { ms: number; requests: number; resolutions: number }[] = []
  for (let i = 0; i < 5; i++) {
    fixture.calls.length = 0
    const start = performance.now()
    await remote.plan(id); await remote.stage(id)
    if (beforeMode) { const lock = await engine.prepare(id); await engine.resolve(lock.id); await engine.resolve(lock.id) }
    else await selections.run(id, async (operation) => {
      const { lock } = await selections.prepare(operation, id)
      await selections.resolve(operation, lock.id); await selections.resolve(operation, lock.id)
    })
    samples.push({ ms: Math.round(performance.now() - start), requests: fixture.calls.length,
      resolutions: fixture.calls.filter(r => r.path.endsWith('/resolve')).length })
  }
  globalThis.gc?.()
  const after = process.memoryUsage()
  console.log(JSON.stringify({ mode: beforeMode ? 'before' : 'after', networkDelayMs: 25, skills: 2, connectors: 1, samples,
    memory: { rssBefore: before.rss, rssAfter: after.rss, heapBefore: before.heapUsed, heapAfter: after.heapUsed,
      maxRssKiB: process.resourceUsage().maxRSS } }))
} finally { remote.dispose(); await rm(root, { recursive: true, force: true }) }
