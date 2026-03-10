import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier,
    },
    rules: {
      // Prettier integration: options come from .prettierrc
      'prettier/prettier': 'error',

      // Console statements (allowed in Node.js service)
      'no-console': 'off',

      // Variable declarations
      'no-var': 'warn',
      'prefer-const': 'warn',

      // Naming conventions
      camelcase: ['warn', { properties: 'never', ignoreDestructuring: true }],

      // Code quality
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_|^err$',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_|^err$',
        },
      ],
      'no-unused-expressions': 'off',
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],

      // Best practices
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-shadow': 'warn',
      'no-param-reassign': ['warn', { props: false }],
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      'no-else-return': 'warn',
      'object-shorthand': ['warn', 'always'],
      'prefer-destructuring': ['warn', { object: true, array: false }],

      // Error handling
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',

      // Async/await
      'require-await': 'warn',
      'no-await-in-loop': 'warn',

      // Security
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
  {
    ignores: ['node_modules/**', 'coverage/**', 'docs/**', '*.min.js'],
  },
];
