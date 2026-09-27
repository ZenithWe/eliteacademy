import {validateBuyer} from '../_shared/identity.ts';
import {cors,db,env,HttpError,json,mp,processInvoice,ready,safeCheckout,site,syncPreapproval} from '../_shared/mp.ts';

Deno.serve(async (req: Request) => {
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  if(req.method==='GET') return json({enabled:ready()},200,true);
  if(req.method!=='POST') return json({error:'Método não permitido.'},405,true);
  try {
    const token = req.headers.get('Authorization') || '';
    if(!/^Bearer .+/.test(token)) throw new HttpError(401,'Entre na sua conta de aluno para continuar.');
    const auth = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`,{headers:{
      Authorization:token,apikey:env('SUPABASE_ANON_KEY')},signal:AbortSignal.timeout(8000)});
    if(!auth.ok) throw new HttpError(401,'Entre novamente na sua conta de aluno.');
    const user = await auth.json();
    if(!user.email_confirmed_at || user.is_anonymous) throw new HttpError(403,'Confirme seu e-mail antes de assinar.');
    const body = await req.json();
    if(!env('MP_ACCESS_TOKEN')) throw new HttpError(503,'Pagamento automático ainda não está disponível.');
    const open = await db(`elite_mp_checkouts?user_id=eq.${user.id}&status=in.(creating,pending,authorized,paused)&select=*`);
    let current = open[0];
    if(body.action==='cancel') {
      if(!current?.preapproval_id) throw new HttpError(409,'Nenhuma assinatura disponível para cancelar.');
      await mp(`/preapproval/${current.preapproval_id}`,'PUT',{status:'cancelled'});
      await syncPreapproval(current.preapproval_id);
      return json({cancelled:true},200,true);
    }
    if(body.action==='refresh') {
      if(current?.preapproval_id) {
        await syncPreapproval(current.preapproval_id);
        const result = await mp(`/authorized_payments/search?preapproval_id=${current.preapproval_id}&limit=10`);
        for(const invoice of result.results || []) await processInvoice(invoice);
      }
      return json({refreshed:true},200,true);
    }
    if(body.action!=='checkout') throw new HttpError(400,'Operação inválida.');
    if(!ready()) throw new HttpError(503,'Pagamento automático ainda não está disponível.');
    const buyer=await validateBuyer(user,body);
    if(body.privacy_consent!==true || body.recurring_consent!==true) throw new HttpError(400,'Confirme os termos e a cobrança mensal.');
    if(!/^[0-9a-f-]{36}$/.test(body.plan_id || '')) throw new HttpError(400,'Plano inválido.');
    if(current) {
      if(current.plan_id===body.plan_id && current.status==='pending' && current.checkout_url)
        return json({checkout_url:safeCheckout(current.checkout_url)},200,true);
      throw new HttpError(409,'Você já tem uma assinatura em andamento. Consulte ou cancele na área do aluno antes de iniciar outra.');
    }
    const plans = await db(`elite_plans?id=eq.${body.plan_id}&active=eq.true&select=*`);
    const plan = plans[0];
    if(!plan || !(Number(plan.price_monthly)>0)) throw new HttpError(400,'Plano indisponível.');
    const name=buyer.name,phone=buyer.phone;
    const recent = await db(`elite_mp_checkouts?user_id=eq.${user.id}&created_at=gte.${encodeURIComponent(new Date(Date.now()-3600000).toISOString())}&select=id&limit=6`);
    if(recent.length>=5) throw new HttpError(429,'Muitas tentativas. Aguarde antes de iniciar outra assinatura.');
    [current] = await db('elite_mp_checkouts','POST',{
      user_id:user.id,plan_id:plan.id,plan_name:plan.name,amount:plan.price_monthly,
      plan_level:plan.plan_level,vod_quota:plan.vod_quota,coach_quota:plan.coach_quota,
      live_coach_quota:plan.live_coach_quota,customer_name:name,customer_email:user.email,
      customer_phone:phone,customer_cpf_last4:buyer.cpf.slice(-4),identity_level:buyer.level,consent_version:'2026-09-27-identity',
    });
    // Do not blindly retry this POST. A timeout may have created a subscription.
    // The unique open checkout remains locked for support reconciliation.
    const pre = await mp('/preapproval','POST',{
      reason:`Elite Academy — ${plan.name}`,external_reference:current.id,payer_email:user.email,
      auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:Number(plan.price_monthly),currency_id:'BRL'},
      back_url:site+'?pagamento=retorno#aluno',status:'pending',
    });
    const url = safeCheckout(pre.init_point);
    await db(`elite_mp_checkouts?id=eq.${current.id}`,'PATCH',{
      preapproval_id:String(pre.id),checkout_url:url,status:'pending',
    });
    return json({checkout_url:url},200,true);
  } catch(error) {
    const known = error instanceof HttpError;
    return json({error:known?error.message:'Não foi possível concluir. Atualize a área do aluno ou fale com o suporte.'},known?error.status:500,true);
  }
});
