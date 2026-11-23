/**
 * `pnpm --filter @altoke/api migrate`: aplica las migraciones de `apps/api/migrations/`.
 *
 * Corre como **dueño** (`MIGRATIONS_DATABASE_URL`, o `DATABASE_URL` si aquella falta): el rol de la
 * API no tiene DDL, y así el dueño del esquema sigue siendo uno solo.
 *
 * Idempotente: lo ya aplicado se informa como "ya aplicada" y no se vuelve a correr.
 */

import { leerConfig } from './config.ts'
import { crearPool } from './db.ts'
import { aplicarMigraciones, leerMigraciones } from './migraciones.ts'

async function principal(): Promise<void> {
  const config = leerConfig(process.env)
  const directorio = `${import.meta.dirname}/../migrations`
  const migraciones = leerMigraciones(directorio)
  const pool = crearPool(config.migracionesDatabaseUrl)

  try {
    const resumen = await aplicarMigraciones(pool, migraciones)

    for (const nombre of resumen.aplicadas) console.log(`aplicada     ${nombre}`)
    for (const nombre of resumen.omitidas) console.log(`ya aplicada  ${nombre}`)
    console.log(
      `${String(migraciones.length)} migración(es): ${String(resumen.aplicadas.length)} aplicada(s), ` +
        `${String(resumen.omitidas.length)} ya estaba(n).`,
    )
  } finally {
    await pool.end()
  }
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
