export {
  CONTRASTE_MINIMO,
  HUECOS_DE_MARCA,
  MARCA_POR_DEFECTO,
  contraste,
  esContrasteLegible,
  normalizarColorDeMarca,
  textoSobre,
  variablesDeMarca,
} from './theme'
export type { MarcaTenant } from './theme'

// Los tokens viven en `@altoke/ui/tokens.css` y se importan una sola vez en el
// entry de la app: `import '@altoke/ui/tokens.css'`.
