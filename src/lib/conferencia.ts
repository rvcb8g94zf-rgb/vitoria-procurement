/** Conferência pedido × nota × recebimento: rótulos e leitura das divergências. */

export const CONF_STATUS: Record<string, { rot: string; cls: string; dica: string }> = {
  divergente: {
    rot: "Pagamento retido", cls: "bg-danger-soft text-danger",
    dica: "A nota não bate com o pedido ou com o que chegou. Os títulos dela não podem ser baixados até a liberação.",
  },
  sem_pedido: {
    rot: "Sem pedido ligado", cls: "bg-warn-soft text-warn",
    dica: "Há pedido em aberto deste fornecedor. Ligue a nota ao pedido para conferir.",
  },
  aguardando_xml: {
    rot: "Aguardando XML", cls: "bg-line-soft text-graphite",
    dica: "Ligada ao pedido, mas os itens só chegam com o XML completo.",
  },
  liberada: {
    rot: "Liberada com divergência", cls: "bg-info-soft text-info",
    dica: "Havia divergência e alguém liberou o pagamento com motivo.",
  },
  conferida: {
    rot: "Conferida", cls: "bg-accent-soft text-accent-ink",
    dica: "Preço e quantidade batem com o pedido e com o que chegou.",
  },
  cancelada: { rot: "Nota cancelada", cls: "bg-line-soft text-graphite", dica: "" },
};

export const CONF_FILTROS = [
  { valor: "", rotulo: "Tudo" },
  { valor: "divergente", rotulo: "Retidas" },
  { valor: "sem_pedido", rotulo: "Sem pedido" },
  { valor: "aguardando_xml", rotulo: "Aguardando XML" },
  { valor: "liberada", rotulo: "Liberadas" },
  { valor: "conferida", rotulo: "Conferidas" },
] as const;

export const ORIGEM_LIGACAO: Record<string, string> = {
  recebimento: "pelo recebimento",
  xped: "pelo nº do pedido no XML",
  manual: "ligado à mão",
};

export const PAR_ORIGEM: Record<string, string> = {
  produto: "pelo produto",
  manual: "escolhido à mão",
  unico: "item único",
};

/** Texto curto de cada divergência de um item. */
export function textoProblema(chave: string): string {
  const tipo = chave.split(":")[0];
  switch (tipo) {
    case "preco": return "preço acima do pedido";
    case "recebido": return "faturado mais do que chegou";
    case "pedido": return "faturado mais do que o pedido";
    case "sem_par": return "item fora do pedido";
    case "cancelado": return "pedido cancelado";
    default: return chave;
  }
}

/** Resumo das divergências para o cabeçalho do card. */
export function resumoProblemas(chaves: string[]): string {
  const cont: Record<string, number> = {};
  for (const k of chaves) {
    const t = k.split(":")[0];
    cont[t] = (cont[t] ?? 0) + 1;
  }
  const partes: string[] = [];
  const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
  if (cont.preco) partes.push(plural(cont.preco, "item com preço acima do pedido", "itens com preço acima do pedido"));
  if (cont.recebido) partes.push(plural(cont.recebido, "item faturado a mais do que chegou", "itens faturados a mais do que chegou"));
  if (cont.pedido) partes.push(plural(cont.pedido, "item faturado a mais do que o pedido", "itens faturados a mais do que o pedido"));
  if (cont.sem_par) partes.push(plural(cont.sem_par, "item da nota fora do pedido", "itens da nota fora do pedido"));
  if (cont.cancelado) partes.push(plural(cont.cancelado, "pedido cancelado", "pedidos cancelados"));
  return partes.join(" · ");
}
