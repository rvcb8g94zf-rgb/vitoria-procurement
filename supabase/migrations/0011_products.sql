-- =====================================================================
-- Vitória Procurement — Fase 2 / Migração 0011
-- Produtos, unidades, de-para por fornecedor e histórico de preços.
--
-- Modelagem guiada por 8 XMLs reais dos fornecedores das duas empresas.
-- Cada decisão abaixo responde a algo observado nesses arquivos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- UNIDADES — normalização
-- Os XMLs trouxeram UN, PC, "PC." (com ponto), M e MT. Metro linear
-- escrito de dois jeitos por fornecedores diferentes. `aliases` guarda
-- as grafias encontradas para casar na importação.
-- ---------------------------------------------------------------------
create table if not exists public.units (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  aliases   text[] not null default '{}',
  is_active boolean not null default true
);

insert into public.units (code, name, aliases) values
  ('UN', 'Unidade',    array['UN','UND','UNID','UNIDADE','PC','PC.','PÇ','PCS','PEÇA']),
  ('M',  'Metro',      array['M','MT','MTR','METRO','ML']),
  ('M2', 'Metro quad.',array['M2','MT2','M²']),
  ('M3', 'Metro cúb.', array['M3','MT3','M³']),
  ('KG', 'Quilograma', array['KG','QUILO','KGS']),
  ('L',  'Litro',      array['L','LT','LTR','LITRO']),
  ('CX', 'Caixa',      array['CX','CAIXA','CXA']),
  ('SC', 'Saco',       array['SC','SACO','SACA']),
  ('PCT','Pacote',     array['PCT','PACOTE','PACK']),
  ('BD', 'Balde',      array['BD','BALDE']),
  ('RL', 'Rolo',       array['RL','ROLO']),
  ('BR', 'Barra',      array['BR','BARRA']),
  ('CJ', 'Conjunto',   array['CJ','CONJ','KIT','JG','JOGO'])
on conflict (code) do nothing;

create or replace function app.resolve_unit(_raw text)
returns uuid language sql stable set search_path = public, pg_temp as $$
  select u.id from public.units u
   where upper(regexp_replace(coalesce(_raw,''), '[^A-Za-z0-9²³]', '', 'g')) = any(
           select upper(regexp_replace(a, '[^A-Za-z0-9²³]', '', 'g')) from unnest(u.aliases) a)
   limit 1;
$$;

-- ---------------------------------------------------------------------
-- PRODUTOS — o cadastro interno da empresa
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  sku           text not null,
  description   text not null,
  unit_id       uuid not null references public.units(id) on delete restrict,
  category_id   uuid references public.categories(id) on delete set null,
  brand         text,

  -- fiscal: NCM é obrigatório na NF-e, CEST só quando há ST
  ncm           text,
  cest          text,
  ean           text,

  min_stock     numeric(14,4) not null default 0 check (min_stock >= 0),
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references public.users(id),

  constraint products_ncm_fmt  check (ncm  is null or ncm  ~ '^[0-9]{8}$'),
  constraint products_cest_fmt check (cest is null or cest ~ '^[0-9]{7}$'),
  -- GTIN-8/12/13/14. "SEM GTIN" vira null na importação, nunca texto.
  constraint products_ean_fmt  check (ean  is null or ean  ~ '^[0-9]{8}$|^[0-9]{12,14}$')
);

create unique index if not exists products_sku_uk
  on public.products (company_id, sku) where deleted_at is null;
create index if not exists products_company_ix on public.products (company_id, is_active) where deleted_at is null;
create index if not exists products_ncm_ix on public.products (company_id, ncm) where deleted_at is null;
create index if not exists products_ean_ix on public.products (company_id, ean) where ean is not null;
create index if not exists products_search_ix
  on public.products using gin (to_tsvector('portuguese', description));

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- DE-PARA POR FORNECEDOR
-- O mesmo item tem código diferente em cada fornecedor, e códigos
-- iguais em fornecedores diferentes são produtos distintos. A chave
-- é sempre o par (fornecedor, código do fornecedor).
--
-- conversion_factor cobre o caso "fatura em caixa, tributa em unidade":
-- nas 8 notas analisadas uCom == uTrib, mas o campo existe porque a
-- primeira nota em que divergir corromperia o histórico de preço.
-- ---------------------------------------------------------------------
create table if not exists public.supplier_products (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  supplier_id         uuid not null references public.suppliers(id) on delete cascade,
  product_id          uuid references public.products(id) on delete set null,

  supplier_code       text not null,          -- cProd
  supplier_desc       text,                   -- xProd como o fornecedor escreve
  supplier_unit_raw   text,                   -- uCom original, sem normalizar
  unit_id             uuid references public.units(id) on delete set null,
  conversion_factor   numeric(14,6) not null default 1 check (conversion_factor > 0),

  ean                 text,
  ncm                 text,
  cest                text,

  last_unit_price     numeric(14,6),
  last_purchase_at    date,

  is_confirmed        boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (supplier_id, supplier_code)
);
create index if not exists supplier_products_product_ix on public.supplier_products (product_id);
create index if not exists supplier_products_company_ix on public.supplier_products (company_id, supplier_id);
create index if not exists supplier_products_unlinked_ix
  on public.supplier_products (company_id) where product_id is null;

drop trigger if exists trg_supplier_products_touch on public.supplier_products;
create trigger trg_supplier_products_touch before update on public.supplier_products
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- HISTÓRICO DE PREÇOS
-- Alimentado por NF-e (Fase 4) e por pedido (Fase 3). As referências a
-- essas tabelas ficam soltas por enquanto: source_type + source_id.
-- ---------------------------------------------------------------------
create table if not exists public.product_price_history (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  supplier_id   uuid references public.suppliers(id) on delete set null,

  occurred_on   date not null,
  unit_price    numeric(14,6) not null check (unit_price >= 0),
  quantity      numeric(14,4) not null check (quantity > 0),
  unit_id       uuid references public.units(id) on delete set null,

  -- custo cheio: com ST e frete rateado, que é o que de fato saiu do caixa
  landed_price  numeric(14,6),

  source_type   text check (source_type in ('invoice','purchase_order','manual')),
  source_id     uuid,
  document_ref  text,                          -- número da NF-e ou do pedido

  created_at    timestamptz not null default now()
);
create index if not exists price_history_product_ix
  on public.product_price_history (company_id, product_id, occurred_on desc);
create index if not exists price_history_supplier_ix
  on public.product_price_history (company_id, supplier_id, occurred_on desc);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.units                 enable row level security;
alter table public.products              enable row level security;
alter table public.supplier_products     enable row level security;
alter table public.product_price_history enable row level security;

drop policy if exists units_select on public.units;
create policy units_select on public.units for select to authenticated using (true);

drop policy if exists products_select on public.products;
create policy products_select on public.products for select to authenticated
using (app.has_permission(company_id, 'products', 'view') and deleted_at is null);

drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert to authenticated
with check (app.has_permission(company_id, 'products', 'create'));

drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated
using (app.has_permission(company_id, 'products', 'edit'))
with check (app.has_permission(company_id, 'products', 'edit'));

drop policy if exists supplier_products_select on public.supplier_products;
create policy supplier_products_select on public.supplier_products for select to authenticated
using (app.has_permission(company_id, 'products', 'view'));

drop policy if exists supplier_products_write on public.supplier_products;
create policy supplier_products_write on public.supplier_products for all to authenticated
using (app.has_permission(company_id, 'products', 'edit'))
with check (app.has_permission(company_id, 'products', 'edit'));

drop policy if exists price_history_select on public.product_price_history;
create policy price_history_select on public.product_price_history for select to authenticated
using (app.has_permission(company_id, 'products', 'view'));

-- escrita só pelo processo de importação / fechamento de pedido
drop policy if exists price_history_insert on public.product_price_history;
create policy price_history_insert on public.product_price_history for insert to authenticated
with check (app.has_permission(company_id, 'products', 'edit'));

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['products','supplier_products'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function app.audit()', t);
  end loop;
end $$;

grant execute on function app.resolve_unit(text) to authenticated;
