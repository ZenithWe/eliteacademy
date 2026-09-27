import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validCPF,normalizeCPF,normalizePhone,validName,formatBirthDate} from '../identity-validation.js';
const settings={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service'};
globalThis.Deno={env:{get:k=>settings[k]||''},serve:()=>{}};
const {handler}=await import('../supabase/functions/elite-buyer-verification/index.ts');
const {validateBuyer,fingerprint,sendPhoneCode,checkPhoneCode,checkCPF}=await import('../supabase/functions/_shared/identity.ts');
const {HttpError}=await import('../supabase/functions/_shared/mp.ts');
const cpf='40442820135'; // Official SERPRO fictitious fixture, never sent to a provider.
const uid='11111111-1111-4111-8111-111111111111',pid='22222222-2222-4222-8222-222222222222';
const user={id:uid,email:'owner@example.invalid',email_confirmed_at:'2026-09-01T00:00:00Z'};
const body={action:'order',item_type:'plan',item_id:pid,customer_name:'Pessoa Teste',customer_email:'forged@example.invalid',customer_phone:'(31) 98765-4321',customer_cpf:cpf,customer_birthdate:'1970-11-14',privacy_consent:true,terms_consent:true,amount:0.01};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const req=b=>new Request('https://edge.example',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(b)});
let stored;
function mockBase({authUser=user,record={},rate=true}={}){
 globalThis.fetch=async(url,opt={})=>{
  const path=new URL(url).pathname;
  if(path==='/auth/v1/user')return json(authUser);
  if(path==='/rest/v1/rpc/elite_identity_take_attempt')return json(rate);
  if(path==='/rest/v1/elite_plans')return json([{id:pid,name:'Plano do catálogo',group_type:'solo',price_monthly:15}]);
  if(path==='/rest/v1/elite_buyer_verifications')return opt.method==='POST'?(stored=JSON.parse(opt.body),new Response(null,{status:204})):json([record]);
  if(path==='/rest/v1/elite_orders'){stored=JSON.parse(opt.body);return json([stored]);}
  throw new Error('Unexpected request '+path);
 };
}
test('CPF uses check digits, rejects repeats and arbitrary characters',()=>{
 assert.equal(validCPF(cpf),true);assert.equal(validCPF('404.428.201-35'),true);
 for(const v of ['11111111111','00000000000','40442820134','abc'+cpf,'123',''])assert.equal(validCPF(v),false);
 assert.equal(normalizeCPF('404.428.201-35'),cpf);
});
test('Brazilian mobile format, DDD, complete name and dates',()=>{
 assert.equal(normalizePhone('(31) 98765-4321'),'+5531987654321');
 assert.equal(normalizePhone('+55 31 98765-4321'),'+5531987654321');
 for(const v of ['123','+1 3125550199','(20) 98765-4321','(31) 3333-4444','(31) 99999-9999'])assert.equal(normalizePhone(v),'');
 assert.equal(validName('João da Silva'),true);assert.equal(validName('abc'),false);
 assert.equal(formatBirthDate('1970-11-14'),'14111970');assert.equal(formatBirthDate('2025-02-30'),'');
});
test('anonymous and unconfirmed e-mail cannot create a purchase',async()=>{
 const anon=await handler(new Request('https://edge.example',{method:'POST',body:'{}'}));assert.equal(anon.status,401);
 mockBase({authUser:{...user,email_confirmed_at:null}});assert.equal((await handler(req(body))).status,403);
 mockBase({authUser:{...user,is_anonymous:true}});assert.equal((await handler(req(body))).status,403);
});
test('manual checkout fixes identity and price on server and stores only CPF suffix',async()=>{
 mockBase();const response=await handler(req(body));assert.equal(response.status,200);const result=await response.json();
 assert.equal(stored.amount,15);assert.equal(stored.customer_email,user.email);assert.equal(stored.buyer_user_id,uid);
 assert.equal(stored.customer_cpf_last4,'0135');assert.equal(stored.identity_level,'email_and_format');
 assert.equal(JSON.stringify(stored).includes(cpf),false);assert.equal(result.message.includes(cpf),false);
 assert.equal(stored.customer_cpf,undefined);assert.equal(stored.customer_birthdate,undefined);
});
test('invalid CPF, missing consent, invalid item and rate limits block orders',async()=>{
 for(const changes of [{customer_cpf:'11111111111'},{privacy_consent:false},{item_id:'bad'}]){
  mockBase();assert.equal((await handler(req({...body,...changes}))).status,400);
 }
 mockBase({rate:false});assert.equal((await handler(req(body))).status,429);
});
test('strict mode fails closed when services or proofs are missing',async()=>{
 settings.IDENTITY_STRICT='true';
 await assert.rejects(validateBuyer(user,body),e=>e instanceof HttpError&&e.status===503);
 Object.assign(settings,{TWILIO_ACCOUNT_SID:'test',TWILIO_AUTH_TOKEN:'test',TWILIO_VERIFY_SERVICE_SID:'test',SERPRO_CONSUMER_KEY:'test',SERPRO_CONSUMER_SECRET:'test'});
 mockBase();await assert.rejects(validateBuyer(user,body),/Confirme seu celular/);
 const record={phone:'+5531987654321',phone_line_type:'mobile',phone_verified_at:new Date().toISOString(),cpf_fingerprint:await fingerprint(cpf+'|14111970|PESSOA TESTE'),cpf_registry_verified_at:new Date().toISOString()};
 mockBase({record});assert.equal((await validateBuyer(user,body)).level,'email_sms_registry');
 await assert.rejects(validateBuyer(user,{...body,customer_phone:'(11) 98765-4321'}),/Confirme seu celular/);
 await assert.rejects(validateBuyer(user,{...body,customer_name:'Outra Pessoa'}),/Consulte seu CPF/);
 mockBase({record:{...record,phone_verified_at:'2020-01-01'}});await assert.rejects(validateBuyer(user,body),/Confirme seu celular/);
});
test('VoIP is rejected before any SMS is sent',async()=>{
 mockBase();const base=globalThis.fetch;
 globalThis.fetch=async(url,opt)=>new URL(url).hostname==='lookups.twilio.com'?json({valid:true,line_type_intelligence:{type:'nonFixedVoip',error_code:null}}):base(url,opt);
 await assert.rejects(sendPhoneCode(user,{...body,verification_consent:true}),/Números virtuais/);
});
test('SMS challenge is bound to user and phone; wrong code never verifies',async()=>{
 const record={challenge_phone:'+5531987654321',challenge_sid:'VE'+'a'.repeat(32),challenge_expires_at:new Date(Date.now()+60000).toISOString()};
 mockBase({record});const base=globalThis.fetch;
 globalThis.fetch=async(url,opt)=>new URL(url).hostname==='verify.twilio.com'?json({status:'pending',valid:false}):base(url,opt);
 await assert.rejects(checkPhoneCode(user,{...body,code:'123456'}),/Código inválido/);
 await assert.rejects(checkPhoneCode(user,{...body,customer_phone:'11987654321',code:'123456'}),/Solicite um novo código/);
});
test('CPF provider restrictions and mismatches never mark verification successful',async()=>{
 for(const status of [206,422,451]){
  mockBase();const base=globalThis.fetch;
  globalThis.fetch=async(url,opt)=>new URL(url).pathname==='/token'?json({access_token:'mock',expires_in:3600}):new URL(url).hostname==='gateway.apiserpro.serpro.gov.br'?json({},status):base(url,opt);
  await assert.rejects(checkCPF(user,{...body,verification_consent:true}),/Não foi possível confirmar/);
 }
 settings.IDENTITY_STRICT='false';
});
test('frontend and edge validation stay identical',()=>assert.equal(fs.readFileSync(new URL('../identity-validation.js',import.meta.url),'utf8'),fs.readFileSync(new URL('../supabase/functions/_shared/identity-validation.js',import.meta.url),'utf8')));
