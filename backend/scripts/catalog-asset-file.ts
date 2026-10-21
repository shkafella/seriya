export const MAX_PUBLIC_ASSET_BYTES = 64 * 1024

const safeElements = new Set([
  'svg',
  'title',
  'desc',
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
])

const safeAttributes = new Set([
  'xmlns',
  'viewbox',
  'role',
  'aria-label',
  'aria-labelledby',
  'aria-hidden',
  'id',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'd',
  'points',
  'transform',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'text-anchor',
  'font-family',
  'font-size',
  'font-weight',
])

export function assertLightweightPublicAsset(publicPath: string, bytes: Uint8Array) {
  if (!publicPath.endsWith('.svg')) {
    throw new Error(`Public catalog asset must be a derived SVG: ${publicPath}`)
  }
  if (bytes.byteLength > MAX_PUBLIC_ASSET_BYTES) {
    throw new Error(
      `Public catalog asset exceeds ${MAX_PUBLIC_ASSET_BYTES} bytes: ${publicPath} (${bytes.byteLength})`,
    )
  }

  let markup: string
  try {
    markup = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trim()
  } catch {
    throw new Error(`Public catalog asset must contain valid SVG markup: ${publicPath}`)
  }

  assertSafeSvgMarkup(publicPath, markup)
}

function assertSafeSvgMarkup(publicPath: string, markup: string) {
  if (!markup.startsWith('<svg') || !markup.endsWith('</svg>') || /<!|<\?/.test(markup)) {
    throw new Error(`Public catalog asset must contain valid SVG markup: ${publicPath}`)
  }

  const stack: string[] = []
  const tagPattern = /<\/?([A-Za-z][A-Za-z0-9:.-]*)(?:\s[^<>]*?)?\s*\/?>/g
  let cursor = 0
  let sawRoot = false
  let closedRoot = false
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(markup)) !== null) {
    const text = markup.slice(cursor, match.index)
    if (text.includes('<') || text.includes('>') || (stack.length === 0 && text.trim())) {
      throw new Error(`Public catalog asset must contain valid SVG markup: ${publicPath}`)
    }

    const rawTag = match[0]
    const elementName = match[1].toLowerCase()
    const closing = rawTag.startsWith('</')
    const selfClosing = /\/\s*>$/.test(rawTag)

    if (!safeElements.has(elementName)) {
      throw new Error(`Public catalog asset contains unsafe active or external content: ${publicPath}`)
    }

    if (closing) {
      if (!new RegExp(`^<\\/${match[1]}\\s*>$`, 'i').test(rawTag) || stack.pop() !== elementName) {
        throw new Error(`Public catalog asset must contain valid SVG markup: ${publicPath}`)
      }
      if (stack.length === 0) closedRoot = true
    } else {
      if (closedRoot || (stack.length === 0 && (sawRoot || elementName !== 'svg'))) {
        throw new Error(`Public catalog asset must contain valid SVG markup: ${publicPath}`)
      }
      if (stack.length > 0 && elementName === 'svg') {
        throw new Error(`Public catalog asset contains unsafe active or external content: ${publicPath}`)
      }
      if (stack.length === 0) sawRoot = true

      assertSafeAttributes(publicPath, rawTag, match[1])
      if (!selfClosing) stack.push(elementName)
      else if (stack.length === 0) closedRoot = true
    }

    cursor = tagPattern.lastIndex
  }

  const trailing = markup.slice(cursor)
  if (!sawRoot || !closedRoot || stack.length > 0 || trailing.includes('<') || trailing.includes('>') || trailing.trim()) {
    throw new Error(`Public catalog asset must contain valid SVG markup: ${publicPath}`)
  }
}

function assertSafeAttributes(publicPath: string, rawTag: string, originalElementName: string) {
  const withoutBrackets = rawTag.slice(1, -1).replace(/\/\s*$/, '').trim()
  const attributes = withoutBrackets.slice(originalElementName.length)
  const seen = new Set<string>()
  let cursor = 0

  while (cursor < attributes.length) {
    const remaining = attributes.slice(cursor)
    if (!remaining.trim()) break
    const match = remaining.match(/^\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/)
    if (!match) {
      throw new Error(`Public catalog asset must contain valid SVG markup: ${publicPath}`)
    }

    const name = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? ''
    if (seen.has(name) || !safeAttributes.has(name) || name.startsWith('on')) {
      throw new Error(`Public catalog asset contains unsafe active or external content: ${publicPath}`)
    }
    if (name === 'xmlns') {
      if (value !== 'http://www.w3.org/2000/svg') {
        throw new Error(`Public catalog asset contains unsafe active or external content: ${publicPath}`)
      }
    } else if (/\b(?:javascript|data|https?):|\/\/|url\s*\(/i.test(value)) {
      throw new Error(`Public catalog asset contains unsafe active or external content: ${publicPath}`)
    }

    seen.add(name)
    cursor += match[0].length
  }
}
