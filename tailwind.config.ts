import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Poly & Bark palette — warm at neutral
        cream: "#FAF7F2",
        ink: "#1A1A1A",
        cognac: "#B87333",
        sand: "#E8DFD3",
        stone: "#6B6560",
        // Dark sections ng homepage
        olive: "#4A4123",
        espresso: "#33261C",
        linen: "#F6EFE7",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Helvetica", "Arial", "sans-serif"],
        // Serif ng Poly & Bark para sa headlines at logo
        cormorant: ["var(--font-cormorant)", "Georgia", "serif"],
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        fadeIn: "fadeIn 1.2s ease-in-out",
      },
      letterSpacing: {
        widest2: "0.2em",
      },
    },
  },
  plugins: [],
};

export default config;
