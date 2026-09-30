import Link from "next/link";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { Card } from "@/components/panels";
import { createClient } from "@/lib/supabase/server";
import { dateTime, decimal, money } from "@/lib/format";
import { PEDIDO_STATUS } from "@/lib/compras";
import { CONF_STATUS, ORIGEM_LIGACAO, PAR_ORIGEM, resumoProblemas, textoProblema } from "@/lib/conferencia";
import { DesfazerLiberacao, DesligarPedido, LiberarPagamento, LigarPedido, ParItem } from "./conferencia-acoes";

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

type Resumo = {
  status: string;
  issues: string[];
  orders: { id: string; number: string; status: string; source: string; total: number; issued_on: string; from_receipt: boolean }[];
  release: { note: string; at: string; by: string; keys: string[]; covers: boolean } | null;
  can_link: boolean;
  can_release: boolean;
  open_amount: number;
};

/** Card "Conferência com o pedido" da página da nota. */
export async function ConferenciaNota({ companyId, notaId }: { companyId: string; notaId: string }) {
  const supabase = await createClient();
  const [{ data: r, error }, { data: linhas }, { data: cands }, { data: itensPed }] = await Promise.all([
    supabase.rpc("invoice_match_summary", { _company_id: companyId, _invoice_id: notaId }),
    supabase.rpc("invoice_match_detail", { _company_id: companyId, _invoice_id: notaId }),
    supabase.rpc("invoice_link_candidates", { _company_id: companyId, _invoice_id: notaId }),
    supabase.rpc("invoice_order_items", { _company_id: companyId, _invoice_id: notaId }),
  ]);
  if (error || !r) {
    if (error && error.code !== "42501") console.error("[nota] conferência", error);
    return null;
  }
  const s = r as Resumo;
  const candidatos = (cands ?? []) as any[];
  const itens = ((itensPed ?? []) as any[]).map((i) => ({
    id: i.id as string, order_number: i.order_number as string, line_no: Number(i.line_no),
    description: i.description as string, unit: i.unit as string | null,
  }));
  const lista = (linhas ?? []) as any[];

  if (s.status === "cancelada") return null;
  if (s.status === "sem_pedido" && candidatos.length === 0) return null;

  const st = CONF_STATUS[s.status] ?? CONF_STATUS.sem_pedido;
  const retida = s.status === "divergente";
  const resumo = resumoProblemas(s.issues ?? []);
  const alguemPareado = lista.some((l) => l.order_item_id);

  return (
    <Card
      title="Conferência com o pedido"
      note="Preço e quantidade da nota contra o pedido aprovado e o que o recebimento conferiu."
      actions={<span className={`badge ${st.cls}`}>{st.rot}</span>}
      className="mb-4"
    >
      {retida && (
        <div className="flex flex-wrap items-start gap-2.5 border-b border-line-soft bg-danger-soft px-4 py-3 text-[12.5px] text-danger">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p className="min-w-0 flex-1">
            <b>Pagamento retido.</b> {resumo}.{" "}
            {n(s.open_amount) > 0
              ? <>Os títulos desta nota ({money(n(s.open_amount))} em aberto) não podem ser baixados até resolver ou liberar.</>
              : <>Quando os títulos forem gerados, não vão poder ser baixados até resolver ou liberar.</>}
          </p>
          {s.can_release && <LiberarPagamento notaId={notaId} resumo={resumo} />}
        </div>
      )}
      {s.status === "liberada" && s.release && (
        <div className="flex flex-wrap items-start gap-2.5 border-b border-line-soft bg-info-soft px-4 py-3 text-[12.5px] text-info">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p className="min-w-0 flex-1">
            <b>Pagamento liberado</b> por {s.release.by} em {dateTime(s.release.at)}: “{s.release.note}”.
            <span className="block text-[11.5px] opacity-80">Divergências aceitas: {resumo}.</span>
          </p>
          {s.can_release && <DesfazerLiberacao notaId={notaId} />}
        </div>
      )}
      {s.status === "sem_pedido" && (
        <div className="flex gap-2.5 border-b border-line-soft bg-warn-soft px-4 py-3 text-[12.5px] text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p>Há pedido aprovado deste fornecedor. Ligue a nota ao pedido para o sistema conferir preço e quantidade.</p>
        </div>
      )}

      <div className="grid gap-3 px-4 py-3">
        {s.orders.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {s.orders.map((o) => {
              const ps = PEDIDO_STATUS[o.status];
              return (
                <li key={o.id} className="flex items-center gap-2 rounded border border-line px-2.5 py-1.5 text-[12.5px]">
                  <Link href={`/interno/compras/pedidos/${o.id}`} className="font-mono font-medium hover:text-accent hover:underline">
                    {o.number}
                  </Link>
                  {ps && <span className={`badge ${ps.cls}`}>{ps.rot}</span>}
                  <span className="text-[11px] text-muted">{ORIGEM_LIGACAO[o.source] ?? o.source}</span>
                  {s.can_link && !o.from_receipt && <DesligarPedido notaId={notaId} pedidoId={o.id} numero={o.number} />}
                </li>
              );
            })}
          </ul>
        )}
        {s.can_link && candidatos.length > 0 && <LigarPedido notaId={notaId} candidatos={candidatos} />}
      </div>

      {s.status === "aguardando_xml" && (
        <p className="border-t border-line-soft px-4 py-3 text-[12.5px] text-graphite">
          A conferência dos itens começa quando o XML completo chegar.
        </p>
      )}

      {lista.length > 0 && s.orders.length > 0 && (
        <div className="overflow-x-auto border-t border-line-soft">
          <table className="w-full min-w-[1080px] border-collapse">
            <thead>
              <tr>
                <th className="th w-10">#</th>
                <th className="th min-w-[260px]">ITEM DA NOTA</th>
                <th className="th w-[230px]">ITEM DO PEDIDO</th>
                <th className="th w-28 text-right">PREÇO NOTA</th>
                <th className="th w-28 text-right">PREÇO PEDIDO</th>
                <th className="th w-24 text-right">PEDIDO</th>
                <th className="th w-24 text-right">RECEBIDO</th>
                <th className="th w-24 text-right">FATURADO</th>
                <th className="th w-44">CONFERÊNCIA</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => {
                const probs = (l.issues ?? []) as string[];
                const fatorOutro = n(l.factor) !== 1;
                return (
                  <tr key={l.seq} className={`align-top ${probs.length ? "shadow-[inset_3px_0_0_var(--danger)]" : ""}`}>
                    <td className="td text-muted">{l.seq}</td>
                    <td className="td">
                      <div className="line-clamp-2 font-medium" title={l.description}>{l.description}</div>
                      <div className="text-[11px] text-muted">
                        {decimal(n(l.qty_invoice))} {l.order_unit ?? l.unit_raw ?? ""}
                        {fatorOutro && <> · convertido de {l.unit_raw ?? "unid. do fornecedor"} (×{decimal(n(l.factor))})</>}
                      </div>
                    </td>
                    <td className="td">
                      {s.can_link && itens.length > 0 ? (
                        <ParItem notaId={notaId} seq={Number(l.seq)} atual={l.order_item_id}
                                 manual={l.pair_source === "manual"} itens={itens} />
                      ) : null}
                      {l.order_item_id ? (
                        <div className="mt-1 text-[11px] text-muted">
                          {l.order_number} · {l.order_desc}
                          {l.pair_source && <> · {PAR_ORIGEM[l.pair_source] ?? l.pair_source}</>}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-warn">
                          sem par{!alguemPareado ? " — valide o produto ou escolha o item" : ""}
                        </div>
                      )}
                    </td>
                    <td className="td text-right font-mono tabular-nums">{l.price_invoice === null ? "—" : money(n(l.price_invoice))}</td>
                    <td className="td text-right font-mono tabular-nums text-graphite">
                      {l.price_order === null ? "—" : money(n(l.price_order))}
                    </td>
                    <td className="td text-right font-mono tabular-nums text-graphite">{l.order_item_id ? decimal(n(l.qty_ordered)) : "—"}</td>
                    <td className="td text-right font-mono tabular-nums text-graphite">{l.order_item_id ? decimal(n(l.qty_received)) : "—"}</td>
                    <td className="td text-right font-mono tabular-nums">
                      {l.order_item_id ? decimal(n(l.qty_invoiced_cum)) : "—"}
                      {l.order_item_id && n(l.qty_invoiced_cum) !== n(l.qty_invoice) && (
                        <span className="block text-[10.5px] text-muted">somando outras notas</span>
                      )}
                    </td>
                    <td className="td">
                      {probs.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-accent-ink">
                          <CheckCircle2 className="h-3.5 w-3.5" /> confere
                        </span>
                      ) : (
                        <ul className="grid gap-0.5 text-[11.5px] text-danger">
                          {probs.map((p) => <li key={p}>{textoProblema(p)}</li>)}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line-soft px-4 py-2.5 text-[11.5px] text-muted">
            Preço da nota já com desconto do item, sem IPI e ST. Faturado soma esta nota com as anteriores do mesmo pedido.
            As tolerâncias são as da empresa.
          </p>
        </div>
      )}
    </Card>
  );
}
