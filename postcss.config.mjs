// Colour fallbacks for old Chrome (Windows 7 machines in the clinic stop at
// Chrome 109): see postcss-legacy-colors.cjs. It must run after Tailwind.
// Passed as the plugin itself, not a name: Turbopack resolves plugin names
// from its own worker, where a path relative to this file would not resolve.
import legacyColors from "./postcss-legacy-colors.cjs";

const config = {
  plugins: ["@tailwindcss/postcss", legacyColors],
};

export default config;
