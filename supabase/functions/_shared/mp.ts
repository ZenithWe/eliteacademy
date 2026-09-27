export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const env = (key: string) => Deno.env.get(key) || '';
export const ready = () => env('MP_ENABLED') === 'true' && !!env('MP_ACCESS_TOKEN') && !!env('MP_WEBHOOK_SECRET');
export const site = 'https://zenithwe.github.io/eliteacademy/';
export const cors = {
  'Access-Control-Allow-Origin': 'https://zenithwe.github.io',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Vary': 'Origin',
};
export function json(value: unknown, status = 200, browser = false) {
  return new Response(JSON.stringify(value), {status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(browser ? cors : {}),
  }});
}
export async function db(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    method, headers: {apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json', Prefer: 'return=representation'},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new HttpError(response.status === 409 ? 409 : 500,
    response.status === 409 ? 'Já existe uma assinatura em andamento. Atualize sua área do aluno.' : 'Não foi possível atualizar a assinatura. Tente novamente.');
  return response.status === 204 ? null : await response.json();
}
export async function mp(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method, headers: {Authorization: `Bearer ${env('MP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new HttpError(502, 'O Mercado Pago não confirmou a operação. Consulte a área do aluno antes de tentar novamente.');
  return await response.json();
}
export function validId(value: unknown) {
  const id = String(value ?? '');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new HttpError(400, 'Identificador inválido.');
  return id;
}
export function safeCheckout(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['www.mercadopago.com.br','www.mercadopago.com'].includes(url.hostname))
    throw new HttpError(502, 'Endereço de pagamento inválido.');
  return url.href;
}
export async function verifySignature(req: Request, secret: string) {
  const id = new URL(req.url).searchParams.get('data.id');
  const requestId = req.headers.get('x-request-id');
  const parts = (req.headers.get('x-signature') || '').split(',').map(x => x.trim().split('='));
  const ts = parts.find(x => x[0] === 'ts')?.[1];
  const signatures = parts.filter(x => x[0] === 'v1').map(x => x[1]);
  if (!secret || !id || !requestId || !ts || !/^\d+$/.test(ts)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  const manifest = new TextEncoder().encode(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`);
  for (const signature of signatures) {
    if (!/^[a-fA-F0-9]{64}$/.test(signature)) continue;
    const bytes = Uint8Array.from(signature.match(/../g)!, h => parseInt(h,16));
    if (await crypto.subtle.verify('HMAC',key,bytes,manifest)) return true;
  }
  return false;
}
export async function syncPreapproval(id: string) {
  const pre = await mp(`/preapproval/${validId(id)}`);
  const rows = await db(`elite_mp_checkouts?preapproval_id=eq.${validId(id)}&select=*`);
  const c = rows[0];
  if (!c) return null;
  if (pre.external_reference !== c.id || Number(pre.auto_recurring?.transaction_amount) !== Number(c.amount)
    || pre.auto_recurring?.currency_id !== 'BRL') throw new HttpError(409,'Dados da assinatura divergentes.');
  if (!['pending','authorized','paused','cancelled'].includes(pre.status)) throw new HttpError(409,'Status de assinatura desconhecido.');
  // Stale events cannot overwrite a more recent subscription snapshot.
  const changed = pre.last_modified || pre.date_created;
  if (!changed || !Number.isFinite(Date.parse(changed))) throw new HttpError(502,'Data da assinatura inválida.');
  await db(`elite_mp_checkouts?id=eq.${c.id}&or=(provider_updated_at.is.null,provider_updated_at.lte.${encodeURIComponent(changed)})`,
    'PATCH',{status:pre.status,provider_updated_at:changed});
  return {...c,status:pre.status};
}
export async function processInvoice(invoice: any) {
  if (!invoice?.payment?.id) return;
  const preId = validId(invoice.preapproval_id);
  const rows = await db(`elite_mp_checkouts?preapproval_id=eq.${preId}&select=*`);
  const c = rows[0];
  if (!c) {
    // Creation may still be saving the provider ID; return a retryable error
    // for our external reference, ignore subscriptions from other integrations.
    if (/^[0-9a-f-]{36}$/.test(String(invoice.external_reference || ''))) {
      const pending = await db(`elite_mp_checkouts?id=eq.${invoice.external_reference}&select=id`);
      if (pending.length) throw new HttpError(503,'Assinatura ainda está sendo registrada.');
    }
    return;
  }
  const [pre,payment] = await Promise.all([
    mp(`/preapproval/${preId}`), mp(`/v1/payments/${validId(invoice.payment.id)}`),
  ]);
  if (pre.external_reference !== c.id || Number(pre.auto_recurring?.transaction_amount) !== Number(c.amount)
    || pre.auto_recurring?.currency_id !== 'BRL' || String(pre.collector_id) !== String(payment.collector_id)
    || Number(invoice.transaction_amount) !== Number(c.amount) || invoice.currency_id !== 'BRL'
    || Number(payment.transaction_amount) !== Number(c.amount) || payment.currency_id !== 'BRL'
    || payment.live_mode !== (env('MP_MODE') !== 'test')) throw new HttpError(409,'Pagamento não corresponde à assinatura.');
  const status = Number(payment.transaction_amount_refunded) > 0 ? 'refunded' : payment.status;
  await db('rpc/elite_mp_apply_payment','POST',{
    p_checkout_id:c.id,p_invoice_id:String(invoice.id),p_payment_id:String(payment.id),p_status:status,
    p_amount:payment.transaction_amount,p_currency:payment.currency_id,
    p_period_start:invoice.debit_date || payment.date_approved,
    p_updated_at:payment.date_last_updated,
  });
}
