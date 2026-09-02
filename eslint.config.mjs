import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs, so they are spread directly
// rather than going through the eslintrc compatibility layer.
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "coverage/**",
      "tests/.tmp/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Non-null assertions are acceptable in tests, where the surrounding
      // assertions already establish the invariant.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];

export default config;
