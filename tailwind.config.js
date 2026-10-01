/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: "#151515",
        raised: "#1b1916",
        line: "#2c261d",
        cream: "#fef1e8",
        taupe: "#988575",
        gold: "#d69900",
        bull: "#8aa860",
        bear: "#c1563b",
        border: "#2c261d",
        background: "#151515",
        foreground: "#fef1e8",
        muted: { DEFAULT: "#1b1916", foreground: "#988575" },
        accent: { DEFAULT: "#d69900", foreground: "#151515" },
        card: { DEFAULT: "#1b1916", foreground: "#fef1e8" },
        popover: { DEFAULT: "#1b1916", foreground: "#fef1e8" },
        primary: { DEFAULT: "#d69900", foreground: "#151515" },
        secondary: { DEFAULT: "#1b1916", foreground: "#fef1e8" },
        destructive: { DEFAULT: "#c1563b", foreground: "#fef1e8" },
        input: "#2c261d",
        ring: "#d69900",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xl: "2px",
        lg: "2px",
        md: "2px",
        sm: "2px",
        xs: "2px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
