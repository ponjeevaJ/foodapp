/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17221c",
        leaf: "#237a52",
        lime: "#c5e86c",
        canvas: "#f5f7f2"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        soft: "0 18px 50px rgba(23, 34, 28, .08)"
      }
    }
  },
  plugins: []
};
