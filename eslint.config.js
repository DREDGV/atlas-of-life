import importPlugin from "eslint-plugin-import";

export default [
  {
    ignores: [
      "js/hierarchy/**",
      "js/indexedDBAdapter.js",
      "js/storageAdapter.js",
      "js/types/**",
      "js/state_old.js",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        performance: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        Map: "readonly",
        Set: "readonly",
      },
    },
    plugins: {
      import: importPlugin,
    },
  },
];

