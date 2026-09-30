/** Eventos de manifestação do destinatário: nomes e explicações das telas. */

export const EVENTOS = {
  "210210": {
    nome: "Ciência da Operação",
    curto: "Dar ciência",
    explica: "Registra que a empresa tem conhecimento da nota. Não é a manifestação final: serve para a SEFAZ liberar o XML completo, que chega na próxima consulta.",
  },
  "210200": {
    nome: "Confirmação da Operação",
    curto: "Confirmar operação",
    explica: "Declara que a operação aconteceu e a mercadoria foi recebida conforme a nota. Use depois de conferir o recebimento.",
  },
  "210220": {
    nome: "Desconhecimento da Operação",
    curto: "Desconhecer",
    explica: "Declara que a empresa não reconhece esta operação — a nota foi emitida contra o CNPJ sem que houvesse a compra.",
  },
  "210240": {
    nome: "Operação não Realizada",
    curto: "Operação não realizada",
    explica: "A operação era conhecida, mas não aconteceu (por exemplo, mercadoria recusada na entrega). Exige justificativa.",
  },
} as const;

export type TipoEvento = keyof typeof EVENTOS;
