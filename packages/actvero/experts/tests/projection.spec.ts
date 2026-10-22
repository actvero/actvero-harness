import { Context } from '@deepseek-ai/cordis'
import SessionStore,{ SessionId,SessionLogOffset } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { expect,it,onTestFinished } from 'vitest'
import { expertProjection } from '../src/projection.ts'
const choice={ snapshotId:'f0000000-0000-4000-8000-000000000001',id:'expert-local',name:'Designer',avatar:'',version:'1.0.0' }
it('restores exact selection through native log replay, checkpoints and forks',async()=>{
  const ctx=new Context();onTestFinished(()=>ctx.fiber.dispose())
  await ctx.plugin(SessionStore);await ctx.plugin(Projections);ctx.sessionProjections.register(expertProjection)
  const session=ctx.sessions.create(SessionId('expert-source'));session.append('actvero/expert',{ schemaVersion:1,selection:choice });session.append('turn/start',{ turn:1 });session.append('turn/end',{ turn:1,reason:{ kind:'completed' } })
  expect(ctx.sessionProjections.stateOf(session,'actveroExpert')).toEqual({ hasSelection:true,selection:choice,started:true })
  const events=session.snapshotEvents()
  const restore=ctx.sessionProjections.restore({},events,SessionLogOffset(0),session.header,session.inheritedEventCount)
  expect(restore.checkpoint.actveroExpert?.val).toEqual({ hasSelection:true,selection:choice,started:true })
  const fork=ctx.sessions.fork(session);expect(ctx.sessionProjections.stateOf(fork,'actveroExpert')?.selection).toEqual(choice)
  session.append('actvero/expert',{ schemaVersion:1,selection:null });expect(ctx.sessionProjections.stateOf(session,'actveroExpert')?.selection).toBeNull();expect(ctx.sessionProjections.stateOf(fork,'actveroExpert')?.selection).toEqual(choice)
})

it('restores scoped connector intent independently of health and retains it in forks',async()=>{
  const { connectorProjection }=await import('../src/projection.ts');const ctx=new Context();onTestFinished(()=>ctx.fiber.dispose());await ctx.plugin(SessionStore);await ctx.plugin(Projections);ctx.sessionProjections.register(connectorProjection)
  const session=ctx.sessions.create(SessionId('connector-source')),choices=[{ scope:'local',id:'local-connection',enabled:false },{ scope:'account-a',id:'remote',enabled:true }];session.append('actvero/connectors',{ schemaVersion:1,choices })
  expect(ctx.sessionProjections.stateOf(session,'actveroConnectors')?.choices).toEqual(choices)
  const restored=ctx.sessionProjections.restore({},session.snapshotEvents(),SessionLogOffset(0),session.header,SessionLogOffset(0))
  expect(restored.checkpoint.actveroConnectors?.val).toEqual({ choices })
  const fork=ctx.sessions.fork(session);session.append('actvero/connectors',{ schemaVersion:1,choices:[] });expect(ctx.sessionProjections.stateOf(fork,'actveroConnectors')?.choices).toEqual(choices)
})


it('recovers oversized legacy avatars without blocking session restoration', async () => {
  const ctx = new Context();onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore);await ctx.plugin(Projections);ctx.sessionProjections.register(expertProjection)
  const session = ctx.sessions.create(SessionId('expert-oversized-avatar'))
  session.append('actvero/expert', { schemaVersion: 1, selection: { ...choice, avatar: 'x'.repeat(500001) } })
  expect(ctx.sessionProjections.stateOf(session, 'actveroExpert')?.selection?.avatar).toBe('')
})

it('keeps an accepted imported portrait in the durable selection', async () => {
  const ctx = new Context();onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore);await ctx.plugin(Projections);ctx.sessionProjections.register(expertProjection)
  const session = ctx.sessions.create(SessionId('expert-large-portrait'))
  const avatar = 'data:image/png;base64,' + 'A'.repeat(300_000)
  session.append('actvero/expert', { schemaVersion: 1, selection: { ...choice, avatar } })
  expect(ctx.sessionProjections.stateOf(session, 'actveroExpert')?.selection?.avatar).toBe(avatar)
})
