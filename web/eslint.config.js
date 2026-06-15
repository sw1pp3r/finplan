import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Экспериментальные правила eslint-plugin-react-hooks v7 (RC): срабатывают на
      // идиоматичном коде по всей кодовой базе (async-загрузка в эффекте, Math.random
      // в конфетти, инлайн-подкомпоненты). Кодовая база написана до их появления —
      // отключаем именно их; стабильные rules-of-hooks/exhaustive-deps остаются.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/static-components": "off",
    },
  },
])
