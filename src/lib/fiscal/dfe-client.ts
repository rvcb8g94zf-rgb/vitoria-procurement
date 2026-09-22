import "server-only";
import https from "node:https";
import { gunzipSync } from "node:zlib";

/**
 * Cliente do NFeDistribuicaoDFe (Ambiente Nacional).
 *
 * Usa TLS mútuo: o certificado A1 da empresa autentica a chamada. Por
 * isso este arquivo só roda no runtime Node — Edge não expõe o módulo
 * https com suporte a pfx.
 *
 * ATENÇÃO: endpoints, versão do schema e comportamento precisam ser
 * conferidos contra a NT 2014.002 vigente antes de usar em produção.
 */
const ENDPOINTS = {
  producao: "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
  homologacao: "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
} as const;

export type Environment = keyof typeof ENDPOINTS;

export interface DistDFeResult {
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  /** Documentos já descompactados (docZip vem gzip + base64). */
  docs: { nsu: string; schema: string; xml: string }[];
}

function envelope(uf: number, ambiente: Environment, cnpj: string, ultNSU: string) {
  const tpAmb = ambiente === "producao" ? 1 : 2;
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${uf}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU><ultNSU>${ultNSU.padStart(15, "0")}</ultNSU></distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

const pick = (xml: string, tag: string) =>
  new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1]?.trim() ?? "";

export async function consultarDistribuicao(opts: {
  environment: Environment;
  cnpj: string;
  ufCode: number;
  ultNSU: string;
  pfx: Buffer;
  passphrase: string;
  timeoutMs?: number;
}): Promise<DistDFeResult> {
  const body = envelope(opts.ufCode, opts.environment, opts.cnpj, opts.ultNSU);
  const url = new URL(ENDPOINTS[opts.environment]);

  const raw: string = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: url.host,
        path: url.pathname,
        method: "POST",
        pfx: opts.pfx,
        passphrase: opts.passphrase,
        // Alguns servidores da SEFAZ ainda negociam suítes antigas; se a
        // conexão falhar com handshake, é aqui que se afrouxa — nunca
        // desligando a verificação do certificado do servidor.
        minVersion: "TLSv1.2",
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: opts.timeoutMs ?? 25000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado na SEFAZ")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const docs: DistDFeResult["docs"] = [];
  const re = /<docZip[^>]*NSU="(\d+)"[^>]*schema="([^"]+)"[^>]*>([\s\S]*?)<\/docZip>/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    try {
      docs.push({
        nsu: m[1],
        schema: m[2],
        xml: gunzipSync(Buffer.from(m[3], "base64")).toString("utf8"),
      });
    } catch {
      // documento corrompido não pode derrubar o lote inteiro
    }
  }

  return {
    cStat: pick(raw, "cStat"),
    xMotivo: pick(raw, "xMotivo"),
    ultNSU: pick(raw, "ultNSU"),
    maxNSU: pick(raw, "maxNSU"),
    docs,
  };
}
