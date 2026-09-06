# HYPN Imaging System — Unity V1.4.14

Integración Unity/VRChat basada en el comportamiento probado de SoyrmaPicture + PerPlayerPicture, adaptada al sistema remoto actual.

- La web y `remote-config.json` siguen siendo la fuente de verdad.
- `HYPNRemotePicture` aplica la imagen por canal a `_MainTex` y `_EmissionMap`.
- `HYPNPerPlayerPicture` guarda la última `VRCUrl` por canal usando variables sincronizadas persistentes.
- El Tool Unity crea automáticamente la plantilla PlayerObject + VRCEnablePersistence y 15 estados persistentes.
- El manager conserva la cola global de descargas para respetar el límite de VRChat.
- Raíz de escena preservada: `HYPN Remote Image System`.
- Menú del Tool: `Tools > HYPN Imaging System`.

Los paquetes FULL/PATCH V1.4.14 contienen también el manager y el Editor Tool actualizados.