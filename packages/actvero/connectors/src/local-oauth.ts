import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthTokens, OAuthClientInformationMixed, OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { bad } from './local-config.ts'

export interface OAuthData { tokens?:OAuthTokens; client?:OAuthClientInformationMixed; redirect?:string }
export class LocalOAuth implements OAuthClientProvider {
  private verifier=''
  private nonce=randomBytes(32).toString('base64url')
  private server?:Server
  private timer?:NodeJS.Timeout
  private resolveCode?:(code:string)=>void
  private rejectCode?:(error:Error)=>void
  private abort?:()=>void
  private code?:Promise<string>
  constructor(readonly data:OAuthData,private clientId:string,private openExternal:(url:string)=>Promise<void>,private changed:()=>Promise<void>=async()=>{}){}
  get redirectUrl(){return this.data.redirect??'http://127.0.0.1:1/oauth/callback'}
  get clientMetadata():OAuthClientMetadata{return { client_name:'Actvero Harness',redirect_uris:[this.redirectUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none' }}
  state(){return this.nonce}
  clientInformation(){return this.clientId?{ client_id:this.clientId }:this.data.client}
  async saveClientInformation(client:OAuthClientInformationMixed){this.data.client=client;await this.changed()}
  tokens(){return this.data.tokens}
  async saveTokens(tokens:OAuthTokens){this.data.tokens=tokens;await this.changed()}
  async redirectToAuthorization(url:URL){
    if(!this.server)return bad('authorization_required')
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))return bad('unsafe_authorization_url')
    await this.openExternal(url.href)
  }
  saveCodeVerifier(value:string){this.verifier=value}
  codeVerifier(){if(!this.verifier)return bad('authorization_required');return this.verifier}
  async invalidateCredentials(scope:string){if(scope==='all'||scope==='client')this.data.client=undefined;if(scope==='all'||scope==='tokens')this.data.tokens=undefined;if(scope==='all'||scope==='verifier')this.verifier='';await this.changed()}
  async authorize(url:string,signal:AbortSignal){
    this.code=new Promise<string>((resolve,reject)=>{this.resolveCode=resolve;this.rejectCode=reject})
    // Attach a handler before discovery can fail or the cancellation signal arrives.
    void this.code.catch(()=>{})
    this.server=createServer((req,res)=>{
      const incoming=new URL(req.url??'/',this.redirectUrl),state=Buffer.from(incoming.searchParams.get('state')??''),expected=Buffer.from(this.nonce)
      if(req.method!=='GET'||incoming.pathname!=='/oauth/callback'||state.length!==expected.length||!timingSafeEqual(state,expected)){res.writeHead(400);res.end('Invalid callback');return}
      res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store')
      if(incoming.searchParams.has('error')){res.end('Authorization cancelled. Return to Actvero.');this.rejectCode?.(Object.assign(new Error('authorization_cancelled'),{ code:'authorization_cancelled' }))}
      else {const code=incoming.searchParams.get('code');if(!code){res.writeHead(400);res.end('Missing code');return}res.end('Authorization received. Return to Actvero.');this.resolveCode?.(code)}
    })
    try{
      await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(0,'127.0.0.1',resolve)})
      const address=this.server.address();if(!address||typeof address==='string')return bad('authorization_failed')
      this.data.redirect=`http://127.0.0.1:${address.port}/oauth/callback`
      // A dynamic registration is bound to its redirect URI. Register the new loopback URI.
      if(!this.clientId)this.data.client=undefined
      this.abort=()=>this.rejectCode?.(Object.assign(new Error('authorization_cancelled'),{ code:'authorization_cancelled' }))
      signal.addEventListener('abort',this.abort,{ once:true });if(signal.aborted)this.abort()
      this.timer=setTimeout(()=>this.rejectCode?.(Object.assign(new Error('authorization_timeout'),{ code:'authorization_timeout' })),180_000)
      const fetchFn:typeof fetch=(input,init)=>fetch(input,{ ...init,signal:AbortSignal.any([signal,AbortSignal.timeout(20_000)]) })
      const result=await auth(this,{ serverUrl:url,fetchFn })
      if(result==='REDIRECT'){const code=await this.code;await auth(this,{ serverUrl:url,authorizationCode:code,fetchFn })}
      signal.throwIfAborted();return this.data
    }finally{if(this.abort)signal.removeEventListener('abort',this.abort);clearTimeout(this.timer);this.server.closeAllConnections();this.server.close();this.server=undefined;this.verifier=''}
  }
}
