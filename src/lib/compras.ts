/** Ciclo de compras: rótulos, cores e textos prontos para mandar ao fornecedor. */

export const PEDIDO_STATUS: Record<string, { rot: string; cls: string }> = {
  rascunho: { rot: "Rascunho", cls: "bg-line-soft text-graphite" },
  aguardando_aprovacao: { rot: "Aguardando aprovação", cls: "bg-warn-soft text-warn" },
  aprovado: { rot: "Aprovado", cls: "bg-info-soft text-info" },
  enviado: { rot: "Enviado ao fornecedor", cls: "bg-accent-soft text-accent-ink" },
  confirmado: { rot: "Confirmado", cls: "bg-accent-soft text-accent-ink" },
  parcialmente_recebido: { rot: "Recebido em parte", cls: "bg-warn-soft text-warn" },
  recebido: { rot: "Recebido", cls: "bg-accent-soft text-accent-ink" },
  cancelado: { rot: "Cancelado", cls: "bg-danger-soft text-danger" },
};

export const PEDIDO_FILTROS = [
  { valor: "abertos", rotulo: "Em andamento" },
  { valor: "aguardando_aprovacao", rotulo: "Aguardando aprovação" },
  { valor: "rascunho", rotulo: "Rascunhos" },
  { valor: "enviado", rotulo: "Enviados" },
  { valor: "recebido", rotulo: "Recebidos" },
  { valor: "cancelado", rotulo: "Cancelados" },
  { valor: "", rotulo: "Todos" },
] as const;

export const DECISAO: Record<string, { rot: string; cls: string }> = {
  pendente: { rot: "Pendente", cls: "text-warn" },
  aprovado: { rot: "Aprovado", cls: "text-accent-ink" },
  recusado: { rot: "Recusado", cls: "text-danger" },
  alteracao_solicitada: { rot: "Alteração pedida", cls: "text-warn" },
};

export type PedidoItem = {
  line_no: number; description: string; quantity: number; unit_price: number;
  discount: number; total: number; unit?: { code: string } | null; product?: { sku: string } | null;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const dataBR = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/** Texto do pedido para colar no WhatsApp ou no e-mail do fornecedor. */
export function textoPedido(p: {
  empresa: string; cnpj: string; numero: string; fornecedor: string; itens: PedidoItem[];
  frete: number; desconto: number; total: number; condicao?: string | null; entrega?: string | null;
  observacao?: string | null; comprador?: string | null;
}) {
  const linhas = p.itens.map((i) =>
    `${i.line_no}. ${i.description}${i.product?.sku ? ` (${i.product.sku})` : ""} — ${qtd(Number(i.quantity))} ${i.unit?.code ?? "UN"} × ${brl(Number(i.unit_price))} = ${brl(Number(i.total))}`);
  return [
    `*Pedido de compra ${p.numero}*`,
    `${p.empresa} · CNPJ ${p.cnpj}`,
    `Para: ${p.fornecedor}`,
    "",
    ...linhas,
    "",
    ...(Number(p.frete) > 0 ? [`Frete: ${brl(Number(p.frete))}`] : []),
    ...(Number(p.desconto) > 0 ? [`Desconto: ${brl(Number(p.desconto))}`] : []),
    `*Total: ${brl(Number(p.total))}*`,
    ...(p.condicao ? [`Pagamento: ${p.condicao}`] : []),
    ...(p.entrega ? [`Entrega até: ${dataBR(p.entrega)}`] : []),
    ...(p.observacao ? ["", p.observacao] : []),
    "",
    "Por favor, confirme o recebimento deste pedido e informe o número na nota fiscal.",
    ...(p.comprador ? [`${p.comprador}`] : []),
  ].join("\n");
}

export const SOLIC_STATUS: Record<string, { rot: string; cls: string }> = {
  rascunho: { rot: "Rascunho", cls: "bg-line-soft text-graphite" },
  enviada: { rot: "Aguardando o Compras", cls: "bg-warn-soft text-warn" },
  aprovada: { rot: "Aceita pelo Compras", cls: "bg-info-soft text-info" },
  em_cotacao: { rot: "Em cotação", cls: "bg-info-soft text-info" },
  concluida: { rot: "Virou pedido", cls: "bg-accent-soft text-accent-ink" },
  recusada: { rot: "Recusada", cls: "bg-danger-soft text-danger" },
  cancelada: { rot: "Cancelada", cls: "bg-line-soft text-muted" },
  aguardando_aprovacao: { rot: "Aguardando aprovação", cls: "bg-warn-soft text-warn" },
};

export const PRIORIDADE: Record<string, { rot: string; cls: string }> = {
  baixa: { rot: "Baixa", cls: "text-muted" },
  normal: { rot: "Normal", cls: "text-graphite" },
  alta: { rot: "Alta", cls: "text-warn" },
  urgente: { rot: "Urgente", cls: "text-danger font-semibold" },
};

export const SOLIC_FILTROS = [
  { valor: "abertas", rotulo: "Em aberto" },
  { valor: "enviada", rotulo: "Aguardando o Compras" },
  { valor: "em_cotacao", rotulo: "Em cotação" },
  { valor: "concluida", rotulo: "Viraram pedido" },
  { valor: "recusada", rotulo: "Recusadas" },
  { valor: "", rotulo: "Todas" },
] as const;

export const COT_STATUS: Record<string, { rot: string; cls: string }> = {
  aberta: { rot: "Aguardando respostas", cls: "bg-warn-soft text-warn" },
  respondida: { rot: "Todos responderam", cls: "bg-info-soft text-info" },
  encerrada: { rot: "Encerrada", cls: "bg-accent-soft text-accent-ink" },
  cancelada: { rot: "Cancelada", cls: "bg-line-soft text-muted" },
};

/** Pedido de cotação para colar no WhatsApp ou no e-mail do fornecedor. */
export function textoCotacao(p: {
  empresa: string; numero: string; fornecedor: string; prazo?: string | null; comprador?: string | null;
  linhas: { line_no: number; description: string; quantity: number; unit?: string | null }[];
}) {
  return [
    `*Pedido de cotação ${p.numero}* — ${p.empresa}`,
    `Olá, ${p.fornecedor}! Por favor, nos passe preço e prazo para:`,
    "",
    ...p.linhas.map((l) => `${l.line_no}. ${l.description} — ${qtd(Number(l.quantity))} ${l.unit ?? "UN"}`),
    "",
    "Informe também: frete, prazo de entrega, condição de pagamento e validade da proposta.",
    ...(p.prazo ? [`Responder até ${dataBR(p.prazo)}.`] : []),
    ...(p.comprador ? ["", p.comprador] : []),
  ].join("\n");
}
