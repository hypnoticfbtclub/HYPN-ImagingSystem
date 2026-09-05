# HYPN Remote Image System V1.3.0 - Base de colaboradores

La publicación OWNER por GitHub sigue funcionando aunque D1 no esté configurado.
Para habilitar usuarios, contraseñas y solicitudes pendientes se necesita una base Cloudflare D1 gratuita.

## Crear la base

1. Cloudflare Dashboard > Storage & databases > D1 SQL Database.
2. Crear una base llamada `hypn-remote-image-db`.
3. Volver al Worker `hypn-remote-image-auth`.
4. Settings > Bindings > Add binding > D1 Database.
5. Nombre del binding: `HYPN_DB`.
6. Seleccionar `hypn-remote-image-db`.
7. Guardar/Deploy.

Después entra al panel web como OWNER. En la sección `Base de colaboradores` pulsa `INICIALIZAR BASE`.
El Worker creará automáticamente las tablas `users`, `submissions` y `audit_log`.

## Seguridad

No se guardan contraseñas en texto plano. Se almacenan con PBKDF2-SHA256 + salt individual.
Las imágenes pendientes se guardan en D1 y no se publican en GitHub Pages hasta que el OWNER pulsa APROBAR.
