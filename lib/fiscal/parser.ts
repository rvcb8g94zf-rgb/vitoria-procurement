import "server-only";

/**
 * Extração dos campos que interessam de resNFe e procNFe.
 *
 * O XML vem de terceiros: tratado como entrada não confiável. Sem
 * entidades externas, sem eval, sem montar HTML. As regexes abaixo
 * leem campos escalares conhecidos e ignoram o que não reconhecem.
 */

const strip = (t: string) => t.replace(/^[a-zA-Z0-9]+:/, "");
const get = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
};
const num = (v: string | null) => (v === null || v === "" ? null : Number(v));

/** "SEM GTIN" e variações não são EAN. Vira null, nunca texto. */
export function limparEan(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return /^\d{8}$|^\d{12,14}$/.test(d) ? d : null;
}

export interface Duplicata { seq: number; number: string | null; dueDate: string | null; amount: number | null }

export interface NotaExtraida {
  accessKey: string;
  kind: "resumo" | "completo";
  emitterCnpj: string | null;
  emitterName: string | null;
  emitterIe: string | null;
  number: string | null;
  series: string | null;
  issuedAt: string | null;
  totalAmount: number | null;
  protocol: string | null;
  itemCount: number | null;
  destCnpj: string | null;
  duplicates: Duplicata[] | null;   // null = desconhecido (resumo)
}

export function extrair(xml: string, schema: string): NotaExtraida | null {
  const tipo = strip(schema).toLowerCase();

  if (tipo.startsWith("resnfe")) {
    const chave = get(xml, "chNFe");
    if (!chave) return null;
    return {
      accessKey: chave,
      kind: "resumo",
      emitterCnpj: get(xml, "CNPJ"),
      emitterName: get(xml, "xNome"),
      emitterIe: get(xml, "IE"),
      number: null,
      series: null,
      issuedAt: get(xml, "dhEmi"),
      totalAmount: num(get(xml, "vNF")),
      protocol: get(xml, "nProt"),
      itemCount: null,
      destCnpj: null,
      // Resumo não traz duplicatas. null significa "não sabemos ainda",
      // que é diferente de "a nota não informa duplicatas".
      duplicates: null,
    };
  }

  if (!tipo.startsWith("procnfe")) return null;

  const chave = /<infNFe[^>]*Id="NFe(\d{44})"/.exec(xml)?.[1];
  if (!chave) return null;

  const emit = get(xml, "emit") ?? "";
  const dest = get(xml, "dest") ?? "";
  const ide = get(xml, "ide") ?? "";
  const tot = get(xml, "ICMSTot") ?? "";
  const cobr = get(xml, "cobr");

  let duplicates: Duplicata[] = [];
  if (cobr) {
    const re = /<(?:[a-zA-Z0-9]+:)?dup[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?dup>/g;
    let seq = 0;
    for (let m = re.exec(cobr); m; m = re.exec(cobr)) {
      seq += 1;
      duplicates.push({
        seq,
        number: get(m[1], "nDup"),
        dueDate: get(m[1], "dVenc"),
        amount: num(get(m[1], "vDup")),
      });
    }
  }

  return {
    accessKey: chave,
    kind: "completo",
    emitterCnpj: get(emit, "CNPJ"),
    emitterName: get(emit, "xNome"),
    emitterIe: get(emit, "IE"),
    number: get(ide, "nNF"),
    series: get(ide, "serie"),
    issuedAt: get(ide, "dhEmi"),
    totalAmount: num(get(tot, "vNF")),
    protocol: get(xml, "nProt"),
    itemCount: (xml.match(/<(?:[a-zA-Z0-9]+:)?det\s/g) ?? []).length || null,
    destCnpj: get(dest, "CNPJ"),
    // XML completo sem <cobr> é uma afirmação: a nota não informa
    // duplicatas. Não é o mesmo que "ainda não sabemos".
    duplicates,
  };
}

/** tpEvento 110111 é cancelamento. */
export function extrairEvento(xml: string) {
  const chave = get(xml, "chNFe");
  if (!chave) return null;
  return {
    accessKey: chave,
    eventType: get(xml, "tpEvento") ?? "",
    sequence: Number(get(xml, "nSeqEvento") ?? "1"),
    occurredAt: get(xml, "dhEvento"),
    description: get(xml, "xEvento") ?? get(xml, "descEvento"),
  };
}
