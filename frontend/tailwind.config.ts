import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./providers/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#202124",
        muted: "#6B7280",
        line: "#E1E5EA",
        canvas: "#F6F7F9",
        panel: "#FFFFFF",
        mint: "#2D8CFF",
        "mint-dark": "#1769D1",
        coral: "#E5484D",
        sun: "#F5B544",
        sky: "#E8F2FF",
        lilac: "#EEEAFE",
      },
      opacity: {
        6: "0.06",
        8: "0.08",
        12: "0.12",
        15: "0.15",
        35: "0.35",
        45: "0.45",
        65: "0.65",
      },
      boxShadow: {
        soft: "0 18px 50px rgba(32, 33, 36, 0.10)",
        card: "0 4px 18px rgba(32, 33, 36, 0.07)",
        float: "0 24px 70px rgba(32, 33, 36, 0.14)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      keyframes: {
        "float-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "float-in": "float-in 350ms ease-out both",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
