import type { ChatAttachmentInput } from '@sisyphus/sdk'

/**
 * Turning picked, dropped, or pasted files into attachments.
 *
 * Everything here happens in the window, because only the window has the bytes:
 * a pasted screenshot never touched the disk, so there is no path for the
 * desktop service to copy. Images are downscaled and re-encoded before they
 * cross, which keeps a 6 MB retina screenshot from becoming an 8 MB base64
 * string on every send.
 */

/** How many files one message may carry. */
export const MAX_ATTACHMENTS = 10
/** The most an attached file that is not an image may weigh. */
const MAX_FILE_BYTES = 5_000_000
/** The most an encoded image may weigh once it has been downscaled. */
const MAX_IMAGE_BYTES = 4_000_000
/** Longest edge of an image sent to the model; larger than any of them looks at. */
const MAX_IMAGE_EDGE = 1600
/** Longest edge of the thumbnail kept in the transcript. */
const PREVIEW_EDGE = 160

/** The base64 body of a data URL, without the `data:...;base64,` prefix. */
const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The extension shown on a file chip, upper-cased, or a generic label. */
export function extensionOf(name: string) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name)
  return match ? match[1].toUpperCase() : 'FILE'
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

/**
 * Draws the image into a canvas at most `edge` pixels on its longest side and
 * encodes it. PNG stays PNG, so a screenshot of text does not pick up JPEG
 * ringing around every glyph; a photograph becomes JPEG, which is far smaller.
 */
function draw(source: ImageBitmap, edge: number, type: string, quality?: number) {
  const scale = Math.min(1, edge / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not read the image')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL(type, quality)
}

async function readImage(file: File) {
  // `createImageBitmap` fails for some formats the picker allows (an SVG with
  // scripts, a corrupt file); the caller keeps the bytes and sends a chip.
  const bitmap = await createImageBitmap(file)
  try {
    const lossless = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp'
    const image = draw(bitmap, MAX_IMAGE_EDGE, lossless ? 'image/png' : 'image/jpeg', 0.85)
    const preview = draw(bitmap, PREVIEW_EDGE, 'image/jpeg', 0.7)
    return { image, preview }
  } finally {
    bitmap.close()
  }
}

async function readAttachment(file: File): Promise<ChatAttachmentInput> {
  const id = crypto.randomUUID()
  const name = (file.name || 'pasted image').slice(0, 200)
  const mime = file.type || 'application/octet-stream'
  if (mime.startsWith('image/')) {
    try {
      const { image, preview } = await readImage(file)
      if (image.length > MAX_IMAGE_BYTES) throw new Error(`${name} is still ${sizeLabel(image.length)} after resizing.`)
      return { id, name, mime, size: Math.round(image.length * 0.75), kind: 'image', preview, data: base64Of(image) }
    } catch (problem) {
      // A format the canvas will not take keeps its bytes and shows as a file.
      if (String(problem).includes('after resizing')) throw problem
    }
  }
  if (file.size > MAX_FILE_BYTES) throw new Error(`${name} is ${sizeLabel(file.size)}; the limit is ${sizeLabel(MAX_FILE_BYTES)}.`)
  const dataUrl = await readDataUrl(file)
  return { id, name, mime, size: file.size, kind: 'file', data: base64Of(dataUrl) }
}

/**
 * Reads files one at a time so a handful of large images cannot all be held in
 * memory at once, and stops at the count a message may carry.
 */
export async function readAttachments(
  files: File[],
  existing: number,
): Promise<ChatAttachmentInput[]> {
  const room = MAX_ATTACHMENTS - existing
  if (room <= 0) throw new Error(`A message can carry up to ${MAX_ATTACHMENTS} attachments.`)
  const chosen = files.slice(0, room)
  const read: ChatAttachmentInput[] = []
  for (const file of chosen) read.push(await readAttachment(file))
  return read
}
