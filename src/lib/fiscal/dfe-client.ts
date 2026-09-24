import "server-only";
import https from "node:https";
import tls from "node:tls";
import { gunzipSync } from "node:zlib";

/**
 * Cliente do NFeDistribuicaoDFe (Ambiente Nacional), NT 2014.002.
 *
 * TLS mútuo: o certificado A1 da empresa autentica a chamada. O
 * certificado do SERVIDOR é sempre verificado — nunca se desliga isso
 * (rejectUnauthorized: false deixaria qualquer um no meio do caminho se
 * passar pela SEFAZ e receber o certificado da empresa).
 *
 * O Ambiente Nacional usa certificado de autoridade comercial e passa
 * pela lista padrão do Node. Se um dia exigir a raiz da ICP-Brasil, basta
 * colocar os PEMs na variável ICP_BRASIL_CA_PEM: eles são SOMADOS à lista
 * padrão, nunca a substituem.
 */
const ENDPOINTS = {
  producao: "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
  homologacao: "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
} as const;
const ACTION = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";

export type Environment = keyof typeof ENDPOINTS;

export interface DistDFeResult {
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  /** Documentos já descompactados (docZip vem em gzip + base64). */
  docs: { nsu: string; schema: string; xml: string }[];
  /** docZip que não abriram — contados, nunca derrubam o lote. */
  ilegiveis: number;
}

export class ErroSefaz extends Error {
  constructor(public tipo: "tls" | "rede" | "http" | "soap" | "resposta", mensagem: string) {
    super(mensagem);
  }
}

function envelope(uf: number, ambiente: Environment, cnpj: string, ultNSU: string) {
  const tpAmb = ambiente === "producao" ? 1 : 2;
  const nsu = ultNSU.replace(/\D/g, "").padStart(15, "0").slice(-15);
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
    `<nfeDadosMsg>` +
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${tpAmb}</tpAmb><cUFAutor>${uf}</cUFAutor><CNPJ>${cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${nsu}</ultNSU></distNSU>` +
    `</distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
}

const pick = (xml: string, tag: string) =>
  new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tag}>`).exec(xml)?.[1]?.trim() ?? "";

function autoridades(): string[] | undefined {
  const extra = process.env.ICP_BRASIL_CA_PEM;
  if (!extra) return undefined; // lista padrão do Node
  const pems = extra.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  return [...tls.rootCertificates, ...pems];
}

/** Lê a resposta do serviço. Exportado para os testes. */
export function lerResposta(raw: string): DistDFeResult {
  if (/<(?:[A-Za-z0-9_]+:)?Fault[\s>]/.test(raw)) {
    const motivo = pick(raw, "Text") || pick(raw, "faultstring") || "falha SOAP";
    throw new ErroSefaz("soap", `A SEFAZ recusou a chamada: ${motivo.slice(0, 200)}`);
  }
  const cStat = pick(raw, "cStat");
  if (!cStat) throw new ErroSefaz("resposta", "Resposta da SEFAZ sem código de status.");

  const docs: DistDFeResult["docs"] = [];
  let ilegiveis = 0;
  const re = /<(?:[A-Za-z0-9_]+:)?docZip\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?docZip>/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const nsu = /\bNSU="(\d+)"/.exec(m[1])?.[1];
    const schema = /\bschema="([^"]+)"/.exec(m[1])?.[1];
    if (!nsu || !schema) { ilegiveis += 1; continue; }
    try {
      docs.push({ nsu, schema, xml: gunzipSync(Buffer.from(m[2].trim(), "base64")).toString("utf8") });
    } catch {
      ilegiveis += 1;
    }
  }

  return { cStat, xMotivo: pick(raw, "xMotivo"), ultNSU: pick(raw, "ultNSU"), maxNSU: pick(raw, "maxNSU"), docs, ilegiveis };
}

export async function consultarDistribuicao(opts: {
  environment: Environment;
  cnpj: string;
  ufCode: number;
  ultNSU: string;
  keyPem: string;
  certPem: string;
  cadeiaPem?: string[];
  timeoutMs?: number;
  /** Só para teste local: outro endereço no lugar do da SEFAZ. */
  endpoint?: string;
}): Promise<DistDFeResult> {
  const body = envelope(opts.ufCode, opts.environment, opts.cnpj, opts.ultNSU);
  // DFE_ENDPOINT_TESTE só vale fora de produção (SEFAZ simulada nos testes)
  const teste = process.env.NODE_ENV !== "production" ? process.env.DFE_ENDPOINT_TESTE : undefined;
  const url = new URL(opts.endpoint ?? teste ?? ENDPOINTS[opts.environment]);

  const raw: string = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        key: opts.keyPem,
        // certificado da empresa + intermediários que vieram no .pfx
        cert: [opts.certPem, ...(opts.cadeiaPem ?? [])].join("\n"),
        ca: autoridades(),
        minVersion: "TLSv1.2",
        headers: {
          "Content-Type": `application/soap+xml; charset=utf-8; action="${ACTION}"`,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: opts.timeoutMs ?? 25000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const texto = Buffer.concat(chunks).toString("utf8");
          // SOAP 1.2 devolve falha com 500 e corpo Fault: deixa o leitor tratar
          if ((res.statusCode ?? 0) >= 400 && !/Fault/.test(texto)) {
            reject(new ErroSefaz("http", `A SEFAZ respondeu HTTP ${res.statusCode}.`));
          } else {
            resolve(texto);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new ErroSefaz("rede", "A SEFAZ não respondeu a tempo.")));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e instanceof ErroSefaz) return reject(e);
      const codigo = e.code ?? "";
      if (/CERT|SELF_SIGNED|UNABLE_TO|ERR_TLS|SSL/i.test(codigo) || /certificate|handshake|alert/i.test(e.message)) {
        reject(new ErroSefaz("tls", `Falha na conexão segura com a SEFAZ (${codigo || e.message}).`));
      } else {
        reject(new ErroSefaz("rede", `Não foi possível falar com a SEFAZ (${codigo || e.message}).`));
      }
    });
    req.write(body);
    req.end();
  });

  return lerResposta(raw);
}
