import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/templates/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // plan-doc template tokens (scoped under .plan-doc — never leak to dashboard)
        "plan-bg":       "var(--plan-bg)",
        "plan-navy":     "var(--plan-navy)",
        "plan-navy-dark":"var(--plan-navy-dark)",
        "plan-accent":   "var(--plan-accent)",
        "plan-muted":    "var(--plan-muted)",
        "plan-muted-fg": "var(--plan-muted-fg)",
        "plan-body":     "var(--plan-body)",
        "plan-heading":  "var(--plan-heading)",
        // StratOS surface hierarchy
        surface: {
          base: "#070911",
          "01":  "#0c0f1a",
          "02":  "#121626",
          "03":  "#1a2035",
        },
        // Sovereign Gold — sole interactive accent
        gold: {
          DEFAULT: "#b8922f",
          hover:   "#c9a84c",
          dim:     "rgba(184,146,47,0.12)",
          border:  "rgba(184,146,47,0.22)",
        },
        // StratOS semantic data colours (distinct from gold accent)
        strength: {
          DEFAULT: "#1aad74",
          dim:     "#05291b",
        },
        weakness: {
          DEFAULT: "#c07824",
          dim:     "#2c1a05",
        },
        opportunity: {
          DEFAULT: "#0ea0c0",
          dim:     "#032a32",
        },
        threat: {
          DEFAULT: "#d44452",
          dim:     "#2c0a0e",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-in-right": "slideInRight 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      boxShadow: {
        card:         "0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)",
        "card-hover": "0 4px 16px rgba(0,0,0,0.6)",
        "gold-sm":    "0 0 12px rgba(184,146,47,0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
