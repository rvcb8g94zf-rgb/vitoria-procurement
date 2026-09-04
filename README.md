# Vitória Procurement — aplicação

Next.js 15 (App Router) + TypeScript + Tailwind + Supabase.

## Rodar

```bash
npm install
cp .env.example .env.local
npm run dev
```

Banco: projeto `vitoria-procurement` (sa-east-1). Migrações 0001–0009 já aplicadas.

## O que existe nesta entrega

- Login com Supabase Auth e middleware de sessão em todas as rotas
- Seletor entre as empresas do grupo, com o perfil de cada uma
- Sidebar montada a partir das permissões efetivas do usuário
- Visão geral, Departamentos (CRUD completo), Centros de custo, Usuários, Parâmetros
- Modo claro/escuro, layout responsivo

## Decisões que valem lembrar

**A interface não autoriza.** Ela esconde o que o usuário não pode ver, mas quem
decide é o RLS. Toda action grava direto e trata o erro `42501` do banco — nunca
confere permissão em memória e grava confiando no resultado.

**`getUser()`, nunca `getSession()`.** O primeiro valida o token no servidor do
Supabase; o segundo só lê o cookie e aceitaria um JWT forjado.

**Permissões vêm do banco.** `public.my_permissions()` reaproveita
`app.has_permission()`, a mesma função usada nas policies. Se a regra mudar,
muda em um lugar só.

**Exclusão é lógica.** Registros com histórico usam `deleted_at`/`deleted_by`.

## Estrutura

```
src/
  app/
    login/                  autenticação
    (app)/                  rotas autenticadas (layout com shell)
      cadastros/            departamentos, centros de custo
      admin/                usuários, parâmetros
  components/               shell, sidebar, seletor de empresa, nav
  lib/
    supabase/               clientes browser/server e middleware
    session.ts              usuário + empresa ativa + permissões
    permissions.ts          espelho tipado do RBAC
    format.ts               moeda, CNPJ e datas em pt-BR
  types/                    entidades da Fase 1
```

## Próximo

Fase 2 — Fornecedores e Produtos, usando o padrão de `cadastros/departamentos`
como referência de CRUD (page server + dialog client + actions com Zod).
