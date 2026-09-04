import type { Config } from "tailwindcss";

// Tokens espelhados de globals.css. Fonte da verdade: as CSS variables,
// para que o modo escuro troque valores sem recompilar classe nenhuma.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        graphite: "var(--graphite)",
        muted: "var(--muted)",
        line: "var(--line)",
        "line-soft": "var(--line-soft)",
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        raise: "var(--raise)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        warn: "var(--warn)",
        "warn-soft": "var(--warn-soft)",
        danger: "var(--danger)",
        "danger-soft": "var(--danger-soft)",
        info: "var(--info)",
        "info-soft": "var(--info-soft)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Archivo", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      borderRadius: { DEFAULT: "8px", sm: "6px" },
    },
  },
  plugins: [],
};

export default config;
