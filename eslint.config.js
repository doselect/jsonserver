// neostandard: the maintained successor of `standard`, with TypeScript support. Same style as eden.
// Anything git ignores (dist, .env, logs, ...) is skipped, plus any extra node_modules* folder
import neostandard, { plugins, resolveIgnoresFromGitignore } from 'neostandard'

export default [
  // Global ignores: an object with only `ignores`
  { ignores: [...resolveIgnoresFromGitignore(), 'node_modules*/**'] },
  ...neostandard({ ts: true }),
  {
    files: ['**/*.ts'],
    // Type-aware rules below read the TypeScript project
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    // ESLint 10 needs the plugin in the same config object as the rule
    plugins: { '@typescript-eslint': plugins['typescript-eslint'].plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // No hidden `any` either: values TypeScript could not type (JSON.parse, an untyped `let`, Array.isArray on
      // unknown, ...) must be given a type before they are assigned, called, read, passed on or returned
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error'
    }
  }
]
