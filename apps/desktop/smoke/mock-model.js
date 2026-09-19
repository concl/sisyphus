const http = require('node:http')

// Local protocol fixture: never contacts a model provider or consumes API credits.
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
    if (String(last?.content).includes('slow')) {
      send({ role: 'assistant', content: 'Starting…' })
      return
    }
    if (
      last?.role !== 'tool' &&
      body.tools?.some((item) => item.function.name === 'create_planner_item')
    ) {
      send({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'create-1',
            type: 'function',
            function: {
              name: 'create_planner_item',
              arguments: JSON.stringify({ kind: 'todo', title: 'Agent-created task' }),
            },
          },
        ],
      })
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
