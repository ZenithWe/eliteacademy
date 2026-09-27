import {db,env,HttpError} from './mp.ts';
import {validCPF,normalizeCPF,normalizePhone,normalizeName,validName,formatBirthDate} from './identity-validation.js';

export const identityConfig=()=>({
 strict:env('IDENTITY_STRICT')==='true',
 phone_available:!!(env('TWILIO_ACCOUNT_SID')&&env('TWILIO_AUTH_TOKEN')&&env('TWILIO_VERIFY_SERVICE_SID')),
 cpf_available:!!(env('SERPRO_CONSUMER_KEY')&&env('SERPRO_CONSUMER_SECRET')),
});
export async function authenticatedBuyer(req:Request){
 const token=req.headers.get('Authorization')||'';
 if(!/^Bearer .+/.test(token))throw new HttpError(401,'Entre na sua conta para continuar.');
 const response=await fetch(`${env('SUPABASE_URL')}/auth/v1/user`,{headers:{Authorization:token,apikey:env('SUPABASE_ANON_KEY')},signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new HttpError(401,'Entre novamente na sua conta.');
 const user=await response.json();
 if(!user.email||!user.email_confirmed_at||user.is_anonymous)throw new HttpError(403,'Confirme o link enviado ao seu e-mail antes de comprar.');
 return user;
}
export async function attempt(subject:string,limit:number,window:number,cooldown=0){
 const allowed=await db('rpc/elite_identity_take_attempt','POST',{p_subject:subject,p_limit:limit,p_window_seconds:window,p_cooldown_seconds:cooldown});
 if(allowed!==true)throw new HttpError(429,'Muitas tentativas. Aguarde antes de tentar novamente.');
}
export async function identityRecord(userId:string){
 return (await db(`elite_buyer_verifications?user_id=eq.${userId}&select=*`))[0]||{};
}
export async function saveIdentity(userId:string,fields:Record<string,unknown>){
 const response=await fetch(`${env('SUPABASE_URL')}/rest/v1/elite_buyer_verifications?on_conflict=user_id`,{
 method:'POST',headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
 'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:userId,...fields,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new HttpError(503,'Não foi possível salvar a verificação. Tente novamente.');
}
export async function fingerprint(value:string){
 const secret=env('IDENTITY_HMAC_KEY')||env('SUPABASE_SERVICE_ROLE_KEY');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('elite-identity-v1:'+value));
 return Array.from(new Uint8Array(signature)).map(v=>v.toString(16).padStart(2,'0')).join('');
}
export const canonicalName=(name:string)=>normalizeName(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
export function buyerFields(body:any){
 const name=normalizeName(body.customer_name),phone=normalizePhone(body.customer_phone),cpf=normalizeCPF(body.customer_cpf);
 if(!validName(name))throw new HttpError(400,'Informe seu nome completo, com nome e sobrenome.');
 if(!phone)throw new HttpError(400,'Informe um celular brasileiro válido com DDD.');
 if(!validCPF(cpf))throw new HttpError(400,'CPF com dígitos inválidos. Confira o número.');
 return {name,phone,cpf};
}
const fresh=(value:string|undefined,ms:number)=>!!value&&Date.now()-Date.parse(value)<ms&&Date.parse(value)<=Date.now();
export async function validateBuyer(user:any,body:any){
 const fields=buyerFields(body),config=identityConfig();
 if(body.privacy_consent!==true||body.terms_consent!==true)throw new HttpError(400,'Leia e aceite a política de privacidade e os termos.');
 if(config.strict){
  if(!config.phone_available||!config.cpf_available)throw new HttpError(503,'A verificação de cadastro está temporariamente indisponível. Tente novamente mais tarde.');
  const birth=formatBirthDate(body.customer_birthdate);
  if(!birth)throw new HttpError(400,'Informe sua data de nascimento.');
  const record=await identityRecord(user.id);
  if(record.phone!==fields.phone||record.phone_line_type!=='mobile'||!fresh(record.phone_verified_at,30*86400000))throw new HttpError(403,'Confirme seu celular por SMS antes de continuar.');
  const hash=await fingerprint([fields.cpf,birth,canonicalName(fields.name)].join('|'));
  if(record.cpf_fingerprint!==hash||!fresh(record.cpf_registry_verified_at,86400000))throw new HttpError(403,'Consulte seu CPF antes de continuar.');
 }
 return {...fields,email:user.email.toLowerCase(),level:config.strict?'email_sms_registry':'email_and_format'};
}
async function twilio(path:string,body?:URLSearchParams){
 const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Basic '+btoa(env('TWILIO_ACCOUNT_SID')+':'+env('TWILIO_AUTH_TOKEN')),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body,signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new HttpError(response.status===429?429:503,'Não foi possível verificar o celular agora. Confira os dados e tente novamente.');
 return response.json();
}
export async function sendPhoneCode(user:any,body:any){
 const config=identityConfig();if(!config.strict||!config.phone_available)throw new HttpError(503,'Verificação por SMS ainda não ativada.');
 if(body.verification_consent!==true)throw new HttpError(400,'Autorize a verificação do celular.');
 const phone=normalizePhone(body.customer_phone);if(!phone)throw new HttpError(400,'Informe um celular brasileiro válido com DDD.');
 await attempt('sms-user:'+user.id,3,3600,60);
 await attempt('sms-phone:'+await fingerprint(phone),6,86400,60);
 const lookup=await twilio('https://lookups.twilio.com/v2/PhoneNumbers/'+encodeURIComponent(phone)+'?Fields=line_type_intelligence');
 if(lookup.valid!==true||lookup.line_type_intelligence?.error_code||lookup.line_type_intelligence?.type!=='mobile')throw new HttpError(400,'Use um número de celular móvel. Números virtuais, fixos e de tipo desconhecido não são aceitos.');
 const verification=await twilio('https://verify.twilio.com/v2/Services/'+env('TWILIO_VERIFY_SERVICE_SID')+'/Verifications',new URLSearchParams({To:phone,Channel:'sms',Locale:'pt-BR'}));
 if(verification.status!=='pending'||!/^VE[a-f0-9]{32}$/i.test(verification.sid||''))throw new HttpError(503,'Não foi possível enviar o código.');
 await saveIdentity(user.id,{challenge_phone:phone,challenge_sid:verification.sid,challenge_expires_at:new Date(Date.now()+600000).toISOString()});
 return {sent:true};
}
export async function checkPhoneCode(user:any,body:any){
 const config=identityConfig();if(!config.strict||!config.phone_available)throw new HttpError(503,'Verificação por SMS ainda não ativada.');
 const record=await identityRecord(user.id),phone=normalizePhone(body.customer_phone),code=String(body.code||'');
 if(!/^\d{6}$/.test(code)||!phone||record.challenge_phone!==phone||!/^VE[a-f0-9]{32}$/i.test(record.challenge_sid||'')||Date.parse(record.challenge_expires_at)<=Date.now())throw new HttpError(400,'Solicite um novo código para este celular.');
 await attempt('sms-check:'+user.id,6,600);
 const result=await twilio('https://verify.twilio.com/v2/Services/'+env('TWILIO_VERIFY_SERVICE_SID')+'/VerificationCheck',new URLSearchParams({VerificationSid:record.challenge_sid,Code:code}));
 if(result.status!=='approved'||result.valid!==true)throw new HttpError(400,'Código inválido ou expirado.');
 await saveIdentity(user.id,{phone,phone_line_type:'mobile',phone_verified_at:new Date().toISOString(),challenge_phone:null,challenge_sid:null,challenge_expires_at:null});
 return {verified:true};
}
let serproToken='',serproExpires=0;
async function registryToken(){
 if(serproToken&&serproExpires>Date.now()+30000)return serproToken;
 const response=await fetch('https://gateway.apiserpro.serpro.gov.br/token',{method:'POST',headers:{Authorization:'Basic '+btoa(env('SERPRO_CONSUMER_KEY')+':'+env('SERPRO_CONSUMER_SECRET')),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new HttpError(503,'Consulta de CPF indisponível no momento.');
 const data=await response.json();if(!data.access_token)throw new HttpError(503,'Consulta de CPF indisponível no momento.');
 serproToken=data.access_token;serproExpires=Date.now()+Number(data.expires_in||0)*1000;return serproToken;
}
export async function checkCPF(user:any,body:any){
 const config=identityConfig();if(!config.strict||!config.cpf_available)throw new HttpError(503,'Consulta cadastral de CPF ainda não ativada.');
 if(body.verification_consent!==true)throw new HttpError(400,'Autorize a consulta cadastral.');
 const {name,cpf}=buyerFields(body),birth=formatBirthDate(body.customer_birthdate);
 if(!birth)throw new HttpError(400,'Informe sua data de nascimento.');
 await attempt('cpf-check:'+user.id,3,3600,30);
 const response=await fetch('https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df/v3/cpf/'+cpf+'/'+birth,{headers:{Authorization:'Bearer '+await registryToken(),Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 // Respect provider restrictions (including partial/age-restricted responses); never infer success.
 if(response.status!==200){if(response.status===401)serproToken='';throw new HttpError(response.status>=500?503:400,'Não foi possível confirmar os dados cadastrais informados. Confira seus dados ou fale com o suporte.');}
 const data=await response.json();
 if(normalizeCPF(data.ni)!==cpf||data.nascimento!==birth||canonicalName(data.nome||'')!==canonicalName(name))throw new HttpError(400,'Os dados informados não conferem. Confira nome completo, CPF e nascimento.');
 await saveIdentity(user.id,{cpf_fingerprint:await fingerprint([cpf,birth,canonicalName(name)].join('|')),cpf_last4:cpf.slice(-4),cpf_registry_verified_at:new Date().toISOString()});
 return {verified:true};
}
