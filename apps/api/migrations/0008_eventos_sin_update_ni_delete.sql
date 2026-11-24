-- «Nada se reescribe» era una promesa del código: el rol de la API conservaba `UPDATE` y `DELETE`
-- sobre `eventos`, así que un bug, una consulta nueva o un `psql` con esas credenciales podía
-- reescribir la historia del libro sin que nada lo impidiera.
--
-- Ahora lo sostiene el privilegio. La API sigue viendo y agregando eventos (`SELECT` e `INSERT`),
-- que es todo lo que hace; si algún día necesita corregir algo, la corrección es un evento nuevo.
--
-- Las otras tablas no se tocan: `sesiones`, `usuarios`, `membresias`, `acuses` y compañía se
-- actualizan de verdad.

REVOKE UPDATE, DELETE ON TABLE eventos FROM altoke_app;
