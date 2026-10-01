/**
 * « HWID » de l'appareil, pour l'anti-double compte.
 *
 * Un navigateur n'a pas accès au vrai identifiant matériel : on assemble des caractéristiques
 * matérielles stables (carte graphique, nombre de cœurs, écran, tactile, fuseau horaire).
 * Elles ne changent pas quand on efface ses cookies ou qu'on passe en navigation privée.
 * Le serveur ne garde qu'une empreinte salée de cette chaîne, jamais la chaîne elle-même.
 *
 * Volontairement exclus, car instables : zoom (devicePixelRatio), version du navigateur,
 * langue, orientation de l'écran.
 */
export function hardwareId(): string {
  const [short, long] = [screen.width, screen.height].sort((a, b) => a - b);
  return [
    `gpu:${gpu()}`,
    `cpu:${navigator.hardwareConcurrency ?? 0}`,
    `screen:${short}x${long}x${screen.colorDepth}`,
    `touch:${navigator.maxTouchPoints ?? 0}`,
    `tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  ].join('|');
}

function gpu(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor: unknown = gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
    const renderer: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return `${String(vendor)}/${String(renderer)}`;
  } catch {
    return 'none';
  }
}
