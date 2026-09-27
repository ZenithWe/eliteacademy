# Verificação de cadastro para compra

## Publicado

- Compra manual e automática exigem sessão e e-mail confirmado no Supabase Auth.
- O servidor fixa o e-mail ao usuário autenticado e busca preço/nome no catálogo.
- CPF: validação de dígitos, rejeição de sequências repetidas, somente quatro dígitos finais no pedido.
- Celular: validação de formato brasileiro, DDD e comprimento. Isso não comprova existência ou posse.
- Pedidos diretos do navegador são bloqueados; a função autenticada registra os pedidos.
- O cadastro inclui login, criação de conta e reenvio de confirmação. Para entrega em produção, conferir SMTP e URL de retorno no Supabase Auth; não reduzir a exigência de confirmação.

## Integrações implementadas, pendentes de configuração e teste real

`IDENTITY_STRICT` permanece desligado até os serviços serem configurados e validados. O formulário informa que SMS e consulta cadastral ainda não estão ativos. Não apresentar a validação matemática como consulta à Receita.

Segredos usados exclusivamente nas Edge Functions:

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`: Verify SMS e Lookup Line Type Intelligence.
- `SERPRO_CONSUMER_KEY`, `SERPRO_CONSUMER_SECRET`: Consulta CPF v3 contratada, ambiente de produção.
- `IDENTITY_HMAC_KEY`: recomendado, segredo aleatório exclusivo para vincular CPF/data/nome sem armazená-los. Sem este, usa HMAC com a chave de serviço e separação de contexto. Rotacionar invalida as verificações em cache.
- `IDENTITY_STRICT=true`: ativa a exigência das duas verificações em todas as novas compras. Se houver serviço indisponível, o servidor recusa a compra; não há aprovação silenciosa.

Não colocar credenciais no HTML, GitHub ou mensagens públicas. Não alterar regras para contornar restrições do provedor.

No modo completo, o celular precisa ser classificado como `mobile` e confirmado por código vinculado à conta e ao telefone, com limites de envio/tentativas. VoIP e tipos desconhecidos são recusados. Isso reduz números descartáveis, mas não garante excluir todo chip móvel temporário. Código expira em dez minutos; a prova de posse é revalidada a cada trinta dias.

A consulta CPF compara CPF, nome completo e nascimento com o retorno oficial. Exige resposta completa HTTP 200; respostas parciais, restrições etárias, divergências e indisponibilidade não aprovam o cadastro. Consulta cadastral não comprova que o comprador é o titular. Não há biometria ou consulta de crédito. A prova cadastral é revalidada após 24 horas.

CPF completo e nascimento são usados em memória, não entram em pedidos, mensagens de Discord ou logs da aplicação. Os registros internos de verificação são acessíveis apenas ao servidor, com RLS e sem permissões de leitura/escrita para clientes. HMAC é dado pseudonimizado, não anonimizado. Exclusão da conta remove os registros internos; pedidos têm retenção operacional própria.

Testes: `node --test tests/buyer-verification.test.mjs tests/payments.test.mjs`.
Os testes de SMS/CPF usam respostas simuladas; não enviam SMS, não consultam pessoas e não geram cobrança.

Documentação usada:
- https://supabase.com/docs/guides/auth/passwords
- https://www.twilio.com/docs/verify/api
- https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence
- https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cpf/pt/chamadas/consulta-cpf-df-v3/
