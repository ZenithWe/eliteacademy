// Public client: provider credentials exist only in Supabase Edge secrets.
export function createPayments(sb) {
  const endpoint = 'https://rtbempkgmiguaongajlj.supabase.co/functions/v1/elite-mp-checkout';
  let enabled = false;
  const availability = fetch(endpoint, {signal:AbortSignal.timeout(6000)})
    .then(r => {if(!r.ok) throw new Error(); return r.json();})
    .then(data => enabled = data.enabled === true).catch(() => false);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const allowedUrl = value => {
    try {const u=new URL(value);return u.protocol==='https:' && ['www.mercadopago.com.br','www.mercadopago.com'].includes(u.hostname)?u.href:null;}catch{return null;}
  };
  async function call(body) {
    const {data:{session}} = await sb.auth.getSession();
    if(!session) throw new Error('Entre ou crie sua conta na área do aluno antes de assinar.');
    const response = await fetch(endpoint,{method:'POST',headers:{
      Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }
  const billing = document.createElement('div');
  billing.id = 'studentBilling';
  document.getElementById('studentLoggedIn')?.append(billing);
  const recurring = document.createElement('label');
  recurring.id = 'mpRecurringLabel';
  recurring.className = 'hidden';
  recurring.innerHTML = '<input type="checkbox" id="mpRecurringConsent"><span id="mpRecurringText"></span>';
  document.querySelector('#purchaseForm .consent-box')?.append(recurring);
  const billingNotice = document.createElement('p');
  billingNotice.className = 'privacy-note';
  billingNotice.id = 'mpPurchaseNotice';
  document.getElementById('purchaseSubmit')?.before(billingNotice);

  async function prepare(item) {
    await availability;
    const automatic = enabled && item.item_type === 'plan';
    recurring.classList.toggle('hidden',!automatic);
    const checkbox=document.getElementById('mpRecurringConsent');
    checkbox.required=automatic;checkbox.checked=false;
    document.getElementById('mpRecurringText').textContent=`Autorizo a assinatura de ${Number(item.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} por mês, com renovação automática até o cancelamento na área do aluno.`;
    document.getElementById('purchaseSubmit').textContent=automatic?'Assinar com Mercado Pago':'Registrar e continuar';
    document.getElementById('customerEmail').readOnly=false;
    billingNotice.textContent='';
    if(automatic) {
      const {data:{user}}=await sb.auth.getUser();
      billingNotice.textContent=user?'O acesso será liberado após a confirmação do pagamento.':'Antes de assinar, entre ou crie sua conta na área do aluno.';
      if(user){document.getElementById('customerEmail').value=user.email;document.getElementById('customerEmail').readOnly=true;}
    }
    return automatic;
  }
  async function pay(item, data) {
    await availability;
    if(!enabled || item.item_type!=='plan') return false;
    const button=document.getElementById('purchaseSubmit');
    button.disabled=true;button.textContent='Abrindo pagamento…';
    try {
      const {data:{session}}=await sb.auth.getSession();
      if(!session){document.getElementById('purchaseClose').click();location.hash='aluno';document.getElementById('studentNotice').textContent='Entre ou crie sua conta e depois selecione o plano para assinar.';return true;}
      const result=await call({action:'checkout',plan_id:item.item_id,
        customer_name:data.customer_name,customer_phone:data.customer_phone,
        privacy_consent:document.getElementById('privacyConsent').checked && document.getElementById('termsConsent').checked,
        recurring_consent:document.getElementById('mpRecurringConsent').checked});
      const url=allowedUrl(result.checkout_url);
      if(!url) throw new Error('Não foi possível validar o endereço do pagamento.');
      location.assign(url);
    }catch(error){billingNotice.textContent=error.message || 'Confira sua área do aluno antes de tentar novamente.';}
    finally{button.disabled=false;button.textContent='Assinar com Mercado Pago';}
    return true;
  }
  async function loadBilling() {
    const {data:{user}}=await sb.auth.getUser();
    billing.replaceChildren();
    if(!user) return;
    const {data,error}=await sb.from('elite_mp_checkouts').select('plan_name,status,checkout_url,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(1);
    if(error || !data?.length) return;
    const c=data[0],url=allowedUrl(c.checkout_url);
    const labels={creating:'Preparando assinatura — fale com o suporte se não atualizar.',pending:'Aguardando pagamento',authorized:'Renovação automática habilitada',paused:'Renovação pausada',cancelled:'Renovação cancelada'};
    billing.innerHTML=`<div class="student-card" style="margin-top:20px"><h3>Pagamento · ${esc(c.plan_name)}</h3><p>${esc(labels[c.status]||c.status)}</p><p>O acesso depende de um período pago. Cancelar impede novas cobranças e mantém o período já pago.</p><div class="flow-actions">${c.status==='pending'&&url?`<a class="btn primary" href="${esc(url)}">Continuar pagamento</a>`:''}<button class="btn ghost" type="button" data-mp-action="refresh">Atualizar pagamento</button>${['pending','authorized','paused'].includes(c.status)?'<button class="btn ghost" type="button" data-mp-action="cancel">Cancelar renovação</button>':''}</div><p id="mpBillingNotice" role="status"></p></div>`;
  }
  billing.addEventListener('click',async event=>{
    const button=event.target.closest('[data-mp-action]');if(!button)return;
    const action=button.dataset.mpAction;
    if(action==='cancel' && !confirm('Cancelar a renovação automática? O período já pago continuará disponível.'))return;
    button.disabled=true;const notice=document.getElementById('mpBillingNotice');notice.textContent='Atualizando…';
    try{await call({action});await loadBilling();document.dispatchEvent(new Event('elite-payment-updated'));}
    catch(error){notice.textContent=error.message;}finally{button.disabled=false;}
  });
  sb.auth.onAuthStateChange(()=>setTimeout(loadBilling,0));
  loadBilling();
  if(new URLSearchParams(location.search).get('pagamento')==='retorno') {
    const note=document.createElement('p');note.className='privacy-note';note.setAttribute('role','status');
    note.textContent='Estamos aguardando a confirmação do Mercado Pago. O retorno ao site não confirma o pagamento. Entre na sua conta e use “Atualizar pagamento” para consultar.';
    document.querySelector('#aluno .student-box')?.prepend(note);
  }
  return {prepare,pay};
}
