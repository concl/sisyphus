const http = require('node:http')

// Local protocol fixture: never contacts a model provider or consumes API credits.
// Enough steps that a fixed step budget would have cut the reply off mid-work.
const LONG_JOB_STEPS = 30

module.exports = async function mockModel() {
  const requests = []
  const server = http.createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    requests.push({ body, authorization: request.headers.authorization, url: request.url })
    if (body.model === 'error-model') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }),
      )
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const send = (delta, finish_reason = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'test-completion', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      )
    const last = body.messages.at(-1)
    // These fixtures replay the conversation's opening message, so a branch
    // stays in force for every step of the same reply.
    const opening = String(body.messages.find((message) => message.role === 'user')?.content ?? '')
    const toolCall = (id, title) => ({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id,
          type: 'function',
          function: {
            name: 'create_planner_item',
            arguments: JSON.stringify({ kind: 'todo', title }),
          },
        },
      ],
    })
    if (String(last?.content).includes('slow')) {
      send({ role: 'assistant', content: 'Starting…' })
      return
    }
    // The provider goes quiet in the middle of a reply and never finishes it.
    if (opening.includes('stall')) {
      send({ role: 'assistant', content: 'Starting…' })
      return
    }
    // A reasoning model: it thinks out loud before it answers.
    if (opening.includes('think')) {
      send({ role: 'assistant', reasoning_content: 'The user wants a number. ' })
      send({ role: 'assistant', reasoning_content: 'I know this one: 42.' })
      send({ role: 'assistant', content: 'It is 42.' })
      send({}, 'stop')
      response.end('data: [DONE]\n\n')
      return
    }
    // The output budget is spent while thinking, so no answer is ever written.
    if (opening.includes('truncate')) {
      send({ role: 'assistant', reasoning_content: 'Still thinking…' })
      send({}, 'length')
      response.end('data: [DONE]\n\n')
      return
    }
    // The provider accepts the request and never says anything at all.
    if (opening.includes('silent')) return
    // A tool that takes a while: the model has spoken, then a tool works on and
    // on. This is not the model being quiet, and must not end the reply.
    if (opening.includes('patient work')) {
      if (last?.role === 'tool') {
        send({ role: 'assistant', content: 'Finished the long tool call.' })
        send({}, 'stop')
      } else {
        send({ role: 'assistant', content: 'Working on it…' })
        send(toolCall(`patient-${requests.length}`, 'Patient work'))
        send({}, 'tool_calls')
      }
      response.end('data: [DONE]\n\n')
      return
    }
    // A long job: more steps than the old fixed budget allowed, then an answer.
    if (opening.includes('long job')) {
      if (requests.length <= LONG_JOB_STEPS) {
        send(toolCall(`long-${requests.length}`, `Step ${requests.length}`))
        send({}, 'tool_calls')
      } else {
        send({ role: 'assistant', content: `Done after ${LONG_JOB_STEPS} steps.` })
        send({}, 'stop')
      }
      response.end('data: [DONE]\n\n')
      return
    }
    // A model that keeps calling tools and never answers: the step budget ends it.
    if (opening.includes('loop')) {
      send(toolCall(`loop-${requests.length}`, `Loop ${requests.length}`))
      send({}, 'tool_calls')
      response.end('data: [DONE]\n\n')
      return
    }
    if (
      last?.role !== 'tool' &&
      body.tools?.some((item) => item.function.name === 'create_planner_item')
    ) {
      send(toolCall('create-1', 'Agent-created task'))
      send({}, 'tool_calls')
    } else {
      send({
        role: 'assistant',
        content:
          last?.role === 'tool'
            ? 'Created the task in your Planner.'
            : 'Hello from the test model.',
      })
      send({}, 'stop')
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve)
        server.closeAllConnections()
      }),
  }
}
