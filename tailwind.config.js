/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        wellflix: {
          black: "#0a0a0b",
          dark: "#111113",
          card: "#18181b",
          muted: "#27272a",
          border: "#2a2a2e",
          white: "#fafaf9",
          paper: "#ffffff",
          accent: "#5b5cf6",
          accentHover: "#4f46e5",
          zinc: "#71717a",
          maxPurple: "#5a3fe3",
        },
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "Helvetica Neue", "Arial", "sans-serif"],
        display: ["Instrument Sans", "Inter", "sans-serif"],
      },
      boxShadow: {
        matte: "0 0 0 1px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)",
        matteDark: "0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.4)",
        hero: "0 20px 80px rgba(0,0,0,0.5)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
        "scale-in": "scaleIn 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        scaleIn: {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
