import { resolveProviderRequest } from '../services/api/providerConfig.js'
import { BRAND_TAGLINE } from '../constants/brand.js'
import { ANSI_DIM, ANSI_RESET, ansiRgb } from '../utils/terminalAnsi.js'
import { type RGB } from './StartupScreen.palettes.js'

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

const RESET = ANSI_RESET
const DIM = ANSI_DIM

// ─── Paleta de Tons de Verde ──────────────────────────────────────────────────

const GREEN_ACCENT: RGB = [57, 255, 20]     // Verde Neon brilhante
const GREEN_CREAM: RGB = [160, 255, 170]    // Verde claro suave
const GREEN_DIM: RGB = [70, 130, 80]        // Verde escuro/esmaecido
const GREEN_BORDER: RGB = [40, 160, 80]     // Verde médio para as bordas do box
const GREEN_GRADIENT: RGB[] = [             // Gradiente de tons verdes para o logo
  [0, 255, 127],   // Spring Green
  [57, 255, 20],   // Neon Green
  [0, 200, 83],    // Emerald
  [120, 255, 140], // Light Mint
]

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function gradAt(stops: readonly RGB[], t: number): RGB {
  const c = Math.max(0, Math.min(1, t))
  const s = c * (stops.length - 1)
  const i = Math.floor(s)
  if (i >= stops.length - 1) return stops[stops.length - 1]
  return lerp(stops[i], stops[i + 1], s - i)
}

export function paintLine(text: string, stops: readonly RGB[], lineT: number): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const t = text.length > 1 ? lineT - 0.5 + (i / (text.length - 1)) * 0.5 : lineT
    const [r, g, b] = gradAt(stops, t)
    out += `${ansiRgb(r, g, b)}${text[i]}`
  }
  return out + RESET
}

// ─── Filled Block Text Logo (HÜBER) ──────────────────────────────────────────

const LOGO_HUBER = [
  ' \u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 ',
  ' \u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557',
  ' \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d',
  ' \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u255d  \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557',
  ' \u2588\u2588\u2551  \u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551',
  ' \u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d',
]

// ─── Provider detection ───────────────────────────────────────────────────────

export function detectProvider(modelOverride?: string): { name: string; model: string; baseUrl: string; isLocal: boolean } {
  const resolvedRequest = resolveProviderRequest({
    model: modelOverride || process.env.OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
  })
  let displayModel = resolvedRequest.resolvedModel
  if (resolvedRequest.reasoning?.effort) {
    displayModel = `${displayModel} (${resolvedRequest.reasoning.effort})`
  }
  return {
    name: 'OpenRouter',
    model: displayModel,
    baseUrl: resolvedRequest.baseUrl,
    isLocal: false,
  }
}

// ─── Box drawing ──────────────────────────────────────────────────────────────

function boxRow(content: string, width: number, rawLen: number, border: RGB): string {
  const pad = Math.max(0, width - 2 - rawLen)
  return `${ansiRgb(...border)}\u2502${RESET}${content}${' '.repeat(pad)}${ansiRgb(...border)}\u2502${RESET}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function printStartupScreen(modelOverride?: string): void {
  if (process.env.CI || !process.stdout.isTTY) return

  // Utiliza a paleta customizada em tons de verde
  const ACCENT = GREEN_ACCENT
  const CREAM = GREEN_CREAM
  const DIMCOL = GREEN_DIM
  const BORDER = GREEN_BORDER
  const GRAD = GREEN_GRADIENT

  const p = detectProvider(modelOverride)
  const W = 62
  const columns = process.stdout.columns || 80
  const centerPad = (visibleLen: number): string =>
    ' '.repeat(Math.max(0, Math.floor((columns - visibleLen) / 2)))
  const out: string[] = []

  out.push('')

  // Gradient logo — HÜBER (Verde)
  const logo = LOGO_HUBER
  const logoWidth = Math.max(...logo.map(row => row.length))
  const logoLines = logo.map(row => ({
    pad: centerPad(logoWidth),
    text: row,
  }))
  const total = logoLines.length
  for (let i = 0; i < total; i++) {
    const t = total > 1 ? i / (total - 1) : 0
    if (logoLines[i].text === '') {
      out.push('')
    } else {
      out.push(logoLines[i].pad + paintLine(logoLines[i].text, GRAD, t))
    }
  }

  out.push('')

  // Tagline (Verde)
  out.push(`${centerPad(BRAND_TAGLINE.length + 4)}${ansiRgb(...ACCENT)}\u2726${RESET} ${ansiRgb(...CREAM)}${BRAND_TAGLINE}${RESET} ${ansiRgb(...ACCENT)}\u2726${RESET}`)
  out.push('')

  // Provider info box (Verde)
  const boxPad = centerPad(W)
  out.push(`${boxPad}${ansiRgb(...BORDER)}\u2554${'\u2550'.repeat(W - 2)}\u2557${RESET}`)

  const lbl = (k: string, v: string, c: RGB = CREAM): [string, number] => {
    const padK = k.padEnd(9)
    return [` ${DIM}${ansiRgb(...DIMCOL)}${padK}${RESET} ${ansiRgb(...c)}${v}${RESET}`, ` ${padK} ${v}`.length]
  }

  const provC: RGB = ACCENT
  let [r, l] = lbl('Provider', p.name, provC)
  out.push(boxPad + boxRow(r, W, l, BORDER))
  ;[r, l] = lbl('Model', p.model)
  out.push(boxPad + boxRow(r, W, l, BORDER))
  const ep = p.baseUrl.length > 38 ? p.baseUrl.slice(0, 35) + '...' : p.baseUrl
  ;[r, l] = lbl('Endpoint', ep)
  out.push(boxPad + boxRow(r, W, l, BORDER))

  out.push(`${boxPad}${ansiRgb(...BORDER)}\u2560${'\u2550'.repeat(W - 2)}\u2563${RESET}`)

  const sC: RGB = ACCENT
  const sL = p.isLocal ? 'local' : 'cloud'
  const sRow = ` ${ansiRgb(...sC)}\u25cf${RESET} ${DIM}${ansiRgb(...DIMCOL)}${sL}${RESET}    ${DIM}${ansiRgb(...DIMCOL)}Ready \u2014 type ${RESET}${ansiRgb(...ACCENT)}/help${RESET}${DIM}${ansiRgb(...DIMCOL)} to begin${RESET}`
  const sLen = ` \u25cf ${sL}    Ready \u2014 type /help to begin`.length
  out.push(boxPad + boxRow(sRow, W, sLen, BORDER))

  out.push(`${boxPad}${ansiRgb(...BORDER)}\u255a${'\u2550'.repeat(W - 2)}\u255d${RESET}`)
  const versionText = `huberclaude v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}`
  out.push(`${centerPad(versionText.length)}${DIM}${ansiRgb(...DIMCOL)}HüberClaude ${RESET}${ansiRgb(...ACCENT)}v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}${RESET}`)
  out.push('')

  process.stdout.write(out.join('\n') + '\n')
}