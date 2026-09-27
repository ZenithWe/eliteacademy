# Mercado Pago — Elite Academy

## Estado da entrega

Checkout de assinatura mensal, notificações assinadas, registro automático de vendas,
liberação de acesso por período pago, renovação e cancelamento implementados.
Banco e funções publicados no projeto `elite-academy`.
Cobranças ficam DESATIVADAS até configurar a conta e validar o teste ponta a ponta.
O fluxo manual permanece disponível enquanto `MP_ENABLED` não for `true`.
Produtos avulsos continuam no fluxo manual. Planos solo, duo e trio são cobrados
pelo valor integral cadastrado. Nos planos de grupo, o acesso automático vincula
o comprador; convites de outros integrantes continuam sob atendimento da equipe.

## Configuração pelo titular da conta de recebimento

Não coloque credenciais em HTML, neste repositório, na tabela `elite_settings`
ou em mensagens. A conta deve estar habilitada pelo Mercado Pago para receber
pagamentos e usar assinaturas.

1. Na aplicação do Mercado Pago, configure Webhooks de **Planos e assinaturas**
   (`subscription_authorized_payment`, `subscription_preapproval`) e **Pagamentos**
   (`payment`) para:
   `https://rtbempkgmiguaongajlj.supabase.co/functions/v1/elite-mp-webhook`
2. No [Supabase — Edge Function Secrets](https://supabase.com/dashboard/project/rtbempkgmiguaongajlj/functions/secrets), cadastre:
   - `MP_ACCESS_TOKEN`: token da aplicação do Mercado Pago.
   - `MP_WEBHOOK_SECRET`: assinatura secreta gerada na configuração de Webhooks.
   - `MP_MODE`: `test` para validação com contas de teste; `production` para vendas reais.
   - `MP_ENABLED`: mantenha `false` até estar pronto para testar o checkout.
3. Para homologação, use contas/credenciais de teste do provedor, habilite
   `MP_ENABLED=true` durante a janela de teste e valide compra, recusa,
   notificação duplicada, renovação, cancelamento e estorno. O servidor recusa
   pagamentos cujo `live_mode` não corresponda ao modo configurado.
4. Somente após a homologação, configure as credenciais de produção,
   `MP_MODE=production` e `MP_ENABLED=true`.

Sem acesso à conta Mercado Pago, a criação da aplicação, os segredos e o teste
ponta a ponta ainda precisam ser concluídos. Nenhuma cobrança real foi realizada
durante a implementação.

## Operação

- O aluno entra com e-mail confirmado, seleciona um plano e aceita a recorrência.
- O servidor consulta preço/benefícios no banco; ignora preços vindos do navegador.
- O aluno autoriza o pagamento no checkout hospedado do Mercado Pago.
- A autorização da assinatura, sozinha, não libera acesso.
- Cada fatura paga gera um pedido, uma venda e um período de assinatura.
- Renovação cancelada preserva o período pago. Recusas não renovam o acesso.
- Estorno (inclusive parcial) ou contestação suspendem o período correspondente.
- “Atualizar pagamento” reconcilia faturas no provedor; não marca uma compra como paga.
- Duplicatas e eventos antigos não renovam períodos nem restauram créditos usados.
- Assinaturas existentes manuais não são convertidas nem cobradas automaticamente.

Se uma tentativa ficar em `creating` após timeout, o sistema bloqueia outra
criação para impedir cobranças duplicadas. O suporte deve buscar a assinatura
no Mercado Pago pelo `external_reference` (ID de `elite_mp_checkouts`), recuperar
o ID e o link ou confirmar sua inexistência antes de liberar outra tentativa.
Não repita cegamente a criação de assinatura.

## Verificação técnica

- `node --test tests/payments.test.mjs`: HMAC, URL segura e rejeição de valor adulterado.
- `tests/payments.sql`: teste transacional com rollback, sem preservar dados fictícios;
  aprovação, quotas, duplicidade, renovação, estorno, evento antigo e permissões.
- A migration é incremental e pressupõe as tabelas existentes da Elite Academy.
- Execute SQL de teste somente dentro de `BEGIN` / `ROLLBACK`.
- Assinaturas e pagamentos usam RLS; somente o servidor pode escrever.
- Chaves permanecem nos segredos das Edge Functions.

O advisor não apontou alertas nas novas tabelas/funções. Alertas anteriores
permanecem: consulta pública intencional de pedidos por código
([detalhes](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable))
e proteção contra senhas vazadas desativada
([configuração](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).

Documentação oficial:
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-content/notifications/webhooks
- https://supabase.com/docs/guides/functions/auth
