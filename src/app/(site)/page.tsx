import type { Metadata } from "next";
import {
  BrickWall, Check, Droplets, ExternalLink, Factory, Hammer, HardHat, Instagram,
  LayoutGrid, MapPin, MessageCircle, PaintRoller, Quote, ShoppingBag, Star, Wrench, Zap,
} from "lucide-react";
import "./site.css";

// Dados oficiais do negócio — não alterar sem confirmação da loja.
const WHATSAPP = "https://wa.me/551149945166";
const INSTAGRAM = "https://www.instagram.com/depositovitoria_higienopolis/";
const GOOGLE = "https://share.google/FzLOnTxQxALRWTScc";
const MAPS =
  "https://www.google.com/maps/search/?api=1&query=Av.%20Higien%C3%B3polis%2C%2046%20-%20Vila%20Gilda%2C%20Santo%20Andr%C3%A9%20-%20SP%2C%2009190-360";

const TITULO = "Depósito Vitória — Materiais de Construção em Higienópolis";
const DESCRICAO =
  "Depósito de materiais de construção em Higienópolis, Santo André. Av. Higienópolis, 46 - Vila Gilda. 65 anos de tradição, 3ª geração da família. Atendimento a clientes residenciais e a indústrias nacionais e multinacionais.";

// página estática, refeita uma vez por dia (mantém o ano do rodapé em dia)
export const revalidate = 86400;

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRICAO,
  openGraph: { type: "website", title: TITULO, description: DESCRICAO, locale: "pt_BR" },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRICAO },
};

const CATEGORIAS = [
  { Icone: BrickWall, nome: "Construção e alvenaria" },
  { Icone: Zap, nome: "Materiais elétricos" },
  { Icone: Droplets, nome: "Materiais hidráulicos" },
  { Icone: Hammer, nome: "Ferramentas" },
  { Icone: PaintRoller, nome: "Tintas e acabamento" },
  { Icone: LayoutGrid, nome: "Pisos e revestimentos" },
  { Icone: Wrench, nome: "Reparos e manutenção" },
  { Icone: Factory, nome: "Materiais para indústria" },
];

// Avaliações reais do Google, copiadas como estão.
const AVALIACOES = [
  { nome: "Marina Kanashiro Ramos", meta: "Local Guide · 336 avaliações · 5 meses atrás",
    texto: "Excelente opção na região em termos de opção, atendimento e preço. Se está meio perdido, quem te atende ajuda com instrução de como fazer o reparo e o que comprar. Lugar de anos que é um ponto de referência." },
  { nome: "Edvaldo Silva", meta: "Local Guide · 206 avaliações · 1 ano atrás",
    texto: "Excelente local para compras: localização, facilidade de estacionar, atendimento pessoal e preços bem atrativos. Nunca me decepciona na busca por materiais de construção, acabamento e reparos em geral." },
  { nome: "Walker", meta: "Local Guide · 66 avaliações · 3 anos atrás",
    texto: "Muito bom atendimento, os donos sempre estão na loja e são muito simpáticos, tem de tudo e um belo descontinho na hora de pagar. Indico a todos." },
  { nome: "Mario Mello", meta: "Local Guide · 232 avaliações · 7 anos atrás",
    texto: "Quando se está precisando de algo para a obra da sua casa, este é o local certo. Eles têm desde um simples fio até os tijolos. O atendimento é dez, a equipe está sempre disponível." },
  { nome: "Vagner Guarnieri", meta: "Local Guide · 214 avaliações · 6 anos atrás",
    texto: "Excelente atendimento, preços adequados, é um depósito grande por ser no bairro e a variedade de produtos é bem considerável. Indico sem sombra de dúvidas." },
  { nome: "Andre Paulucci", meta: "Local Guide · 70 avaliações · 5 meses atrás",
    texto: "Ótimo depósito com preços ótimos também. O atendente Armando, mais conhecido como Dinho, é sensacional." },
  { nome: "Miriam Alegreti", meta: "Local Guide · 91 avaliações · 7 anos atrás",
    texto: "Sempre fui apaixonada por ferramentas e peças e de como podemos arrumar pequenos problemas em casa, no escritório e até em trabalhos escolares." },
  { nome: "Adilson Roberto Simões de Carvalho", meta: "32 avaliações · 2 anos atrás",
    texto: "O atendimento pelos funcionários é nota 10. São atenciosos e prontos para nos orientar em qualquer situação de compra." },
];

const DIFERENCIAIS = [
  "Orientação completa: o que comprar e como fazer o reparo",
  "Grande variedade de produtos e preços atrativos",
  "Facilidade para estacionar",
  "Atendimento pessoal, dos proprietários à equipe",
];

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

function Marca() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/site/logo.png" alt="Logo Depósito Vitória" width={44} height={44} />
      <div><b>Depósito Vitória</b><small>MATERIAIS DE CONSTRUÇÃO</small></div>
    </>
  );
}

export default function SitePage() {
  const ano = new Date().getFullYear();
  return (
    <div className="dv">
      <div className="topbar"><div className="wrap">
        <span className="hide-sm">Há 65 anos em Higienópolis · 3ª geração da família</span>
        <a href={INSTAGRAM} {...ext}><Instagram className="i" /> @depositovitoria_higienopolis</a>
      </div></div>

      <header><div className="wrap">
        <a className="brand" href="#topo" aria-label="Depósito Vitória — início"><Marca /></a>
        <nav aria-label="Principal">
          <a href="#a-loja">A loja</a><a href="#produtos">Produtos</a>
          <a href="#avaliacoes">Avaliações</a><a href="#contato">Contato</a>
        </nav>
        <a className="btn btn-navy btn-sm" href={GOOGLE} {...ext}>Ver no Google <ExternalLink className="i" /></a>
      </div></header>

      <main id="topo">
        <section className="hero">
          <div className="bg" role="img" aria-label="Interior da loja com corredores de prateleiras" />
          <div className="wrap">
            <span className="badge"><HardHat className="i" /> 65 anos · 3ª geração da família</span>
            <h1>Tudo para a sua obra, com o atendimento de quem entende.</h1>
            <p>
              Depósito de materiais de construção em Higienópolis. Do simples fio aos tijolos, orientamos
              você do orçamento ao reparo — em casa, na obra ou na indústria.
            </p>
            <div className="ctas">
              <a className="btn btn-white" href={WHATSAPP} {...ext}><MessageCircle className="i" /> Chamar no WhatsApp</a>
              <a className="btn btn-ghost" href={GOOGLE} {...ext}><Star className="i" /> Ver avaliações no Google</a>
            </div>
            <div className="soon"><span><ShoppingBag className="i" /> Em breve: loja online</span></div>
          </div>
        </section>

        <div className="numbers"><div className="wrap">
          <div className="num"><b>65</b><span>anos de tradição</span></div>
          <div className="num"><b>3ª</b><span>geração da família</span></div>
          <div className="num"><b>100%</b><span>atendimento personalizado</span></div>
        </div></div>

        <section className="s" id="a-loja"><div className="wrap about">
          <div>
            <div className="eyebrow">A LOJA</div>
            <h2>Um ponto de referência no bairro, administrado pela família.</h2>
            <p>
              Somos um depósito de materiais de construção familiar, hoje na 3ª geração. São 65 anos na
              área — e os donos continuam presentes na loja todos os dias, como sempre estiveram.
            </p>
            <p>
              Atendemos clientes do bairro e das redondezas, além de <strong>indústrias nacionais e
              multinacionais</strong>. Quem chega meio perdido sai com o material certo e a instrução de como
              fazer o reparo — é o que nossos clientes contam nas avaliações.
            </p>
            <ul className="checks">
              {DIFERENCIAIS.map((d) => (
                <li key={d}><span className="ck"><Check className="i" /></span>{d}</li>
              ))}
            </ul>
          </div>
          <div className="photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/site/atendimento.jpg" alt="Atendente orientando cliente no balcão da loja"
                 width={900} height={900} loading="lazy" />
            <div className="float"><b>65</b><span>ANOS DE HISTÓRIA</span></div>
          </div>
        </div></section>

        <section className="s products" id="produtos"><div className="wrap">
          <div className="eyebrow">PRODUTOS</div>
          <h2>Do simples fio aos tijolos</h2>
          <p className="lead">
            Variedade considerável para a obra da sua casa, o reparo do dia a dia e o abastecimento da sua indústria.
          </p>
          <div className="grid4">
            {CATEGORIAS.map(({ Icone, nome }) => (
              <div key={nome} className="card cat"><div className="ic"><Icone className="i" /></div><h3>{nome}</h3></div>
            ))}
          </div>
        </div></section>

        <section className="s reviews" id="avaliacoes"><div className="wrap">
          <div className="rev-head">
            <div><div className="eyebrow">AVALIAÇÕES</div><h2>O que dizem nossos clientes no Google</h2></div>
            <a className="btn btn-navy" href={GOOGLE} {...ext}>Ver todas no Google <ExternalLink className="i" /></a>
          </div>
          <div className="revs">
            {AVALIACOES.map((a) => (
              <article key={a.nome} className="card rev">
                <div className="stars" aria-label="5 de 5 estrelas">
                  {[0, 1, 2, 3, 4].map((n) => <Star key={n} className="i" />)}
                </div>
                <div className="q"><Quote className="i" /></div>
                <p>{a.texto}</p>
                <footer><b>{a.nome}</b><span>{a.meta}</span></footer>
              </article>
            ))}
          </div>
        </div></section>

        <section className="insta"><div className="wrap">
          <div className="ig"><Instagram className="i" /></div>
          <h2>Acompanhe novidades e dicas no nosso Instagram</h2>
          <a className="btn btn-white" href={INSTAGRAM} {...ext}>@depositovitoria_higienopolis</a>
        </div></section>
      </main>

      <footer className="foot" id="contato"><div className="wrap">
        <div className="cols">
          <div>
            <div className="brand"><Marca /></div>
            <p>Depósito de materiais de construção familiar, há 65 anos em Higienópolis.</p>
          </div>
          <div>
            <h4>ONDE ESTAMOS</h4>
            <a className="lk" href={MAPS} {...ext}>
              <MapPin className="i" /><span>Av. Higienópolis, 46 - Vila Gilda<br />Santo André - SP, 09190-360</span>
            </a>
            <p className="note">Ver no Google Maps · facilidade para estacionar</p>
          </div>
          <div>
            <h4>FALE COM A GENTE</h4>
            <a className="lk" href={WHATSAPP} {...ext}><MessageCircle className="i" /><span>WhatsApp (11) 4994-5166</span></a>
            <a className="lk" href={INSTAGRAM} {...ext}><Instagram className="i" /><span>Instagram</span></a>
          </div>
        </div>
        <div className="bottom">
          <span>© {ano} Depósito Vitória · Materiais de construção</span>
          <span>65 anos · 3ª geração da família · Higienópolis, Santo André - SP</span>
        </div>
      </div></footer>
    </div>
  );
}
