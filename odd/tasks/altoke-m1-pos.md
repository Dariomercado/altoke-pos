# AlToke — M1: POS de kiosco con branding en vivo

Plataforma multi-tenant para kioscos. M1 entrega el demo vendible: un POS que cobra de verdad,
calcula totales de verdad contra un libro de eventos local, imprime un ticket de 80 mm, y cambia de
marca en vivo cuando el tenant edita sus ajustes. Sin API y sin fiscal: eso es M2.

Specs de referencia: `docs/specs/0001-arquitectura.md` y `docs/specs/0002-fiscal-y-cobros.md`.

## Specs

- **S1** — "plataforma multi tenant con roles de usuario"
- **S2** — "quiero hacer que los usuarios puedas personalizar su sitio de acuerdo a su marca"
- **S3** — "hacer un web y app para que puedan gestionar offline ademas de en internet"
- **S4** — "lo estoy pensando para kioscos y tiendas de barrio chico/mediano"
- **S5** — "no quiero hacer esto con server actions"
- **S6** — "algo que no le especifique a stitch cuando hizo el diseño es que pusiera tambien un modo
  dark" · decisión: claro por defecto, oscuro opcional
- **S7** — nombre del producto: **AlToke**
- **S8** — "podriamos comenzar primero como sitio web pero hacer una arquitectura que este preparada
  para hacer una app mobile con android y sqlite"
- **S9** — "le apunto a kioscos" · "por tiendas me referia a comercios de de nicho en general"
- **S10** — "el precio lo voy a hacer de unico pago"

## Tasks

| # | Tarea | Specs | Ruta | Commit |
|---|---|---|---|---|
| T1 | Monorepo pnpm: workspaces, tsconfig base, lint que prohíbe React en `domain` | S8 | inline | ✅ |
| T2 | Tokens de diseño como CSS custom properties, claro/oscuro, drift de Stitch corregido | S2, S6 | inline | ⬜ |
| T3 | Dominio: dinero en centavos enteros, IVA incluido, redondeo half-up | S3, S4 | inline | ⬜ |
| T4 | Dominio: libro de eventos + proyecciones (stock, total de turno) | S3 | inline | ⬜ |
| T5 | Dominio: arqueo de caja por denominación | S4 | inline | ⬜ |
| T6 | Puerto `PosStore` + adaptador en memoria (tests) + adaptador IndexedDB (web real) + suite única de contrato | S3, S8 | inline | ⬜ |
| T7 | POS: cobrar contra el store, totales reales, ticket de 80 mm | S1, S4 | inline | ⬜ |
| T8 | Branding en vivo: 5 variables por tenant, preview del POS y del ticket | S2 | inline | ⬜ |

Fuera de M1, y a propósito: API, sync multi-terminal, fiscal, roles reales y alta de tenant. Ver el
roadmap de `0001` §2 y `0002` §7.

**Corrección posterior a L6:** la persistencia en IndexedDB **sí entra en M1**. Sin ella el POS pierde
todo al recargar la pestaña y no sirve para pilotear, que es el objetivo real de M1. El adaptador en
memoria existe para tests, no para uso.

## Log

### L1 — Pedido original

> "Hola gentle-shell, quiero comenzar un proyecto para kioscos y tiendas y salir a ofrecer a los
> potenciales clientes de mi ciudad. la idea seria algo como una plataforma multi tenant con roles de
> usuario, debe ser general y customizable ya que voy a ofrecer a kioscos y tiendas, quiero hacer que
> los usuarios puedas personalizar su sitio de acuerdo a su marca tambien, lo estoy pensando para
> kioscos y tiendas de barrio chico/mediano. hacer un web y app para que puedan gestionar offline
> ademas de en internet. estuve viendo de hacer un diseño con google stitch y mas o menos le describi
> lo que te estoy comentando ahora y bueno me genero varias pantallas, yo descargue el zip aunque hay
> varias formas que ofrece stitch para compartir el diseño, de momento opte por descargar un zip que
> tiene el code html de cada pantalla y un screen, lo unico es que se descargo en windows y aca estamos
> en ubuntu linux, esta es la direccion del zip que descargue ya extraido en downloads de windows
> C:\Users\DARIO-PC\Downloads\stitch_kioskflow_retail_platform, esto lo podes encontrar en linux
> tambien? en /mnt/c/users/Downloads/stitch_kioscflow_retail_plataform?"

### L2 — Restricciones de stack y alcance

> "no quiero hacer esto con server actions"

> "podriamos comenzar primero como sitio web pero hacer una arquitectura que este preparada para hacer
> una app mobile con android y sqlite como me marcabas"

> "algo que no le especifique a stitch cuando hizo el diseño es que pusiera tambien un modo dark"

Decisión: claro por defecto, oscuro opcional.

### L3 — Segmento

> "le apunto a kioscos. hoy te dije kioscos y tiendas. por tiendas me referia a comercios de de nicho
> en general pero no se que entendiste vos por tienda. yo decia tienda como forma de englobar este tipo
> de comercios: jugueterias, tienda de ropa, ferreterias."

Decisión: foco de lanzamiento kioscos; nicho preparado en el modelo, no construido.

### L4 — Modelo comercial

> "el precio lo voy a hacer de unico pago, es decir le presento el sistema y si lo quieren que me pague
> nomas"

Consecuencia arquitectónica registrada en `0001` §0.2: el costo marginal por tenant debe tender a cero.

### L5 — Decisiones de negocio aceptadas

> "si estoy de acuerdo con los 4."

Precio, soporte, alta de tenant y piloto aceptados según la propuesta, con el precio en modalidad de
pago único.

### L6 — Piloto y material impreso

> "para el primer cliente tengo que hacer la prueba con kiosco piloto o entendi mal? tambien pensaba en
> hacer un folleto o hoja a4 para imprimir despues y pasar a dejarla en los kioscos para que me
> contacten si estan interesados"

Aclaración: el piloto **no** es una prueba previa al primer cliente — el piloto **es** el primer
cliente. El folleto va después del piloto, porque necesita su foto y su frase.

Consecuencia sobre el plan: sin persistencia no hay piloto posible. IndexedDB entra en M1 (ver T6).
