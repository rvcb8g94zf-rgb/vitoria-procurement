import "server-only";
import { createHash, createSign } from "node:crypto";
import { ErroSefaz, pick, postSoap, type Environment } from "./dfe-client";

/**
 * Manifestação do Destinatário — NFeRecepcaoEvento4 do Ambiente Nacional
 * (NT 2020.001). Monta o envEvento, assina cada infEvento com o A1 da
 * empresa (XMLDSig, RSA-SHA1, C14N) e lê o retEnvEvento.
 *
 * A assinatura é feita sobre o XML que o próprio código monta, sem
 * espaços nem quebras, por isso a forma canônica é conhecida: é o mesmo
 * texto com a declaração de namespace herdada no elemento assinado.
 */
const ENDPOINTS = {
  producao: "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
  homologacao: "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
} as const;
const ACTION = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento";
const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
const NS_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4";
const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const COD_AN = 91; // Ambiente Nacional

export type TipoManifestacao = "210210" | "210200" | "210220" | "210240";

export const DESC_EVENTO: Record<TipoManifestacao, string> = {
  "210210": "Ciencia da Operacao",
  "210200": "Confirmacao da Operacao",
  "210220": "Desconhecimento da Operacao",
  "210240": "Operacao nao Realizada",
};

export interface PedidoEvento {
  chave: string;
  tipo: TipoManifestacao;
  seq: number;
  justificativa?: string | null;
}

export interface RetornoEvento {
  chave: string;
  tipo: string;
  seq: number;
  cStat: string;
  xMotivo: string;
  protocolo: string | null;
  registradoEm: string | null;
  /** evento assinado + retorno, no formato procEventoNFe */
  xml: string | null;
}

export interface RetornoLote {
  cStat: string;
  xMotivo: string;
  eventos: RetornoEvento[];
}

/** Texto dentro de elemento, no mesmo escape da forma canônica. */
export function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
}

/** Justificativa aceita pelo schema: texto simples, sem quebras, 15–255. */
export function limparJustificativa(v: string): string {
  return v
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}

/** dhEvento no horário de Brasília, AAAA-MM-DDThh:mm:ss-03:00. */
export function dhEvento(agora = new Date()): string {
  // um minuto para trás: relógio do servidor um pouco à frente do da SEFAZ
  // geraria rejeição "data do evento maior que a de processamento"
  const d = new Date(agora.getTime() - 60_000);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-03:00`;
}

const corpoPem = (pem: string) => pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");

/** Monta e assina um <evento>. Exportado para os testes. */
export function eventoAssinado(opts: {
  pedido: PedidoEvento; ambiente: Environment; cnpj: string; keyPem: string; certPem: string; quando?: string;
}): string {
  const { pedido } = opts;
  if (!/^\d{44}$/.test(pedido.chave)) throw new Error("Chave de acesso inválida.");
  if (!/^\d{14}$/.test(opts.cnpj)) throw new Error("CNPJ da empresa inválido.");
  const seq = Math.max(1, Math.min(20, Math.trunc(pedido.seq)));
  const id = `ID${pedido.tipo}${pedido.chave}${String(seq).padStart(2, "0")}`;
  const tpAmb = opts.ambiente === "producao" ? 1 : 2;

  let det = `<descEvento>${DESC_EVENTO[pedido.tipo]}</descEvento>`;
  if (pedido.tipo === "210240") {
    const just = limparJustificativa(pedido.justificativa ?? "");
    if (just.length < 15) throw new Error("Operação não Realizada exige justificativa de 15 a 255 caracteres.");
    det += `<xJust>${esc(just)}</xJust>`;
  }

  const filhos =
    `<cOrgao>${COD_AN}</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${opts.cnpj}</CNPJ><chNFe>${pedido.chave}</chNFe>` +
    `<dhEvento>${opts.quando ?? dhEvento()}</dhEvento><tpEvento>${pedido.tipo}</tpEvento>` +
    `<nSeqEvento>${seq}</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">${det}</detEvento>`;

  // forma canônica do elemento assinado: herda o xmlns de <evento>
  const infCanonico = `<infEvento xmlns="${NS_NFE}" Id="${id}">${filhos}</infEvento>`;
  const digest = createHash("sha1").update(infCanonico, "utf8").digest("base64");

  const signedInfoInterno =
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${NS_DSIG}rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="${NS_DSIG}enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform>` +
    `</Transforms><DigestMethod Algorithm="${NS_DSIG}sha1"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference>`;
  const signedInfoCanonico = `<SignedInfo xmlns="${NS_DSIG}">${signedInfoInterno}</SignedInfo>`;
  const assinatura = createSign("RSA-SHA1").update(signedInfoCanonico, "utf8").sign(opts.keyPem, "base64");

  return (
    `<evento xmlns="${NS_NFE}" versao="1.00">` +
    `<infEvento Id="${id}">${filhos}</infEvento>` +
    `<Signature xmlns="${NS_DSIG}"><SignedInfo>${signedInfoInterno}</SignedInfo>` +
    `<SignatureValue>${assinatura}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${corpoPem(opts.certPem)}</X509Certificate></X509Data></KeyInfo>` +
    `</Signature></evento>`
  );
}

/** Lê o retEnvEvento. Exportado para os testes. */
export function lerRetornoEvento(raw: string, enviados: Map<string, string>): RetornoLote {
  if (/<(?:[A-Za-z0-9_]+:)?Fault[\s>]/.test(raw)) {
    const motivo = pick(raw, "Text") || pick(raw, "faultstring") || "falha SOAP";
    throw new ErroSefaz("soap", `A SEFAZ recusou a chamada: ${motivo.slice(0, 200)}`);
  }
  const ret = /<(?:[A-Za-z0-9_]+:)?retEnvEvento\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?retEnvEvento>/.exec(raw)?.[0];
  if (!ret) throw new ErroSefaz("resposta", "Resposta da SEFAZ sem retorno do lote de eventos.");
  const cabecalho = ret.replace(/<(?:[A-Za-z0-9_]+:)?retEvento\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?retEvento>/g, "");

  const eventos: RetornoEvento[] = [];
  const re = /<(?:[A-Za-z0-9_]+:)?retEvento\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?retEvento>/g;
  for (let m = re.exec(ret); m; m = re.exec(ret)) {
    const bloco = m[0];
    const chave = pick(bloco, "chNFe");
    const tipo = pick(bloco, "tpEvento");
    const seq = Number(pick(bloco, "nSeqEvento") || "1");
    const cStat = pick(bloco, "cStat");
    const enviado = enviados.get(`${chave}|${tipo}|${seq}`) ?? null;
    const registrado = ["135", "136"].includes(cStat);
    // retEvento vem com o prefixo/namespace da resposta; no procEventoNFe fica no namespace da NF-e
    const retLimpo = bloco
      .replace(/<(\/?)[A-Za-z0-9_]+:/g, "<$1")
      .replace(/\sxmlns(:[A-Za-z0-9_]+)?="[^"]*"/g, "")
      .replace(/^<retEvento\b/, `<retEvento xmlns="${NS_NFE}"`);
    eventos.push({
      chave, tipo, seq, cStat,
      xMotivo: pick(bloco, "xMotivo"),
      protocolo: pick(bloco, "nProt") || null,
      registradoEm: pick(bloco, "dhRegEvento") || null,
      xml: registrado && enviado
        ? `<procEventoNFe xmlns="${NS_NFE}" versao="1.00">${enviado}${retLimpo}</procEventoNFe>`
        : enviado,
    });
  }
  return { cStat: pick(cabecalho, "cStat"), xMotivo: pick(cabecalho, "xMotivo"), eventos };
}

/** Envia um lote (até 20 eventos) ao Ambiente Nacional. */
export async function enviarManifestacoes(opts: {
  ambiente: Environment; cnpj: string; pedidos: PedidoEvento[];
  keyPem: string; certPem: string; cadeiaPem?: string[]; timeoutMs?: number;
}): Promise<RetornoLote> {
  if (opts.pedidos.length === 0 || opts.pedidos.length > 20) throw new Error("O lote precisa ter de 1 a 20 eventos.");
  const quando = dhEvento();
  const enviados = new Map<string, string>();
  const eventos = opts.pedidos.map((p) => {
    const xml = eventoAssinado({ pedido: p, ambiente: opts.ambiente, cnpj: opts.cnpj, keyPem: opts.keyPem, certPem: opts.certPem, quando });
    enviados.set(`${p.chave}|${p.tipo}|${Math.trunc(p.seq)}`, xml);
    return xml;
  });
  const idLote = String(Date.now()).slice(-15);
  const envEvento = `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>${idLote}</idLote>${eventos.join("")}</envEvento>`;
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDadosMsg xmlns="${NS_WSDL}">${envEvento}</nfeDadosMsg>` +
    `</soap12:Body></soap12:Envelope>`;

  // EVENTO_ENDPOINT_TESTE só vale fora de produção (SEFAZ simulada nos testes)
  const teste = process.env.NODE_ENV !== "production" ? process.env.EVENTO_ENDPOINT_TESTE : undefined;
  const raw = await postSoap({
    url: new URL(teste ?? ENDPOINTS[opts.ambiente]), action: ACTION, body,
    keyPem: opts.keyPem, certPem: opts.certPem, cadeiaPem: opts.cadeiaPem, timeoutMs: opts.timeoutMs ?? 25_000,
  });
  return lerRetornoEvento(raw, enviados);
}
