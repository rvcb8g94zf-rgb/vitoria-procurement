-- =====================================================================
-- Vitória Procurement — Fase 1 / Migração 0003
-- Catálogo de permissões, perfis de sistema e onboarding.
-- Idempotente: pode rodar novamente sem duplicar nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catálogo de permissões (módulo × ação)
-- ---------------------------------------------------------------------
insert into public.permissions (module, action, label)
select m.module, a.action, m.label || ' — ' || a.action
from (values
  ('dashboard',         'Painéis',                array['view']),
  ('purchase_requests', 'Solicitações de compra', array['view','create','edit','delete','approve','cancel','export']),
  ('quotations',        'Cotações',               array['view','create','edit','delete','cancel','export']),
  ('purchase_orders',   'Pedidos de compra',      array['view','create','edit','delete','approve','cancel','export']),
  ('approvals',         'Aprovações',             array['view','approve']),
  ('goods_receipts',    'Recebimentos',           array['view','create','edit','cancel','export']),
  ('invoices',          'Notas fiscais',          array['view','create','edit','cancel','export','import']),
  ('xml_import',        'Importação de XML',      array['view','import']),
  ('divergences',       'Divergências',           array['view','edit','approve']),
  ('installments',      'Duplicatas',             array['view','create','edit','cancel','export']),
  ('accounts_payable',  'Contas a pagar',         array['view','create','edit','cancel','export']),
  ('payments',          'Pagamentos',             array['view','create','cancel','export','pay']),
  ('suppliers',         'Fornecedores',           array['view','create','edit','delete','export']),
  ('products',          'Produtos',               array['view','create','edit','delete','export']),
  ('categories',        'Categorias',             array['view','create','edit','delete']),
  ('departments',       'Departamentos',          array['view','create','edit','delete']),
  ('cost_centers',      'Centros de custo',       array['view','create','edit','delete']),
  ('companies',         'Empresas',               array['view','create','edit']),
  ('users',             'Usuários',               array['view','create','edit','delete']),
  ('roles',             'Perfis de acesso',       array['view','edit']),
  ('approval_flows',    'Fluxos de aprovação',    array['view','edit']),
  ('documents',         'Documentos e anexos',    array['view','create','delete','export']),
  ('reports',           'Relatórios',             array['view','export']),
  ('audit',             'Auditoria',              array['view','export']),
  ('settings',          'Configurações',          array['view','edit'])
) as m(module, label, actions),
lateral unnest(m.actions) as a(action)
on conflict (module, action) do nothing;

-- ---------------------------------------------------------------------
-- Perfis de sistema (company_id null = disponível a todas as empresas)
-- ---------------------------------------------------------------------
insert into public.roles (company_id, slug, name, description, is_system, rank) values
  (null,'administrador','Administrador','Acesso completo, incluindo configurações e auditoria.',true,10),
  (null,'diretoria','Diretoria','Visão completa da operação e poder de aprovação.',true,20),
  (null,'compras','Compras','Fornecedores, solicitações, cotações, pedidos e recebimentos.',true,30),
  (null,'financeiro','Financeiro','Duplicatas, contas a pagar e pagamentos.',true,30),
  (null,'fiscal','Fiscal','XML, NF-e, DANFE, impostos e divergências.',true,30),
  (null,'solicitante','Solicitante','Abre e acompanha as próprias solicitações.',true,60),
  (null,'visualizacao','Visualização','Somente leitura.',true,90)
on conflict (coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid), slug) do nothing;

-- ---------------------------------------------------------------------
-- Matriz perfil × permissão
-- ---------------------------------------------------------------------
create or replace function app.grant_role(_slug text, _pred text)
returns void language plpgsql as $$
begin
  execute format($f$
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id
      from public.roles r cross join public.permissions p
     where r.slug = %L and r.company_id is null and (%s)
    on conflict do nothing
  $f$, _slug, _pred);
end $$;

-- Administrador: tudo
select app.grant_role('administrador', 'true');

-- Diretoria: leitura total, exportação e aprovação
select app.grant_role('diretoria', $$
  p.action in ('view','export')
  or (p.action = 'approve')
$$);

-- Compras: dono do ciclo até o pedido
select app.grant_role('compras', $$
  (p.module in ('dashboard','reports','invoices','installments','accounts_payable','departments','cost_centers','documents')
   and p.action in ('view','export'))
  or (p.module in ('purchase_requests','quotations','purchase_orders','goods_receipts','suppliers','products','categories')
      and p.action in ('view','create','edit','cancel','export'))
  or (p.module = 'documents' and p.action = 'create')
  or (p.module = 'divergences' and p.action in ('view','edit'))
$$);

-- Financeiro: duplicatas, contas a pagar e baixa
select app.grant_role('financeiro', $$
  (p.module in ('dashboard','reports','purchase_orders','invoices','suppliers','products','cost_centers','departments','divergences')
   and p.action in ('view','export'))
  or (p.module in ('installments','accounts_payable','payments')
      and p.action in ('view','create','edit','cancel','export','pay'))
  or (p.module = 'documents' and p.action in ('view','create','export'))
$$);

-- Fiscal: XML, NF-e e conferência
select app.grant_role('fiscal', $$
  (p.module in ('dashboard','reports','purchase_orders','suppliers','installments','accounts_payable','goods_receipts')
   and p.action in ('view','export'))
  or (p.module in ('invoices','xml_import','divergences')
      and p.action in ('view','create','edit','cancel','export','import','approve'))
  or (p.module = 'products' and p.action in ('view','create','edit','export'))
  or (p.module = 'documents' and p.action in ('view','create','export'))
$$);

-- Solicitante: abre pedidos internos e acompanha
select app.grant_role('solicitante', $$
  (p.module = 'dashboard' and p.action = 'view')
  or (p.module = 'purchase_requests' and p.action in ('view','create','edit'))
  or (p.module in ('products','suppliers','cost_centers','departments','documents') and p.action = 'view')
$$);

-- Visualização: somente leitura na operação
select app.grant_role('visualizacao', $$
  p.action = 'view'
  and p.module in ('dashboard','purchase_requests','quotations','purchase_orders','goods_receipts',
                   'invoices','installments','accounts_payable','payments','suppliers','products',
                   'cost_centers','departments','documents','reports')
$$);

drop function app.grant_role(text, text);

-- ---------------------------------------------------------------------
-- Onboarding (item 112): cria a empresa e vincula o primeiro admin.
-- Liberada apenas para superadmin OU quando ainda não existe empresa.
-- ---------------------------------------------------------------------
create or replace function app.bootstrap_company(
  _legal_name text,
  _cnpj       text,
  _trade_name text default null,
  _owner_id   uuid default auth.uid()
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_role    uuid;
  v_first   boolean;
begin
  select not exists (select 1 from public.companies) into v_first;

  if not (v_first or app.is_superadmin()) then
    raise exception 'Sem permissão para criar empresas.' using errcode = '42501';
  end if;

  if _owner_id is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  insert into public.companies (legal_name, trade_name, cnpj)
  values (_legal_name, coalesce(_trade_name, _legal_name), regexp_replace(_cnpj, '\D', '', 'g'))
  returning id into v_company;

  select id into v_role from public.roles
   where slug = 'administrador' and company_id is null;

  insert into public.user_companies (user_id, company_id, role_id, is_default)
  values (_owner_id, v_company, v_role, true)
  on conflict (user_id, company_id) do update set role_id = excluded.role_id;

  -- o primeiro usuário da instalação vira superadmin
  if v_first then
    update public.users set is_superadmin = true where id = _owner_id;
  end if;

  insert into public.departments (company_id, code, name)
  values (v_company, 'ADM', 'Administrativo'), (v_company, 'OPE', 'Operações')
  on conflict do nothing;

  insert into public.cost_centers (company_id, code, name)
  values (v_company, '1000', 'Administrativo'), (v_company, '2000', 'Operacional')
  on conflict do nothing;

  return v_company;
end $$;

grant execute on function app.bootstrap_company(text, text, text, uuid) to authenticated;
