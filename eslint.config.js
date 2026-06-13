import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Flat-config ESLint для монорепо DankoDeploy.
 * - Type-aware правила typescript-eslint (ловят плавающие промисы, неверный await, unused).
 * - Прагматичная строгость: опасное → error, стилевое → warn, console разрешён.
 * - prettier последним — выключает стилевые правила, конфликтующие с форматтером.
 */
export default tseslint.config(
  // Не линтим сборку, зависимости, кэш Vite и сгенерированное.
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.vite/**",
      "**/drizzle/**",
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Общие настройки для всего TS/TSX-кода.
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        // Авто-резолв ближайшего tsconfig для каждого файла (typescript-eslint 8).
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // --- Опасное → error ---
      "@typescript-eslint/no-floating-promises": "error", // забытый await у фоновых операций
      // promise в JSX-обработчиках (onClick={() => mutation.mutate()}) — норма для TanStack,
      // поэтому не проверяем void-return у атрибутов; остальные misuse ловим.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // --- Шумное/стилевое → warn (не роняет линт) ---
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      // console разрешён: легитимные логи планировщиков/старта сервера.
      "no-console": "off",

      // Эти type-aware правила часто слишком придирчивы к рабочему коду — приглушаем до warn.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },

  // Фронтенд: правила хуков React + Fast Refresh.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // Служебные JS-скрипты вне tsconfig (напр. apps/server/build.mjs — esbuild-сборка).
  // Линтим БЕЗ type-information, иначе type-aware правила падают «нет проекта для файла».
  {
    files: ["**/*.{js,cjs,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false, project: false },
    },
  },

  // Тесты исключены из tsconfig (exclude в пакетах) → type-aware парсер их «не видит».
  // Линтим их БЕЗ type-information + с послаблениями (any/non-null в фикстурах — норма).
  {
    files: ["**/*.{test,spec}.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false, project: false },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  prettier,
);
