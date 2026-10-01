/**
 * Empreinte numérique de l'appareil, pour l'anti-double compte. Le serveur n'en garde
 * qu'une empreinte salée.
 *
 * Elle combine des caractéristiques matérielles (processeur, carte graphique, mémoire, écran,
 * tactile), système (fuseau horaire, polices installées, langues, plateforme) et de rendu
 * (canvas, audio, paramètres WebGL). Elle ne change pas quand on efface ses cookies ou qu'on
 * passe en navigation privée.
 *
 * Volontairement exclus, car instables : zoom (devicePixelRatio), version du navigateur,
 * orientation de l'écran.
 */
export async function deviceFingerprint(): Promise<string> {
  const [short, long] = [screen.width, screen.height].sort((a, b) => a - b);
  return [
    `gpu:${gpu()}`,
    `cpu:${navigator.hardwareConcurrency ?? 0}`,
    `mem:${(navigator as { deviceMemory?: number }).deviceMemory ?? 0}`,
    `screen:${short}x${long}x${screen.colorDepth}`,
    `touch:${navigator.maxTouchPoints ?? 0}`,
    `tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `fonts:${installedFonts()}`,
    `lang:${navigator.languages?.join(',') ?? navigator.language}`,
    `platform:${navigator.platform}`,
    `canvas:${hash(canvasRender())}`,
    `audio:${await audioRender()}`,
    `webgl:${hash(webglParams())}`,
  ].join('|');
}

function gl(): WebGLRenderingContext | null {
  try {
    return document.createElement('canvas').getContext('webgl');
  } catch {
    return null;
  }
}

function gpu(): string {
  const ctx = gl();
  if (!ctx) return 'none';
  const info = ctx.getExtension('WEBGL_debug_renderer_info');
  const vendor: unknown = ctx.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : ctx.VENDOR);
  const renderer: unknown = ctx.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : ctx.RENDERER);
  return `${String(vendor)}/${String(renderer)}`;
}

function webglParams(): string {
  const ctx = gl();
  if (!ctx) return 'none';
  const p = [ctx.MAX_TEXTURE_SIZE, ctx.MAX_RENDERBUFFER_SIZE, ctx.MAX_VERTEX_ATTRIBS, ctx.MAX_VARYING_VECTORS, ctx.MAX_FRAGMENT_UNIFORM_VECTORS, ctx.ALIASED_LINE_WIDTH_RANGE];
  return [...p.map((x) => String(ctx.getParameter(x))), ...(ctx.getSupportedExtensions() ?? [])].join(';');
}

/** Polices détectées par la largeur d'un texte comparée aux polices génériques. */
const FONTS = [
  'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel',
  'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Helvetica Neue', 'Impact', 'Lucida Console',
  'Lucida Grande', 'Menlo', 'Monaco', 'Palatino', 'Segoe UI', 'Segoe UI Emoji', 'SF Pro Text', 'Tahoma',
  'Times New Roman', 'Trebuchet MS', 'Verdana', 'Roboto', 'Noto Sans', 'Ubuntu', 'DejaVu Sans', 'Liberation Sans',
  'Cantarell', 'Avenir', 'Futura', 'Gill Sans', 'Optima', 'Hiragino Sans', 'Yu Gothic', 'Microsoft YaHei',
];

function installedFonts(): string {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 'none';
  const sample = 'mmmmmmmmmmlliWW@#&%01';
  const width = (font: string) => {
    ctx.font = `72px ${font}`;
    return ctx.measureText(sample).width;
  };
  const bases = ['monospace', 'sans-serif', 'serif'].map((b) => [b, width(b)] as const);
  return hash(FONTS.filter((f) => bases.some(([b, w]) => width(`'${f}', ${b}`) !== w)).join(','));
}

function canvasRender(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 60;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'none';
  const g = ctx.createLinearGradient(0, 0, 240, 0);
  g.addColorStop(0, '#ff3d9a');
  g.addColorStop(1, '#4ad7ff');
  ctx.fillStyle = g;
  ctx.fillRect(4, 4, 232, 52);
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 18px serif';
  ctx.fillStyle = 'rgba(20, 10, 30, 0.85)';
  ctx.fillText('Fall into everything 🐇 ∞ ½', 10, 36);
  ctx.globalCompositeOperation = 'multiply';
  ctx.beginPath();
  ctx.arc(200, 30, 22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(255, 200, 0)';
  ctx.fill();
  return canvas.toDataURL();
}

/** Rendu audio hors ligne : de légères différences de calcul selon le matériel et le système. */
async function audioRender(): Promise<string> {
  try {
    const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Ctx) return 'none';
    const ctx = new Ctx(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10_000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50;
    comp.knee.value = 40;
    comp.ratio.value = 12;
    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);
    const buffer = await Promise.race([ctx.startRendering(), new Promise<null>((r) => setTimeout(() => r(null), 1000))]);
    if (!buffer) return 'timeout';
    const data = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i] ?? 0);
    return sum.toFixed(6);
  } catch {
    return 'none';
  }
}

/** Hachage court non cryptographique (cyrb53) : `crypto.subtle` n'existe pas hors HTTPS (réseau local). */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
