import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifySignature,safeCheckout,validId,processInvoice} from '../supabase/functions/_shared/mp.ts';
const secret='test-secret-not-a-credential';
const id='ABC123',rid='test-request',ts='1704908010';
const signature=createHmac('sha256',secret).update(`id:${id.toLowerCase()};request-id:${rid};ts:${ts};`).digest('hex');
function request(dataId=id,sig=signature){return new Request(`https://example.test/hook?data.id=${dataId}`,{headers:{'x-request-id':rid,'x-signature':`ts=${ts},v1=${sig}`}})}
test('accepts valid HMAC, including provider retry timestamps',async()=>assert.equal(await verifySignature(request(),secret),true));
test('rejects modified ID and wrong signature',async()=>{assert.equal(await verifySignature(request('other'),secret),false);assert.equal(await verifySignature(request(id,'0'.repeat(64)),secret),false)});
test('rejects missing signature',async()=>assert.equal(await verifySignature(new Request('https://example.test'),secret),false));
test('checkout restricts HTTPS and exact provider hostname',()=>{assert.ok(safeCheckout('https://www.mercadopago.com.br/subscriptions/checkout?x=1'));for(const url of ['javascript:alert(1)','http://www.mercadopago.com.br/','https://www.mercadopago.com.br.evil.test/'])assert.throws(()=>safeCheckout(url))});
test('resource IDs cannot inject URLs or query parameters',()=>{assert.equal(validId(123), '123');for(const id of ['../x','123&x=1',''])assert.throws(()=>validId(id))});
test('payment is re-fetched and checked before database activation',async()=>{
 globalThis.Deno={env:{get:()=>undefined}};
 const original=globalThis.fetch;let activated=false;
 const checkout={id:'checkout',amount:15};
 globalThis.fetch=async url=>{
   if(String(url).includes('elite_mp_checkouts'))return Response.json([checkout]);
   if(String(url).includes('/preapproval/'))return Response.json({external_reference:'checkout',auto_recurring:{transaction_amount:15,currency_id:'BRL'},collector_id:1});
   if(String(url).includes('/v1/payments/'))return Response.json({id:123,transaction_amount:1,currency_id:'BRL',collector_id:1,live_mode:true,status:'approved'});
   activated=true;return Response.json({});
 };
 try{await assert.rejects(()=>processInvoice({id:99,preapproval_id:'pre',payment:{id:123},transaction_amount:15,currency_id:'BRL'}));assert.equal(activated,false)}finally{globalThis.fetch=original}
});
