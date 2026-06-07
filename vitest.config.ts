import { defineConfig } from "vitest/config";

/**
 * Единый конфиг тестов для всего монорепо. Vitest сам резолвит TypeScript и
 * workspace-импорты (`@dankodeploy/*` указывают на src), поэтому отдельная сборка
 * не нужна. Покрываем прежде всего ЧИСТЫЕ функции (без SSH/БД/сети): парсеры,
 * криптографию, генераторы конфигов, форматтеры — там, где тесты дёшевы и ловят
 * реальные регрессы.
 */
export default defineConfig({
  test: {
    // Берём только наши тесты, не лезем в node_modules.
    include: ["{apps,packages}/**/*.{test,spec}.ts"],
    environment: "node",
    // Без глобалов: импортируем describe/it/expect явно (verbatimModuleSyntax-friendly).
    globals: false,
  },
});
