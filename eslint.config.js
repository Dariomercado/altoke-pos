import tseslint from 'typescript-eslint'

/**
 * Invariante I1 de docs/specs/0001-arquitectura.md:
 * packages/domain es TypeScript puro. Si esto regla falla, la promesa
 * "preparado para Android" deja de ser verdad y se convierte en una reescritura.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['packages/domain/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'El dominio debe ser puro: sin React (invariante I1).' },
            { name: 'react-dom', message: 'El dominio debe ser puro: sin React (invariante I1).' },
          ],
          patterns: [
            {
              group: ['@altoke/*', '**/apps/**', '**/packages/*/src/**'],
              message:
                'El dominio no importa otros paquetes del workspace: recibe datos y devuelve datos (invariante I1).',
            },
          ],
        },
      ],
    },
  },
)
