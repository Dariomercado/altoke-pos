// Declaraciones de los módulos de estilo del paquete: el import de efectos
// secundarios `import '@altoke/ui/tokens.css'` en el entry de la app, y
// `import css from './tokens.css?raw'` en los tests.
declare module '*.css' {
  const css: string
  export default css
}

declare module '*.css?raw' {
  const css: string
  export default css
}
