/**
 * Commitlint configuration for Conventional Commits
 * Used by Release-Please for automatic changelog generation
 *
 * @see https://commitlint.js.org/
 * @see https://www.conventionalcommits.org/
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // New features
        'fix', // Bug fixes
        'docs', // Documentation changes
        'style', // Code style changes (formatting, etc.)
        'refactor', // Code refactoring
        'perf', // Performance improvements
        'test', // Test changes
        'build', // Build system changes
        'ci', // CI/CD changes
        'chore', // Maintenance tasks
        'revert', // Revert previous commit
      ],
    ],
    'subject-case': [2, 'never', ['upper-case']], // No UPPERCASE subjects
    'subject-full-stop': [2, 'never', '.'], // No period at end
    'subject-empty': [2, 'never'], // Subject required
    'type-empty': [2, 'never'], // Type required
    'body-leading-blank': [2, 'always'], // Blank line before body
    'footer-leading-blank': [2, 'always'], // Blank line before footer
  },
};
