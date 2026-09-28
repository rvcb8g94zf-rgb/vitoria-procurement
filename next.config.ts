import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: true,
  // O sistema passou para /interno; endereços antigos salvos nos favoritos
  // continuam funcionando.
  async redirects() {
    const antigas = ["login", "trocar-senha", "sem-empresa", "sem-permissao",
                     "notas", "cadastros", "financeiro", "relatorios", "admin"];
    return antigas.flatMap((r) => [
      { source: `/${r}`, destination: `/interno/${r}`, permanent: false },
      { source: `/${r}/:resto*`, destination: `/interno/${r}/:resto*`, permanent: false },
    ]);
  },
};

export default config;
