import {cors,db,HttpError,json} from '../_shared/mp.ts';
import {authenticatedBuyer,identityConfig,attempt,validateBuyer,sendPhoneCode,checkPhoneCode,checkCPF} from '../_shared/identity.ts';

export async function handler(req:Request){
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method==='GET')return json(identityConfig(),200,true);
 if(req.method!=='POST')return json({error:'Método não permitido.'},405,true);
 try{
  if(Number(req.headers.get('content-length'))>16384)throw new HttpError(413,'Solicitação muito grande.');
  const user=await authenticatedBuyer(req);
  const text=await req.text();if(text.length>16384)throw new HttpError(413,'Solicitação muito grande.');
  let body;try{body=JSON.parse(text)}catch{throw new HttpError(400,'Solicitação inválida.')}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Solicitação inválida.');
  if(body.action==='send_phone')return json(await sendPhoneCode(user,body),200,true);
  if(body.action==='check_phone')return json(await checkPhoneCode(user,body),200,true);
  if(body.action==='check_cpf')return json(await checkCPF(user,body),200,true);
  if(body.action!=='order')throw new HttpError(400,'Operação inválida.');
  const buyer=await validateBuyer(user,body);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.item_id||''))throw new HttpError(400,'Item inválido.');
  await attempt('orders:'+user.id,10,3600,3);
  let name='',variant='',amount=0,checkout='';
  if(body.item_type==='plan'){
   const plan=(await db(`elite_plans?id=eq.${body.item_id}&active=eq.true&select=*`))[0];
   if(!plan)throw new HttpError(400,'Plano indisponível.');
   name=plan.name;variant='Plano '+plan.group_type.toUpperCase();amount=Number(plan.price_monthly);checkout=plan.checkout_url||'';
  }else if(body.item_type==='product'){
   const v=(await db(`elite_product_variants?id=eq.${body.item_id}&active=eq.true&select=*`))[0];
   if(!v)throw new HttpError(400,'Produto indisponível.');
   const product=(await db(`elite_products?id=eq.${v.product_id}&active=eq.true&select=*`))[0];
   if(!product)throw new HttpError(400,'Produto indisponível.');
   name=product.name;variant=v.label;amount=Number(v.price);checkout=v.checkout_url||'';
  }else throw new HttpError(400,'Tipo de compra inválido.');
  if(!Number.isFinite(amount)||amount<0)throw new HttpError(400,'Preço indisponível.');
  const code='EA-'+crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
  const message=`Olá! Quero resgatar minha solicitação da Elite Academy.\n\nCódigo: ${code}\nProduto/Plano: ${name} — ${variant}\nValor: ${amount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}\nNome completo: ${buyer.name}\nE-mail: ${buyer.email}\nTelefone: ${buyer.phone}\n\nJá registrei meus dados no site. Estou abrindo este ticket para concluir o atendimento e resgatar o que selecionei.`;
  const now=new Date().toISOString();
  await db('elite_orders','POST',{redemption_code:code,item_type:body.item_type,item_id:body.item_id,item_name:name,item_variant:variant,amount,
   customer_name:buyer.name,customer_email:buyer.email,customer_phone:buyer.phone,buyer_user_id:user.id,customer_cpf_last4:buyer.cpf.slice(-4),identity_level:buyer.level,
   status:'novo',redemption_message:message,privacy_consent_at:now,terms_consent_at:now,consent_version:'2026-09-27-identity'});
  // No raw CPF, date of birth, OTP or provider response is saved in the order/message.
  return json({code,message,checkout_url:/^https:\/\//i.test(checkout)?checkout:''},200,true);
 }catch(error){
  return json({error:error instanceof HttpError?error.message:'Não foi possível concluir a verificação. Tente novamente.'},error instanceof HttpError?error.status:500,true);
 }
}
Deno.serve(handler);
