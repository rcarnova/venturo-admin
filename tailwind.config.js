/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: "#E1FF00",
        surface: "#111111",
        "surface-2": "#1A1A1A",
        "surface-3": "#222222",
        border: "rgba(255,255,255,0.07)",
        "border-hover": "rgba(255,255,255,0.15)",
        muted: "#666666",
        "muted-2": "#444444",
      },
      fontFamily: {
        sans: ["var(--font-grotesk)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
};
