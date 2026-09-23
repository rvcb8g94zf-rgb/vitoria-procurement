# Vitória Procurement

Sistema interno de compras, documentos fiscais e financeiro do grupo
(Moraes Comércio e Representações Ltda e Rogério Moraes Hidráulicos Ltda).

Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + Supabase (sa-east-1) + Vercel.

## Como publicar

- O código vive no GitHub (branch `main`). Cada envio para o `main` gera um deploy
  automático no Vercel — não é preciso rodar nada localmente.
- Banco: as migrações **0001 a 0015 já estão aplicadas** no projeto Supabase
  `gkxglanbkeacilgqggqu`. Os arquivos em `supabase/migrations` são o registro exato do
  que está no banco; não precisam ser executados de novo.
- O `middleware.ts` fica em **`src/middleware.ts`**. Com a pasta `src/`, o Next ignora um
  `middleware.ts` na raiz do repositório — se ainda houver um lá, pode apagar.

### Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Onde é usada | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | navegador e servidor | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador e servidor | chave **publishable** (`sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | só servidor | usada apenas pelo coletor de NF-e; nunca no navegador |
| `CRON_SECRET` | só servidor | só quando o cron estiver ativo; mínimo 16 caracteres aleatórios |

Segredos (senhas, certificado A1, chaves de serviço) nunca entram no código, no
repositório nem no chat.

### Região

Em Vercel → Settings → Functions, a região `gru1` (São Paulo) deixa as funções ao lado
do banco (sa-east-1) e corta a latência de cada consulta.

## Módulos

| Área | Telas |
|---|---|
| Cadastros | Departamentos, centros de custo, fornecedores, produtos |
| Notas fiscais | Consulta automática (DF-e) — prévia visual; o coletor roda pelo cron |
| Financeiro | **Fechamento de caixa** (importar, consultar, relatório) |
| Relatórios | Custo real por produto, fechamento de caixa |
| Administração | Usuários, parâmetros |

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

## Cron da consulta de NF-e (quando o plano for Pro)

No plano Hobby o Vercel só aceita cron uma vez por dia; um `vercel.json` com intervalo
de 3 horas faz o deploy falhar — por isso ele não está no repositório. Com o plano Pro,
crie `CRON_SECRET` e adicione na raiz:

```json
{
  "crons": [{ "path": "/api/cron/dfe", "schedule": "0 */3 * * *" }]
}
```

A rota `/api/cron/dfe` recusa qualquer chamada sem `Authorization: Bearer <CRON_SECRET>`
— e recusa tudo enquanto a variável não existir.

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

**Nada se apaga de verdade.** Cadastros usam exclusão lógica; fechamentos de caixa são
cancelados com motivo. Tudo passa pela auditoria (`app.audit()`).

**Funções expostas são finas.** A lógica fica no schema `app` (security definer); o
PostgREST só enxerga wrappers em `public`, e `anon` não executa nada.

## Estrutura

```
src/
  middleware.ts               renova a sessão e barra rota fechada sem login
  app/
    login/                      autenticação
    (app)/                      rotas autenticadas (layout com menu)
      cadastros/                departamentos, centros de custo, fornecedores, produtos
      notas/consulta/           consulta automática de NF-e (prévia)
      financeiro/caixa/         fechamento de caixa
        _components/            filtros, gráfico, indicadores, exportação
        importar/               envio e prévia dos relatórios
        [id]/                   detalhe e cancelamento
        relatorio/              relatório imprimível + CSV
      relatorios/               índice de relatórios, custo real
      admin/                    usuários, parâmetros
    api/cron/dfe/               coletor de NF-e (cron)
  components/                   shell, menu, seletor de empresa, cabeçalho de página
  lib/
    supabase/                   clientes (navegador/servidor) e middleware
    fiscal/                     cliente DF-e, leitura de XML, sincronização
    caixa.ts                    filtros, resumos e CSV do caixa
    session.ts                  usuário + empresa ativa + permissões
    permissions.ts              espelho tipado do RBAC
    format.ts                   moeda, CNPJ e datas em pt-BR
  types/
supabase/migrations/            0001–0015 (já aplicadas)
```
