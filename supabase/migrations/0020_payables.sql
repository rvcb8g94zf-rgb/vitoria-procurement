-- =====================================================================
-- Vitória Procurement — Financeiro / Migração 0020
-- Duplicatas, contas a pagar, pagamentos e calendário de vencimentos.
--
-- Decisões de desenho:
--  • A duplicata da NF-e é o documento; o título a pagar é o compromisso.
--    Um não vira o outro sozinho: alguém do financeiro manda gerar. Assim
--    nota cancelada, devolução ou acerto com o fornecedor não viram
--    cobrança por engano.
--  • Cada duplicata gera no máximo um título vivo. O índice único garante
--    isso no banco, não só na tela — gerar duas vezes não duplica dívida.
--  • Nada é apagado. Título errado é cancelado com motivo; baixa errada é
--    estornada com motivo. O histórico fica.
--  • A situação do título (aberto/parcial/pago/cancelado) é coluna
--    calculada: não existe caminho para ela discordar do valor pago.
--  • "Vencido" depende do dia de hoje, então é calculado na consulta —
--    nunca gravado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.payables (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  supplier_id    uuid references public.suppliers(id) on delete restrict,
  invoice_id     uuid references public.received_invoices(id) on delete set null,
  duplicate_id   uuid references public.received_invoice_duplicates(id) on delete set null,
  origin         text not null default 'manual' check (origin in ('nfe', 'manual')),
  document       text,                               -- "NF 9426 · parcela 001"
  description    text not null,
  supplier_label text,                               -- quem cobra, quando não há cadastro
  issue_date     date,
  due_date       date not null,
  amount         numeric(14,2) not null check (amount > 0),
  paid_amount    numeric(14,2) not null default 0 check (paid_amount >= 0),
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  department_id  uuid references public.departments(id) on delete set null,
  notes          text,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.users(id) on delete set null,
  cancel_reason  text,
  -- situação sempre derivada: não há como gravar "pago" sem pagamento
  status         text generated always as (
                   case when cancelled_at is not null then 'cancelado'
                        when paid_amount >= amount    then 'pago'
                        when paid_amount > 0          then 'parcial'
                        else 'aberto' end) stored,
  constraint payables_cancel_ok check (
    (cancelled_at is null and cancel_reason is null)
    or (cancelled_at is not null and length(btrim(cancel_reason)) >= 5)),
  constraint payables_paid_ok check (paid_amount <= amount)
);

-- uma duplicata só pode ter um título vivo
create unique index if not exists payables_duplicate_uk
  on public.payables (duplicate_id) where duplicate_id is not null and cancelled_at is null;
create index if not exists payables_due_ix      on public.payables (company_id, due_date);
create index if not exists payables_supplier_ix on public.payables (company_id, supplier_id);
create index if not exists payables_invoice_ix  on public.payables (invoice_id);

create table if not exists public.payable_payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  payable_id    uuid not null references public.payables(id) on delete cascade,
  paid_at       date not null,
  amount        numeric(14,2) not null check (amount > 0),
  method        text not null check (method in ('pix','boleto','ted','doc','dinheiro',
                                                'cartao','cheque','debito_automatico','outros')),
  reference     text,                                  -- autenticação, nº do comprovante
  notes         text,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references public.users(id) on delete set null,
  cancel_reason text,
  constraint payable_payments_cancel_ok check (
    (cancelled_at is null and cancel_reason is null)
    or (cancelled_at is not null and length(btrim(cancel_reason)) >= 5))
);
create index if not exists payable_payments_payable_ix on public.payable_payments (payable_id);
create index if not exists payable_payments_date_ix    on public.payable_payments (company_id, paid_at desc);

drop trigger if exists trg_payables_touch on public.payables;
create trigger trg_payables_touch before update on public.payables
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- RLS — leitura pelo cliente, escrita só pelas funções abaixo
-- ---------------------------------------------------------------------
alter table public.payables         enable row level security;
alter table public.payable_payments enable row level security;

drop policy if exists payables_select on public.payables;
create policy payables_select on public.payables for select to authenticated
using (app.has_permission(company_id, 'accounts_payable', 'view'));

drop policy if exists payable_payments_select on public.payable_payments;
create policy payable_payments_select on public.payable_payments for select to authenticated
using (app.has_permission(company_id, 'payments', 'view'));

-- ---------------------------------------------------------------------
-- Rótulo do título a partir da nota
-- ---------------------------------------------------------------------
create or replace function app.payable_label(_number text, _seq smallint, _dup text, _total int)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case
    when _total <= 1 then 'NF ' || coalesce(_number, 's/nº')
    else 'NF ' || coalesce(_number, 's/nº') || ' · parcela ' ||
         coalesce(nullif(btrim(_dup), ''), _seq::text) || '/' || _total
  end;
$$;

-- ---------------------------------------------------------------------
-- Gerar títulos a partir das notas
--
-- Para cada nota: uma duplicata vira um título. Nota sem duplicata vira
-- um título único com vencimento na emissão — é como o fornecedor cobra
-- quando não parcela. Nota cancelada não gera nada.
-- ---------------------------------------------------------------------
create or replace function app.generate_payables(_company_id uuid, _invoice_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid   uuid := auth.uid();
  nota    record;
  dup     record;
  v_tot   int;
  v_crio  int := 0;
  v_pulo  int := 0;
  v_valor numeric(14,2) := 0;
  v_notas int := 0;
  v_motivos jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.has_permission(_company_id, 'accounts_payable', 'create') then
    raise exception 'Sem permissão para criar contas a pagar nesta empresa.' using errcode = '42501';
  end if;
  if _invoice_ids is null or array_length(_invoice_ids, 1) is null then
    return jsonb_build_object('criados', 0, 'pulados', 0, 'notas', 0, 'total', 0, 'motivos', '[]'::jsonb);
  end if;
  if array_length(_invoice_ids, 1) > 200 then
    raise exception 'Máximo de 200 notas por vez.' using errcode = '22023';
  end if;

  for nota in
    select ri.id, ri.number, ri.issued_at, ri.total_amount, ri.supplier_id,
           ri.emitter_name, ri.fiscal_status
      from public.received_invoices ri
     where ri.company_id = _company_id and ri.id = any(_invoice_ids)
  loop
    if nota.fiscal_status = 'cancelada' then
      v_motivos := v_motivos || jsonb_build_object(
        'invoice_id', nota.id, 'number', nota.number, 'motivo', 'nota cancelada');
      continue;
    end if;

    select count(*)::int into v_tot
      from public.received_invoice_duplicates d where d.invoice_id = nota.id;
    v_notas := v_notas + 1;

    if v_tot = 0 then
      -- sem parcelas: um título só, vencendo na emissão
      if exists (select 1 from public.payables p
                  where p.invoice_id = nota.id and p.duplicate_id is null and p.cancelled_at is null) then
        v_pulo := v_pulo + 1;
      else
        insert into public.payables (
          company_id, supplier_id, invoice_id, duplicate_id, origin, document, description,
          supplier_label, issue_date, due_date, amount, created_by)
        values (_company_id, nota.supplier_id, nota.id, null, 'nfe',
                app.payable_label(nota.number, 1::smallint, null, 1),
                'Compra ' || app.payable_label(nota.number, 1::smallint, null, 1),
                nota.emitter_name, nota.issued_at::date, nota.issued_at::date,
                nota.total_amount, v_uid);
        v_crio  := v_crio + 1;
        v_valor := v_valor + nota.total_amount;
      end if;
    else
      for dup in
        select d.id, d.seq, d.number, d.due_date, d.amount
          from public.received_invoice_duplicates d
         where d.invoice_id = nota.id order by d.seq
      loop
        if exists (select 1 from public.payables p
                    where p.duplicate_id = dup.id and p.cancelled_at is null) then
          v_pulo := v_pulo + 1;
          continue;
        end if;
        insert into public.payables (
          company_id, supplier_id, invoice_id, duplicate_id, origin, document, description,
          supplier_label, issue_date, due_date, amount, created_by)
        values (_company_id, nota.supplier_id, nota.id, dup.id, 'nfe',
                app.payable_label(nota.number, dup.seq, dup.number, v_tot),
                'Compra ' || app.payable_label(nota.number, dup.seq, dup.number, v_tot),
                nota.emitter_name, nota.issued_at::date,
                coalesce(dup.due_date, nota.issued_at::date),
                case when dup.amount > 0 then dup.amount else nota.total_amount end, v_uid);
        v_crio  := v_crio + 1;
        v_valor := v_valor + case when dup.amount > 0 then dup.amount else nota.total_amount end;
      end loop;
    end if;
  end loop;

  if v_crio > 0 then
    insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
    values (_company_id, v_uid, 'created', 'payable', null,
            format('%s título(s) a pagar gerados a partir de %s nota(s)', v_crio, v_notas),
            '/financeiro/contas-a-pagar');
  end if;

  return jsonb_build_object('criados', v_crio, 'pulados', v_pulo, 'notas', v_notas,
                            'total', v_valor, 'motivos', v_motivos);
end $fn$;

-- ---------------------------------------------------------------------
-- Título avulso (aluguel, imposto, serviço sem nota no sistema)
-- ---------------------------------------------------------------------
create or replace function app.create_payable(
  _company_id     uuid,
  _description    text,
  _due_date       date,
  _amount         numeric,
  _supplier_id    uuid    default null,
  _supplier_label text    default null,
  _document       text    default null,
  _issue_date     date    default null,
  _cost_center_id uuid    default null,
  _department_id  uuid    default null,
  _notes          text    default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.has_permission(_company_id, 'accounts_payable', 'create') then
    raise exception 'Sem permissão para criar contas a pagar nesta empresa.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_description, ''))) < 3 then
    raise exception 'Descreva o título em pelo menos 3 letras.' using errcode = '22023';
  end if;
  if _due_date is null then
    raise exception 'Informe o vencimento.' using errcode = '22023';
  end if;
  if coalesce(_amount, 0) <= 0 then
    raise exception 'O valor precisa ser maior que zero.' using errcode = '22023';
  end if;
  if _supplier_id is not null and not exists (
       select 1 from public.suppliers s
        where s.id = _supplier_id and s.company_id = _company_id and s.deleted_at is null) then
    raise exception 'Fornecedor não encontrado nesta empresa.' using errcode = '23503';
  end if;

  insert into public.payables (
    company_id, supplier_id, origin, document, description, supplier_label,
    issue_date, due_date, amount, cost_center_id, department_id, notes, created_by)
  values (_company_id, _supplier_id, 'manual', nullif(btrim(coalesce(_document, '')), ''),
          btrim(_description), nullif(btrim(coalesce(_supplier_label, '')), ''),
          _issue_date, _due_date, round(_amount, 2), _cost_center_id, _department_id,
          nullif(btrim(coalesce(_notes, '')), ''), v_uid)
  returning id into v_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'created', 'payable', v_id,
          format('Título "%s" criado — R$ %s', btrim(_description),
                 translate(to_char(round(_amount, 2), 'FM999,999,999,990.00'), ',.', '.,')),
          '/financeiro/contas-a-pagar');

  return jsonb_build_object('id', v_id);
end $fn$;

-- ---------------------------------------------------------------------
-- Editar vencimento / valor / rateio de um título ainda não pago
-- ---------------------------------------------------------------------
create or replace function app.update_payable(
  _company_id     uuid,
  _payable_id     uuid,
  _due_date       date    default null,
  _amount         numeric default null,
  _description    text    default null,
  _cost_center_id uuid    default null,
  _department_id  uuid    default null,
  _notes          text    default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  t     record;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  select * into t from public.payables where id = _payable_id and company_id = _company_id;
  if t.id is null then
    raise exception 'Título não encontrado.' using errcode = 'P0002';
  end if;
  if not app.has_permission(_company_id, 'accounts_payable', 'edit') then
    raise exception 'Sem permissão para editar contas a pagar nesta empresa.' using errcode = '42501';
  end if;
  if t.cancelled_at is not null then
    raise exception 'Este título está cancelado.' using errcode = '22023';
  end if;
  if _amount is not null and round(_amount, 2) < t.paid_amount then
    raise exception 'O valor não pode ficar abaixo do que já foi pago.' using errcode = '22023';
  end if;
  if _amount is not null and round(_amount, 2) <= 0 then
    raise exception 'O valor precisa ser maior que zero.' using errcode = '22023';
  end if;

  update public.payables set
    due_date       = coalesce(_due_date, due_date),
    amount         = coalesce(round(_amount, 2), amount),
    description    = coalesce(nullif(btrim(coalesce(_description, '')), ''), description),
    cost_center_id = coalesce(_cost_center_id, cost_center_id),
    department_id  = coalesce(_department_id, department_id),
    notes          = coalesce(nullif(btrim(coalesce(_notes, '')), ''), notes)
  where id = _payable_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'updated', 'payable', _payable_id,
          format('Título "%s" alterado', t.description), '/financeiro/contas-a-pagar');

  return jsonb_build_object('id', _payable_id);
end $fn$;

-- ---------------------------------------------------------------------
-- Baixa (pagamento). Aceita pagamento parcial.
-- ---------------------------------------------------------------------
create or replace function app.pay_payable(
  _company_id uuid,
  _payable_id uuid,
  _paid_at    date,
  _amount     numeric,
  _method     text,
  _reference  text default null,
  _notes      text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid   uuid := auth.uid();
  t       record;
  v_id    uuid;
  v_falta numeric(14,2);
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  select * into t from public.payables where id = _payable_id and company_id = _company_id for update;
  if t.id is null then
    raise exception 'Título não encontrado.' using errcode = 'P0002';
  end if;
  if not app.has_permission(_company_id, 'payments', 'pay') then
    raise exception 'Sem permissão para dar baixa em pagamentos nesta empresa.' using errcode = '42501';
  end if;
  if t.cancelled_at is not null then
    raise exception 'Este título está cancelado.' using errcode = '22023';
  end if;

  v_falta := t.amount - t.paid_amount;
  if v_falta <= 0 then
    raise exception 'Este título já está pago.' using errcode = '22023';
  end if;
  if coalesce(_amount, 0) <= 0 then
    raise exception 'O valor pago precisa ser maior que zero.' using errcode = '22023';
  end if;
  if round(_amount, 2) > v_falta then
    raise exception 'O valor pago é maior que o saldo do título (R$ %).',
      translate(to_char(v_falta, 'FM999,999,999,990.00'), ',.', '.,') using errcode = '22023';
  end if;
  if _paid_at is null or _paid_at > current_date then
    raise exception 'A data do pagamento não pode ser no futuro.' using errcode = '22023';
  end if;

  insert into public.payable_payments (
    company_id, payable_id, paid_at, amount, method, reference, notes, created_by)
  values (_company_id, _payable_id, _paid_at, round(_amount, 2), _method,
          nullif(btrim(coalesce(_reference, '')), ''), nullif(btrim(coalesce(_notes, '')), ''), v_uid)
  returning id into v_id;

  update public.payables set paid_amount = paid_amount + round(_amount, 2) where id = _payable_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'updated', 'payable', _payable_id,
          format('Pagamento de R$ %s em "%s"',
                 translate(to_char(round(_amount, 2), 'FM999,999,999,990.00'), ',.', '.,'), t.description),
          '/financeiro/contas-a-pagar');

  return jsonb_build_object('id', v_id, 'payable_id', _payable_id,
                            'saldo', v_falta - round(_amount, 2));
end $fn$;

-- ---------------------------------------------------------------------
-- Estorno de baixa
-- ---------------------------------------------------------------------
create or replace function app.cancel_payment(_company_id uuid, _payment_id uuid, _reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  pg    record;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  select * into pg from public.payable_payments where id = _payment_id and company_id = _company_id for update;
  if pg.id is null then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;
  if not app.has_permission(_company_id, 'payments', 'cancel') then
    raise exception 'Sem permissão para estornar pagamentos nesta empresa.' using errcode = '42501';
  end if;
  if pg.cancelled_at is not null then
    raise exception 'Este pagamento já foi estornado.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(_reason, ''))) < 5 then
    raise exception 'Escreva o motivo do estorno (pelo menos 5 letras).' using errcode = '22023';
  end if;

  update public.payable_payments
     set cancelled_at = now(), cancelled_by = v_uid, cancel_reason = btrim(_reason)
   where id = _payment_id;
  update public.payables set paid_amount = greatest(0, paid_amount - pg.amount)
   where id = pg.payable_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'cancelled', 'payable', pg.payable_id,
          format('Pagamento de R$ %s estornado',
                 translate(to_char(pg.amount, 'FM999,999,999,990.00'), ',.', '.,')),
          '/financeiro/contas-a-pagar');

  return jsonb_build_object('id', _payment_id, 'payable_id', pg.payable_id);
end $fn$;

-- ---------------------------------------------------------------------
-- Cancelar título
-- ---------------------------------------------------------------------
create or replace function app.cancel_payable(_company_id uuid, _payable_id uuid, _reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  t     record;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  select * into t from public.payables where id = _payable_id and company_id = _company_id for update;
  if t.id is null then
    raise exception 'Título não encontrado.' using errcode = 'P0002';
  end if;
  if not app.has_permission(_company_id, 'accounts_payable', 'cancel') then
    raise exception 'Sem permissão para cancelar contas a pagar nesta empresa.' using errcode = '42501';
  end if;
  if t.cancelled_at is not null then
    raise exception 'Este título já está cancelado.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(_reason, ''))) < 5 then
    raise exception 'Escreva o motivo do cancelamento (pelo menos 5 letras).' using errcode = '22023';
  end if;
  if exists (select 1 from public.payable_payments p
              where p.payable_id = _payable_id and p.cancelled_at is null) then
    raise exception 'Estorne os pagamentos antes de cancelar o título.' using errcode = '22023';
  end if;

  update public.payables
     set cancelled_at = now(), cancelled_by = v_uid, cancel_reason = btrim(_reason)
   where id = _payable_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'cancelled', 'payable', _payable_id,
          format('Título "%s" cancelado', t.description), '/financeiro/contas-a-pagar');

  return jsonb_build_object('id', _payable_id);
end $fn$;

-- ---------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------
-- Títulos, com saldo e atraso calculados no banco.
create or replace function public.search_payables(
  _company_id uuid,
  _from       date default null,
  _to         date default null,
  _supplier   uuid default null,
  _status     text default null,   -- '' | aberto | parcial | pago | cancelado | vencido | a_vencer
  _search     text default null,
  _limit      int  default 500
)
returns table (
  id uuid, supplier_id uuid, supplier_name text, invoice_id uuid, invoice_number text,
  duplicate_id uuid, origin text, document text, description text, issue_date date,
  due_date date, amount numeric, paid_amount numeric, balance numeric, status text,
  days_late int, cost_center_name text, department_name text, created_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  with q as (select btrim(coalesce(_search, '')) as texto)
  select p.id, p.supplier_id,
         coalesce(s.trade_name, s.legal_name, p.supplier_label) as supplier_name,
         p.invoice_id, ri.number as invoice_number, p.duplicate_id, p.origin, p.document,
         p.description, p.issue_date, p.due_date, p.amount, p.paid_amount,
         (p.amount - p.paid_amount) as balance, p.status,
         case when p.status in ('aberto', 'parcial') and p.due_date < current_date
              then (current_date - p.due_date)::int else 0 end as days_late,
         cc.name as cost_center_name, d.name as department_name, p.created_at
    from public.payables p
    left join public.suppliers    s  on s.id  = p.supplier_id
    left join public.received_invoices ri on ri.id = p.invoice_id
    left join public.cost_centers cc on cc.id = p.cost_center_id
    left join public.departments  d  on d.id  = p.department_id
   cross join q
   where p.company_id = _company_id
     and (_from is null or p.due_date >= _from)
     and (_to   is null or p.due_date <= _to)
     and (_supplier is null or p.supplier_id = _supplier)
     and (coalesce(_status, '') = ''
          or (_status = 'vencido'  and p.status in ('aberto','parcial') and p.due_date <  current_date)
          or (_status = 'a_vencer' and p.status in ('aberto','parcial') and p.due_date >= current_date)
          or (_status = 'em_aberto' and p.status in ('aberto','parcial'))
          or p.status = _status)
     and (q.texto = ''
          or p.description ilike '%' || q.texto || '%'
          or p.document    ilike '%' || q.texto || '%'
          or ri.number     ilike '%' || q.texto || '%'
          or coalesce(s.trade_name, s.legal_name, p.supplier_label) ilike '%' || q.texto || '%')
   order by p.due_date, p.created_at
   limit greatest(1, least(coalesce(_limit, 500), 2000));
$fn$;

-- Duplicatas de nota que ainda não viraram título.
create or replace function public.pending_duplicates(
  _company_id uuid,
  _from       date default null,
  _to         date default null,
  _supplier   uuid default null,
  _limit      int  default 500
)
returns table (
  invoice_id uuid, invoice_number text, issued_at timestamptz, emitter_name text,
  supplier_id uuid, supplier_name text, fiscal_status text, invoice_total numeric,
  duplicates_count int, pending_count int, pending_total numeric, first_due date, last_due date
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select ri.id, ri.number, ri.issued_at, ri.emitter_name, ri.supplier_id,
         coalesce(s.trade_name, s.legal_name) as supplier_name,
         ri.fiscal_status::text, ri.total_amount,
         (select count(*)::int from public.received_invoice_duplicates d where d.invoice_id = ri.id),
         -- nota sem parcelas vira um título único com o total da nota
         case when pend.n > 0 then pend.n
              when not exists (select 1 from public.payables p
                                where p.invoice_id = ri.id and p.cancelled_at is null) then 1
              else 0 end,
         case when pend.n > 0 then pend.v
              when not exists (select 1 from public.payables p
                                where p.invoice_id = ri.id and p.cancelled_at is null) then ri.total_amount
              else 0 end,
         pend.primeiro, pend.ultimo
    from public.received_invoices ri
    left join public.suppliers s on s.id = ri.supplier_id
    left join lateral (
      select count(*)::int as n, coalesce(sum(d.amount), 0) as v,
             min(d.due_date) as primeiro, max(d.due_date) as ultimo
        from public.received_invoice_duplicates d
       where d.invoice_id = ri.id
         and not exists (select 1 from public.payables p
                          where p.duplicate_id = d.id and p.cancelled_at is null)
    ) pend on true
   where ri.company_id = _company_id
     and ri.fiscal_status <> 'cancelada'
     and (_from is null or ri.issued_at >= _from::timestamptz)
     and (_to   is null or ri.issued_at <  (_to + 1)::timestamptz)
     and (_supplier is null or ri.supplier_id = _supplier)
     and (coalesce(pend.n, 0) > 0
          or not exists (select 1 from public.payables p
                          where p.invoice_id = ri.id and p.cancelled_at is null))
   order by ri.issued_at desc
   limit greatest(1, least(coalesce(_limit, 500), 2000));
$fn$;

-- Um dia por linha: o calendário monta o mês a partir daqui.
create or replace function public.payables_calendar(_company_id uuid, _from date, _to date)
returns table (day date, titulos int, total numeric, aberto numeric, pago numeric)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select p.due_date,
         count(*)::int,
         sum(p.amount),
         sum(p.amount - p.paid_amount) filter (where p.status in ('aberto','parcial')),
         sum(p.paid_amount)
    from public.payables p
   where p.company_id = _company_id
     and p.status <> 'cancelado'
     and p.due_date between _from and _to
   group by p.due_date
   order by p.due_date;
$fn$;

-- Pagamentos feitos, para o extrato.
create or replace function public.search_payments(
  _company_id uuid,
  _from       date default null,
  _to         date default null,
  _supplier   uuid default null,
  _method     text default null,
  _search     text default null,
  _limit      int  default 500
)
returns table (
  id uuid, payable_id uuid, paid_at date, amount numeric, method text, reference text,
  notes text, description text, document text, supplier_id uuid, supplier_name text,
  invoice_number text, paid_by text, created_at timestamptz,
  cancelled_at timestamptz, cancel_reason text
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  with q as (select btrim(coalesce(_search, '')) as texto)
  select pp.id, pp.payable_id, pp.paid_at, pp.amount, pp.method, pp.reference, pp.notes,
         p.description, p.document, p.supplier_id,
         coalesce(s.trade_name, s.legal_name, p.supplier_label) as supplier_name,
         ri.number, u.full_name, pp.created_at, pp.cancelled_at, pp.cancel_reason
    from public.payable_payments pp
    join public.payables p on p.id = pp.payable_id
    left join public.suppliers s on s.id = p.supplier_id
    left join public.received_invoices ri on ri.id = p.invoice_id
    left join public.users u on u.id = pp.created_by
   cross join q
   where pp.company_id = _company_id
     and (_from is null or pp.paid_at >= _from)
     and (_to   is null or pp.paid_at <= _to)
     and (_supplier is null or p.supplier_id = _supplier)
     and (coalesce(_method, '') = '' or pp.method = _method)
     and (q.texto = ''
          or p.description ilike '%' || q.texto || '%'
          or pp.reference  ilike '%' || q.texto || '%'
          or ri.number     ilike '%' || q.texto || '%'
          or coalesce(s.trade_name, s.legal_name, p.supplier_label) ilike '%' || q.texto || '%')
   order by pp.paid_at desc, pp.created_at desc
   limit greatest(1, least(coalesce(_limit, 500), 2000));
$fn$;

-- ---------------------------------------------------------------------
-- Casca pública das funções de escrita (o PostgREST só enxerga public)
-- ---------------------------------------------------------------------
create or replace function public.generate_payables(_company_id uuid, _invoice_ids uuid[])
returns jsonb language sql security invoker set search_path = public, pg_temp as $fn$
  select app.generate_payables(_company_id, _invoice_ids);
$fn$;

create or replace function public.create_payable(
  _company_id uuid, _description text, _due_date date, _amount numeric,
  _supplier_id uuid default null, _supplier_label text default null, _document text default null,
  _issue_date date default null, _cost_center_id uuid default null,
  _department_id uuid default null, _notes text default null)
returns jsonb language sql security invoker set search_path = public, pg_temp as $fn$
  select app.create_payable(_company_id, _description, _due_date, _amount, _supplier_id,
                            _supplier_label, _document, _issue_date, _cost_center_id,
                            _department_id, _notes);
$fn$;

create or replace function public.update_payable(
  _company_id uuid, _payable_id uuid, _due_date date default null, _amount numeric default null,
  _description text default null, _cost_center_id uuid default null,
  _department_id uuid default null, _notes text default null)
returns jsonb language sql security invoker set search_path = public, pg_temp as $fn$
  select app.update_payable(_company_id, _payable_id, _due_date, _amount, _description,
                            _cost_center_id, _department_id, _notes);
$fn$;

create or replace function public.pay_payable(
  _company_id uuid, _payable_id uuid, _paid_at date, _amount numeric, _method text,
  _reference text default null, _notes text default null)
returns jsonb language sql security invoker set search_path = public, pg_temp as $fn$
  select app.pay_payable(_company_id, _payable_id, _paid_at, _amount, _method, _reference, _notes);
$fn$;

create or replace function public.cancel_payment(_company_id uuid, _payment_id uuid, _reason text)
returns jsonb language sql security invoker set search_path = public, pg_temp as $fn$
  select app.cancel_payment(_company_id, _payment_id, _reason);
$fn$;

create or replace function public.cancel_payable(_company_id uuid, _payable_id uuid, _reason text)
returns jsonb language sql security invoker set search_path = public, pg_temp as $fn$
  select app.cancel_payable(_company_id, _payable_id, _reason);
$fn$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on function
  app.generate_payables(uuid, uuid[]),
  app.create_payable(uuid, text, date, numeric, uuid, text, text, date, uuid, uuid, text),
  app.update_payable(uuid, uuid, date, numeric, text, uuid, uuid, text),
  app.pay_payable(uuid, uuid, date, numeric, text, text, text),
  app.cancel_payment(uuid, uuid, text),
  app.cancel_payable(uuid, uuid, text),
  app.payable_label(text, smallint, text, int),
  public.generate_payables(uuid, uuid[]),
  public.create_payable(uuid, text, date, numeric, uuid, text, text, date, uuid, uuid, text),
  public.update_payable(uuid, uuid, date, numeric, text, uuid, uuid, text),
  public.pay_payable(uuid, uuid, date, numeric, text, text, text),
  public.cancel_payment(uuid, uuid, text),
  public.cancel_payable(uuid, uuid, text),
  public.search_payables(uuid, date, date, uuid, text, text, int),
  public.pending_duplicates(uuid, date, date, uuid, int),
  public.payables_calendar(uuid, date, date),
  public.search_payments(uuid, date, date, uuid, text, text, int)
from public, anon;

-- as cascas em public são security invoker: quem chama precisa poder
-- executar também a função de verdade, em app
grant execute on function
  app.generate_payables(uuid, uuid[]),
  app.create_payable(uuid, text, date, numeric, uuid, text, text, date, uuid, uuid, text),
  app.update_payable(uuid, uuid, date, numeric, text, uuid, uuid, text),
  app.pay_payable(uuid, uuid, date, numeric, text, text, text),
  app.cancel_payment(uuid, uuid, text),
  app.cancel_payable(uuid, uuid, text),
  app.payable_label(text, smallint, text, int),
  public.generate_payables(uuid, uuid[]),
  public.create_payable(uuid, text, date, numeric, uuid, text, text, date, uuid, uuid, text),
  public.update_payable(uuid, uuid, date, numeric, text, uuid, uuid, text),
  public.pay_payable(uuid, uuid, date, numeric, text, text, text),
  public.cancel_payment(uuid, uuid, text),
  public.cancel_payable(uuid, uuid, text),
  public.search_payables(uuid, date, date, uuid, text, text, int),
  public.pending_duplicates(uuid, date, date, uuid, int),
  public.payables_calendar(uuid, date, date),
  public.search_payments(uuid, date, date, uuid, text, text, int)
to authenticated;

grant select on public.payables, public.payable_payments to authenticated;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
do $do$
declare t text;
begin
  foreach t in array array['payables', 'payable_payments'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function app.audit()', t);
  end loop;
end $do$;
