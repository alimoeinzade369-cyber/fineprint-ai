import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: { colors: { ink: "#111827", paper: "#f8fafc", brand: "#6d5dfc" }, boxShadow: { soft: "0 18px 50px rgba(15,23,42,.08)" } } },
  plugins: []
} satisfies Config;