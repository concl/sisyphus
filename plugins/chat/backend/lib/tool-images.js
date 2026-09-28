const OBSERVATION = 'Computer observation from a tool (not a new user request): '
const isObservation = message => message.role === 'user' && Array.isArray(message.content) && message.content[0]?.text?.startsWith(OBSERVATION)
const isImage = part => part.type === 'image-data' || (part.type === 'file' && part.mediaType?.startsWith('image/'))
function modelOutput({ output }) {
  if (output?.type !== 'computer-screenshot') return { type: 'json', value: output ?? null }
  const { data, mediaType, ...metadata } = output
  return { type: 'content', value: [
    { type: 'text', text: JSON.stringify(metadata) },
    { type: 'file', mediaType, data: { type: 'data', data } },
  ] }
}
// Chat Completions adapters serialize tool content as JSON. Move screenshots
// to an adjacent image message so vision actually receives pixels, not base64
// text. Keep only the newest observation; obsolete pixels aren't useful state.
function projectImages(messages, compatible) {
  const projected = messages.flatMap(message => {
    if (!compatible || message.role !== 'tool') return [message]
    const images = []
    const content = message.content.map(part => {
      if (part.output?.type !== 'content') return part
      const values = part.output.value
      const pixels = values.filter(isImage)
      if (!pixels.length) return part
      const text = values.filter(value => value.type === 'text').map(value => value.text).join('\n')
      images.push({ role: 'user', content: [
        { type: 'text', text: OBSERVATION + text },
        ...pixels.map(value => ({ type: 'image', mediaType: value.mediaType, image: value.type === 'image-data' ? value.data : value.data.data })),
      ] })
      return { ...part, output: { type: 'text', value: text } }
    })
    return [{ ...message, content }, ...images]
  })
  let last = -1
  projected.forEach((message, index) => {
    if (isObservation(message) || message.role === 'tool' && message.content.some(part => part.output?.type === 'content' && part.output.value.some(isImage))) last = index
  })
  return projected.map((message, index) => {
    if (index === last) return message
    if (isObservation(message)) return { ...message, content: message.content.filter(part => part.type !== 'image') }
    if (message.role !== 'tool') return message
    return { ...message, content: message.content.map(part => part.output?.type !== 'content' ? part : {
      ...part, output: { ...part.output, value: part.output.value.filter(value => !isImage(value)) },
    }) }
  })
}
module.exports = { modelOutput, projectImages, isObservation }
