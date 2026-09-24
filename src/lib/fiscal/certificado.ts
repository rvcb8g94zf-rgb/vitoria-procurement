import "server-only";
import forge from "node-forge";

/**
 * Abre um certificado A1 (.pfx / .p12) em memória.
 *
 * Por que node-forge e não o `pfx` do próprio Node: o Node 17+ usa o
 * OpenSSL 3, que recusa PFX cifrado com RC2-40 — justamente o formato de
 * muitos A1 emitidos pelas ACs e exportados pelo Windows. O forge lê
 * esses arquivos e devolve chave e certificado em PEM, que o TLS aceita.
 *
 * Nada daqui é gravado em disco nem vai para log. A senha só existe na
 * memória da função durante a chamada.
 */
export interface CertificadoAberto {
  keyPem: string;
  certPem: string;
  /** Certificados intermediários que vieram dentro do .pfx. */
  cadeiaPem: string[];
  titular: string;
  cnpj: string | null;
  validoDe: Date;
  validoAte: Date;
}

export class ErroCertificado extends Error {
  constructor(public motivo: "senha" | "arquivo" | "sem_chave", mensagem: string) {
    super(mensagem);
  }
}

// OID ICP-Brasil do CNPJ da pessoa jurídica no subjectAltName (otherName)
const OID_CNPJ = "2.16.76.1.3.3";

function cnpjDoCertificado(cert: forge.pki.Certificate): string | null {
  // 1) padrão das ACs: "RAZAO SOCIAL:57492084000145" no CN
  const cn = String(cert.subject.getField("CN")?.value ?? "");
  const noCn = /:(\d{14})\b/.exec(cn);
  if (noCn) return noCn[1];

  // 2) otherName ICP-Brasil dentro do subjectAltName
  const ext = cert.getExtension("subjectAltName") as { value?: string } | null;
  if (ext?.value) {
    try {
      const asn = forge.asn1.fromDer(ext.value);
      const procurar = (no: forge.asn1.Asn1): string | null => {
        if (Array.isArray(no.value)) {
          for (let i = 0; i < no.value.length; i++) {
            const filho = no.value[i] as forge.asn1.Asn1;
            if (filho.type === forge.asn1.Type.OID &&
                forge.asn1.derToOid(filho.value as string) === OID_CNPJ) {
              const bruto = JSON.stringify(no.value[i + 1] ?? "");
              const d = /(\d{14})/.exec(bruto);
              if (d) return d[1];
            }
            const r = procurar(filho);
            if (r) return r;
          }
        }
        return null;
      };
      return procurar(asn);
    } catch {
      return null;
    }
  }
  return null;
}

export function abrirCertificado(pfx: Buffer, senha: string): CertificadoAberto {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn = forge.asn1.fromDer(pfx.toString("binary"));
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(asn, false, senha);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/MAC could not be verified|Invalid password|decrypt/i.test(msg)) {
        throw new ErroCertificado("senha", "A senha do certificado não confere.");
      }
      // alguns PFX usam MAC com a senha vazia e cifra com a senha real
      p12 = forge.pkcs12.pkcs12FromAsn1(asn, true, senha);
    }
  } catch (e) {
    if (e instanceof ErroCertificado) throw e;
    throw new ErroCertificado("arquivo", "O arquivo não é um certificado A1 (.pfx ou .p12) válido.");
  }

  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const chave = chaves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave) throw new ErroCertificado("sem_chave", "O arquivo não traz a chave privada. Exporte o certificado com a chave privada.");

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);

  // o certificado da empresa é o que tem a mesma chave pública da chave privada
  const pub = forge.pki.setRsaPublicKey(chave.n, chave.e);
  const pubPem = forge.pki.publicKeyToPem(pub);
  const folha = certs.find((c) => forge.pki.publicKeyToPem(c.publicKey as forge.pki.rsa.PublicKey) === pubPem);
  if (!folha) throw new ErroCertificado("arquivo", "Não encontrei o certificado correspondente à chave privada.");

  return {
    keyPem: forge.pki.privateKeyToPem(chave),
    certPem: forge.pki.certificateToPem(folha),
    cadeiaPem: certs.filter((c) => c !== folha).map((c) => forge.pki.certificateToPem(c)),
    titular: String(folha.subject.getField("CN")?.value ?? "").slice(0, 200),
    cnpj: cnpjDoCertificado(folha),
    validoDe: folha.validity.notBefore,
    validoAte: folha.validity.notAfter,
  };
}
