# Vitória Procurement

Sistema interno de compras, documentos fiscais e financeiro do grupo
(Moraes Comércio e Representações Ltda e Rogério Moraes Hidráulicos Ltda).

Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + Supabase (sa-east-1) + Vercel.

## Como publicar

- O código vive no GitHub (branch `main`). Cada envio para o `main` gera um deploy
  automático no Vercel — não é preciso rodar nada localmente.
- Banco: as migrações **0001 a 0021 já estão aplicadas** no projeto Supabase
  `gkxglanbkeacilgqggqu`. Os arquivos em `supabase/migrations` são o registro exato do
  que está no banco; não precisam ser executados de novo.
- O `middleware.ts` fica em **`src/middleware.ts`**. Com a pasta `src/`, o Next ignora um
  `middleware.ts` na raiz do repositório — se ainda houver um lá, pode apagar.

### Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Onde é usada | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | navegador e servidor | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador e servidor | chave **publishable** (`sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | só servidor | guarda o certificado e grava as notas da SEFAZ; nunca no navegador; tipo **Sensitive** |
| `CRON_SECRET` | só servidor | protege a consulta diária; mínimo 16 caracteres aleatórios; tipo **Sensitive** |
| `ICP_BRASIL_CA_PEM` | só servidor | opcional — raízes ICP-Brasil extras, se um dia a SEFAZ exigir; somadas às do Node |

Segredos (senhas, certificado A1, chaves de serviço) nunca entram no código, no
repositório nem no chat.

### Região

Em Vercel → Settings → Functions, a região `gru1` (São Paulo) deixa as funções ao lado
do banco (sa-east-1) e corta a latência de cada consulta.

## Módulos

| Área | Telas |
|---|---|
| Cadastros | Departamentos, centros de custo, fornecedores, produtos |
| Notas fiscais | **Notas recebidas** (lista, detalhe), **importar XML**, **consulta na SEFAZ** (DF-e) |
| Financeiro | **Duplicatas**, **contas a pagar**, **pagamentos**, **calendário**, fechamento de caixa |
| Relatórios | Custo real por produto, fechamento de caixa |
| Administração | Usuários (criar, perfil, senha, acesso), parâmetros |

## Fechamento de caixa

Rotas: `/financeiro/caixa` (lista com filtros), `/financeiro/caixa/importar`,
`/financeiro/caixa/[id]` (detalhe) e `/financeiro/caixa/relatorio` (impressão/PDF e CSV).

**O banco lê o relatório.** A tela envia só o texto do arquivo; a função
`app.parse_cash_report` extrai datas e valores, identifica as formas de pagamento e
refaz as contas. Nenhum número vem calculado do navegador.

Conferências (tolerância de R$ 0,01):

1. Formas de pagamento = pedidos pagos + troco devolvido
2. Total em títulos = formas de pagamento − dinheiro
3. Total das saídas = saídas, exceto desconto
4. Troco na gaveta = entrada de troco + dinheiro − total das saídas

O desconto do caixa é informativo (não sai da gaveta). Um fechamento que não fecha
é registrado assim mesmo, marcado como **divergência**, para conferência do caixa físico.

- **Duplicidade:** a sessão do caixa (abertura + fechamento) é a identidade. O mesmo
  relatório enviado de novo aparece como "já importado" e não é gravado.
- **Formas novas** (ex.: "VOUCHER ALELO") entram sozinhas no cadastro, com o tipo
  deduzido do nome (dinheiro, PIX, débito, crédito, vale…).
- **Cancelar** não apaga: o registro fica, com motivo, autor e data, e sai dos totais.
  Depois dá para importar o arquivo corrigido do mesmo dia.
- **Permissões** (módulo `cash`): Administrador faz tudo; Financeiro consulta, importa
  e exporta; Diretoria consulta e exporta. Só quem tem `cash.delete` cancela.
- **Filtros** (ficam na URL): período, modalidade (uma forma ou um tipo inteiro, ex.:
  todo o crédito) e faixa de valor — o valor filtra o total de pedidos pagos do dia ou,
  com modalidade escolhida, o valor daquela modalidade.
- **Relatório:** indicadores, formas de pagamento, tipos, maquininhas, gráfico diário e
  tabela por dia com totais. Imprime em A4 paisagem (é também o "salvar em PDF") e
  exporta CSV que abre direto no Excel em português.

## Notas fiscais (XML)

Rotas: `/notas` (lista com filtros), `/notas/importar` e `/notas/[id]` (detalhe).

**O banco lê o XML.** A tela manda o arquivo inteiro; `app.parse_nfe` tira os
namespaces, recusa DOCTYPE/ENTITY e arquivos acima de 2 MB, e lê chave, emitente,
totais, itens e duplicatas. A prévia (`preview_invoice_xml`) mostra o que vai acontecer
sem gravar; o registro (`register_invoice_xml`) grava, um arquivo de cada vez.

- **Duplicidade:** a chave de acesso é a identidade. O mesmo XML de novo aparece como
  "já importada". Um resumo (resNFe) é completado quando chega o XML inteiro.
- **Cadastro:** o emitente é ligado ao fornecedor pelo CNPJ; o item, pelo código do
  fornecedor ou EAN. O que não casa vira pendência de cadastro — a nota entra do mesmo jeito.
- **Custo cheio por item** = produto − desconto + frete + seguro + outras + ICMS-ST + IPI,
  dividido pela quantidade. Vai para o histórico de preços do produto.
- **Permissões:** `xml_import.import` importa; `invoices.view` consulta; o XML original
  só aparece para quem tem `invoices.export`.
- Até 20 arquivos por envio ao servidor (a tela manda em lotes de 5), 200 por vez na tela.

## Contas a pagar

Rotas: `/financeiro/duplicatas`, `/financeiro/contas-a-pagar`, `/financeiro/pagamentos`
e `/financeiro/calendario`.

**Duplicata é documento; título é compromisso.** As parcelas chegam com o XML, mas só
viram conta a pagar quando alguém do financeiro manda gerar, na tela de duplicatas.
Nota cancelada não gera título. Nota sem parcela vira um título único, vencendo na emissão.

- **Não duplica:** cada duplicata tem no máximo um título vivo (índice único no banco).
  Gerar de novo só pula o que já existe.
- **Situação calculada:** aberto / pago em parte / pago / cancelado é coluna gerada a
  partir do valor pago — não há como gravar "pago" sem pagamento. "Vencido" é calculado
  na consulta, com a data do dia.
- **Baixa parcial:** paga-se qualquer valor até o saldo; o título fica "pago em parte".
  Data no futuro e valor acima do saldo são recusados pelo banco.
- **Nada se apaga:** baixa errada é estornada com motivo (volta para o saldo); título
  errado é cancelado com motivo — só depois de estornar os pagamentos dele.
- **Título avulso:** aluguel, imposto, serviço — criado em "Novo título", com ou sem
  fornecedor do cadastro.
- **Calendário:** mês a mês, o que falta pagar em cada dia; vencidos em vermelho, dias
  quitados riscados. Clicar num dia abre a lista filtrada.
- **Permissões:** `accounts_payable.create|edit|cancel` (gerar, criar, editar, cancelar
  títulos), `payments.pay` (baixar), `payments.cancel` (estornar), `payments.view`
  (extrato). Compras e Fiscal só consultam títulos; não veem pagamentos.

## Usuários e acesso

Tela: `/admin/usuarios` (precisa de `users.view`; criar e alterar exigem `users.create`
e `users.edit`, que hoje só o perfil Administrador tem).

- **Criar** pede nome, e-mail, perfil, empresas e uma **senha provisória** (o botão
  "Gerar" sugere uma). A tela mostra o acesso uma única vez, para ser entregue à pessoa.
- No **primeiro acesso** o sistema leva para `/trocar-senha` e não libera nada até a
  pessoa criar a senha dela (`users.must_change_password`).
- **E-mail que já existe** não vira conta nova: a pessoa ganha acesso à empresa atual,
  sem mexer na senha dela.
- **Perfil por empresa:** a mesma pessoa pode ser Financeiro numa empresa e
  Visualização na outra.
- **Desativar** tira o acesso àquela empresa sem apagar nada; o histórico continua.
- **Redefinir senha** gera outra provisória e derruba a antiga na hora.
- Guardas: ninguém altera o próprio perfil, o próprio acesso ou a própria senha por
  essa tela (a sua senha troca em `/trocar-senha`), e só um superadministrador mexe em
  outro superadministrador.

A criação roda em `app.create_company_user` (migração 0016). É o banco que valida
permissão, e-mail e força da senha, e só o hash bcrypt é gravado — nada de chave de
serviço no navegador.

**Quando houver e-mail (SMTP) configurado** no Supabase, dá para trocar a senha
provisória por convite e ligar o "esqueci minha senha". Enquanto isso, quem cria o
usuário entrega o acesso.

## Consulta na SEFAZ (DF-e)

Rota: `/notas/consulta`. Agendamento: `/api/cron/dfe`, uma vez por dia às 06:00 (09:00 UTC, `vercel.json`).

**Convivência com a contabilidade (decisão de 24/09/2026).** A contabilidade também consulta
a distribuição destes CNPJs e a SEFAZ conta as consultas por CNPJ (rejeição 656, bloqueio de
1 h). Por isso o sistema consulta com cautela:

- sozinho, no máximo 1 vez a cada 12 h (o agendamento é diário);
- manual, só com 1 h desde a última consulta;
- cStat 137 (nada novo) ou ultNSU = maxNSU → espera 1 h, como manda a NT 2014.002;
- cStat 656 → para na hora e espera 65 min;
- o cursor (ultNSU) só avança depois que os documentos do lote foram gravados;
- **o sistema só lê**: nenhuma manifestação é enviada. A Ciência da Operação continua com a
  contabilidade; quando ela registra, o evento chega pela distribuição e aparece na nota.

**Certificado A1.** Enviado pela própria tela (quem tem `settings.edit`). O servidor abre o
.pfx, confere senha, validade e CNPJ (mesma raiz de 8 dígitos da empresa) e só então guarda:
o arquivo no balde privado `fiscal-certs` (sem nenhuma policy — só a chave de serviço lê) e a
senha no Vault. Nada disso volta para o navegador, vai para log ou para o repositório. O
node-forge lê o formato antigo das ACs (RC2-40), que o OpenSSL 3 do Node recusa.

**O que entra.** `resNFe` vira nota "só resumo"; `procNFe` passa pela mesma gravação da
importação manual (`app.save_invoice`: itens, custo cheio, parcelas, fornecedor, pendências);
nota em que a empresa não é a destinatária (transportadora, CPF) é ignorada; eventos de
cancelamento marcam a nota e os de manifestação ficam registrados.

**TLS.** O certificado da SEFAZ é sempre verificado (nunca `rejectUnauthorized: false`). O
Ambiente Nacional usa autoridade comercial; se um dia exigir a raiz ICP-Brasil, os PEMs vão
em `ICP_BRASIL_CA_PEM` e são somados à lista padrão.

**Região.** As funções rodam em `gru1` (São Paulo), configurado no projeto do Vercel.

## Supabase: cuidados

- **Plano gratuito pausa** o projeto depois de 7 dias sem acesso. Os dados ficam, mas o
  sistema sai do ar até reativar no painel. O uso diário do caixa já evita a pausa.
- O plano gratuito **não tem backup restaurável**. Quando o sistema virar rotina, o Pro
  resolve as duas coisas.
- "Leaked password protection" (bloquear senhas vazadas) só existe no Pro. Enquanto isso,
  use em Authentication → Providers → Email: senha mínima de 10 caracteres com letras e
  números.

## Decisões que valem lembrar

**A interface não autoriza.** Ela esconde o que o usuário não pode ver, mas quem decide
é o RLS e as funções do banco. Toda action grava e trata o erro `42501` do banco.

**`getUser()`, nunca `getSession()`.** O primeiro valida o token no Supabase; o segundo
só lê o cookie e aceitaria um JWT forjado.

**Permissões vêm do banco.** `public.my_permissions()` usa `app.has_permission()`, a
mesma função das policies. Regra muda em um lugar só.

**Nada se apaga de verdade.** Cadastros usam exclusão lógica; fechamentos de caixa,
títulos e pagamentos são cancelados ou estornados com motivo. Tudo passa pela auditoria (`app.audit()`).

**O menu não leva a lugar nenhum vazio.** O que ainda não foi construído aparece
marcado como "em breve", sem link (`soon` em `src/components/nav.ts`). Cada grupo abre e
fecha no título; "Recolher tudo / Expandir tudo" fica acima dos grupos. A escolha fica
guardada no navegador de cada pessoa, e o grupo da página atual sempre abre sozinho.

**Funções expostas são finas.** A lógica fica no schema `app` (security definer); o
PostgREST só enxerga wrappers em `public`, e `anon` não executa nada. Como os wrappers são
security invoker, `authenticated` precisa de `execute` também na função de `app`.

**Datas puras não passam por `new Date()`.** Vencimento e dia do caixa chegam como
`2026-09-28`; convertidos para Date viram meia-noite UTC, que em Brasília ainda é o dia
anterior. `date()` em `src/lib/format.ts` formata esse caso direto.

**XPath em fragmento.** Cada nó devolvido por `xpath()` vira um documento próprio: dentro
dele o caminho é `/dup/nDup`, não `./nDup` (migração 0019).

## Estrutura

```
src/
  middleware.ts               renova a sessão e barra rota fechada sem login
  app/
    login/                      autenticação
    (app)/                      rotas autenticadas (layout com menu)
      cadastros/                departamentos, centros de custo, fornecedores, produtos
      notas/                    notas recebidas (lista) e [id]/ (detalhe)
        importar/               envio de XML com prévia
        consulta/               consulta na SEFAZ: certificado, consultar agora, histórico
      financeiro/caixa/         fechamento de caixa
        _components/            filtros, gráfico, indicadores, exportação
        importar/               envio e prévia dos relatórios
        [id]/                   detalhe e cancelamento
        relatorio/              relatório imprimível + CSV
      financeiro/duplicatas/    parcelas das notas que ainda não viraram título
      financeiro/contas-a-pagar/ títulos, baixa, edição, cancelamento, título avulso
      financeiro/pagamentos/    extrato de baixas e estorno
      financeiro/calendario/    vencimentos do mês
      relatorios/               índice de relatórios, custo real
      admin/usuarios/           lista, criação, perfil, senha e acesso
      admin/parametros/         parâmetros da empresa
    trocar-senha/               troca de senha (obrigatória no primeiro acesso)
    api/cron/dfe/               coletor de NF-e (cron)
  components/                   shell, menu, seletor de empresa, cabeçalho, painéis, janela (modal)
  lib/
    supabase/                   clientes (navegador/servidor) e middleware
    fiscal/                     certificado A1, cliente DF-e (SOAP/mTLS), coletor
    caixa.ts                    filtros, resumos e CSV do caixa
    notas.ts                    tipos e filtros das notas
    financeiro.ts               tipos, filtros, resumos e calendário do contas a pagar
    session.ts                  usuário + empresa ativa + permissões
    permissions.ts              espelho tipado do RBAC
    format.ts                   moeda, CNPJ e datas em pt-BR
  types/
supabase/migrations/            0001–0021 (já aplicadas)
```
