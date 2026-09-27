import {validCPF,normalizeCPF,normalizePhone,validName,normalizeName} from './identity-validation.js';
export function createBuyerVerification(sb){
 const endpoint='https://rtbempkgmiguaongajlj.supabase.co/functions/v1/elite-buyer-verification';
 const $=id=>document.getElementById(id);
 const panel=document.createElement('section');panel.className='buyer-verification';
 panel.innerHTML=`<h3>1. Confirme sua conta</h3><p id="buyerAccountStatus" role="status" aria-live="polite"></p>
 <div id="buyerLoginFields"><div class="purchase-fields"><div class="field"><label for="buyerLoginEmail">E-mail da conta</label><input id="buyerLoginEmail" type="email" autocomplete="email" maxlength="254"></div><div class="field"><label for="buyerLoginPassword">Senha</label><input id="buyerLoginPassword" type="password" autocomplete="current-password" minlength="6"></div></div>
 <div class="flow-actions"><button type="button" class="btn primary" id="buyerLogin">Entrar</button><button type="button" class="btn ghost" id="buyerSignup">Criar conta</button><button type="button" class="btn ghost" id="buyerResend">Reenviar confirmação</button></div></div>
 <button type="button" id="buyerSwitch" class="btn ghost hidden">Trocar conta</button>`;
 $('purchaseForm').before(panel);
 const emailHelp=document.createElement('small');emailHelp.id='buyerEmailHelp';
 const emailAction=document.createElement('button');emailAction.type='button';emailAction.className='btn ghost';emailAction.textContent='Entrar ou confirmar e-mail';
 $('customerEmail').after(emailHelp,emailAction);$('customerEmail').setAttribute('aria-describedby','buyerEmailHelp');
 $('customerEmail').addEventListener('input',()=>{$('buyerLoginEmail').value=$('customerEmail').value});
 $('buyerLoginEmail').addEventListener('input',()=>{if(!$('customerEmail').readOnly)$('customerEmail').value=$('buyerLoginEmail').value});
 emailAction.addEventListener('click',async()=>{
  if($('customerEmail').readOnly)await sb.auth.signOut();
  await syncAccount();$('buyerLoginEmail').scrollIntoView({block:'center'});$('buyerLoginEmail').focus();
 });
 const notice=document.createElement('p');notice.id='buyerNotice';notice.className='privacy-note';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');$('purchaseSubmit').before(notice);
 let config=null,busy=false,resendAt=0;
 const availability=fetch(endpoint,{signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw new Error();return r.json()}).then(c=>config=c).catch(()=>null);
 const show=message=>notice.textContent=message;
 async function syncAccount(){
  const {data:{user},error}=await sb.auth.getUser();
  const verified=!error&&user?.email_confirmed_at&&!user.is_anonymous;
  $('buyerLoginFields').classList.toggle('hidden',!!verified);$('buyerSwitch').classList.toggle('hidden',!verified);
  $('buyerAccountStatus').textContent=verified?'E-mail confirmado: '+user.email:'Entre ou crie sua conta e confirme o link recebido por e-mail. A compra fica vinculada a essa conta.';
  $('customerEmail').readOnly=!!verified;
  if(verified)$('customerEmail').value=user.email;
  else $('customerEmail').value=$('buyerLoginEmail').value||$('customerEmail').value;
  emailHelp.textContent=verified?'Este é o e-mail confirmado que receberá o acesso. Para usar outro, troque a conta.':'Digite seu e-mail e entre ou crie sua conta na etapa 1 para confirmá-lo.';
  emailAction.textContent=verified?'Trocar conta / e-mail':'Entrar ou confirmar e-mail';
  return verified?user:null;
 }
 async function accountAction(action){
  const email=$('buyerLoginEmail').value.trim().toLowerCase(),password=$('buyerLoginPassword').value;
  if(!$('buyerLoginEmail').checkValidity()||!email){$('buyerAccountStatus').textContent='Informe um e-mail válido.';return}
  if(action!=='resend'&&password.length<6){$('buyerAccountStatus').textContent='Informe uma senha com pelo menos 6 caracteres.';return}
  if(action==='resend'&&Date.now()<resendAt){$('buyerAccountStatus').textContent='Aguarde um minuto antes de reenviar.';return}
  const buttons=panel.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
  try{
   const redirect=new URL('./index.html',location.href).href;
   const result=action==='login'?await sb.auth.signInWithPassword({email,password}):action==='signup'?await sb.auth.signUp({email,password,options:{emailRedirectTo:redirect}}):await sb.auth.resend({type:'signup',email,options:{emailRedirectTo:redirect}});
   if(result.error){$('buyerAccountStatus').textContent=result.error.code==='email_not_confirmed'?'Confirme o e-mail antes de entrar. Você pode reenviar a confirmação.':result.error.status===429?'Muitas tentativas. Aguarde alguns minutos.':'Não foi possível concluir. Confira seus dados. Se já possui conta, use Entrar.';return}
   if(action==='resend')resendAt=Date.now()+60000;
   if(action==='login'||result.data?.session)await syncAccount();
   else $('buyerAccountStatus').textContent='Se o endereço estiver apto, você receberá um link. Confira a caixa de entrada e o spam; depois volte e entre para comprar.';
  }catch{$('buyerAccountStatus').textContent='Não foi possível conectar. Tente novamente.'}
  finally{$('buyerLoginPassword').value='';buttons.forEach(b=>b.disabled=false)}
 }
 $('buyerLogin').addEventListener('click',()=>accountAction('login'));
 $('buyerSignup').addEventListener('click',()=>accountAction('signup'));
 $('buyerResend').addEventListener('click',()=>accountAction('resend'));
 $('buyerSwitch').addEventListener('click',async()=>{await sb.auth.signOut();await syncAccount()});
 $('buyerLoginPassword').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();accountAction('login')}});
 const cpf=$('customerCPF'),phone=$('customerPhone'),name=$('customerName');
 const validate=()=>{
  cpf.setCustomValidity(cpf.value&&!validCPF(cpf.value)?'Confira os 11 dígitos do CPF.':'');
  phone.setCustomValidity(phone.value&&!normalizePhone(phone.value)?'Informe celular brasileiro com DDD e 9 dígitos.':'');
  name.setCustomValidity(name.value&&!validName(name.value)?'Informe nome e sobrenome.':'');
 };
 for(const input of [cpf,phone,name])input.addEventListener('input',()=>{validate();show('')});
 cpf.addEventListener('blur',()=>{const n=normalizeCPF(cpf.value);if(n.length===11)cpf.value=n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4')});
 const fields=()=>({...Object.fromEntries(new FormData($('purchaseForm'))),verification_consent:$('verificationConsent').checked});
 async function call(body){
  const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('Entre na sua conta antes de continuar.');
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível concluir.');return result;
 }
 for(const [id,action,success] of [['sendPhoneCode','send_phone','Código enviado. Confira o SMS.'],['checkPhoneCode','check_phone','Celular confirmado por SMS.'],['checkBuyerCPF','check_cpf','CPF e dados cadastrais conferidos.']]){
  $(id).addEventListener('click',async()=>{
   if(busy)return;busy=true;const button=$(id);button.disabled=true;show('Verificando…');
   try{await call({...fields(),action,code:$('phoneCode').value});show(success);if(action==='check_phone')$('phoneCode').value=''}
   catch(error){show(error.message||'Não foi possível verificar.')}
   finally{busy=false;button.disabled=false}
  });
 }
 async function prepare(){
  await availability;show('');await syncAccount();
  const strict=config?.strict===true;
  $('buyerExtendedVerification').classList.toggle('hidden',!strict);
  $('birthDateField').classList.toggle('hidden',!strict);$('customerBirthdate').required=strict;
  $('verificationConsent').required=strict;
  $('cpfHelp').textContent=strict?'Informe seus próprios dados para conferência cadastral.':'';
  $('phoneHelp').textContent=strict?'Confirme o código recebido neste celular. Números virtuais não são aceitos.':'';
  validate();
 }
 async function beforeSubmit(data){
  validate();if(!$('purchaseForm').reportValidity())return false;
  const user=await syncAccount();if(!user){show('Entre e confirme seu e-mail para continuar.');$('buyerLoginEmail').focus();return false}
  data.customer_email=user.email;data.customer_phone=normalizePhone(data.customer_phone);data.customer_cpf=normalizeCPF(data.customer_cpf);data.customer_name=normalizeName(data.customer_name);
  return true;
 }
 async function order(item,data){return call({...data,action:'order',item_type:item.item_type,item_id:item.item_id,privacy_consent:$('privacyConsent').checked,terms_consent:$('termsConsent').checked})}
 sb.auth.onAuthStateChange(()=>{if(!$('purchaseOverlay').classList.contains('hidden'))setTimeout(syncAccount,0)});
 return {prepare,beforeSubmit,order,show};
}
