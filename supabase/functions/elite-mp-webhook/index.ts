import {env,HttpError,json,mp,processInvoice,syncPreapproval,validId,verifySignature} from '../_shared/mp.ts';

Deno.serve(async (req: Request) => {
  if(req.method!=='POST') return json({error:'Method not allowed'},405);
  try {
    if(!env('MP_WEBHOOK_SECRET') || !env('MP_ACCESS_TOKEN')) return json({error:'Not configured'},503);
    if(!await verifySignature(req,env('MP_WEBHOOK_SECRET'))) return json({error:'Invalid signature'},401);
    const id = validId(new URL(req.url).searchParams.get('data.id'));
    const body = await req.json();
    if(String(body.data?.id).toLowerCase()!==id.toLowerCase()) return json({error:'ID mismatch'},400);
    if(body.type==='subscription_preapproval') await syncPreapproval(id);
    else if(body.type==='subscription_authorized_payment') await processInvoice(await mp(`/authorized_payments/${id}`));
    else if(body.type==='payment') {
      // Find the invoice from the provider. Never trust a user-supplied reference.
      const result = await mp(`/authorized_payments/search?payment_id=${id}`);
      for(const invoice of result.results || []) {
        if(String(invoice.payment?.id)===id) await processInvoice(invoice);
      }
    }
    return json({received:true});
  } catch(error) {
    // Failure is retryable; acknowledge only after the database transaction.
    console.error('Mercado Pago webhook processing failed',error instanceof HttpError?error.status:500);
    return json({error:'Processing failed'},error instanceof HttpError?error.status:500);
  }
});
