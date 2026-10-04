'use strict'
function networkActions(fetchRequest = fetch) {
  return {
    request: {
      name: 'Web request',
      description: 'Get or send data to a web service.',
      effects: [
        'Sends an HTTP request to the address you supply. POST, PUT, PATCH and DELETE may change remote data.',
      ],
      calls: ['network-actions.v1.request(input) → fetch(url, options)'],
      notes: [
        'A non-success HTTP status fails the step. Responses are limited to 256 KB.',
        'Response data is parsed as JSON when the response content type contains json; otherwise it is text. Stop aborts the request, but cannot undo a request already received by the server.',
      ],
      examples: [
        {
          title: 'Read JSON from a service',
          input: {
            url: 'https://example.com/api/items',
            method: 'GET',
            headers: { Accept: 'application/json' },
            body: null,
            timeoutSeconds: 30,
          },
        },
      ],
      icon: '⇄',
      defaults: { url: '', method: 'GET', headers: {}, body: null, timeoutSeconds: 30 },
      fields: [
        {
          key: 'url',
          label: 'Address',
          kind: 'text',
          required: true,
          hint: 'A complete HTTP or HTTPS URL.',
        },
        {
          key: 'method',
          label: 'Method',
          kind: 'select',
          options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
            value,
            label: value,
          })),
        },
        {
          key: 'headers',
          label: 'Headers',
          kind: 'json',
          hint: 'A JSON object, for example {"Accept":"application/json"}.',
        },
        {
          key: 'body',
          label: 'Body',
          kind: 'json',
          hint: 'JSON data for the request; null sends no body.',
        },
        { key: 'timeoutSeconds', label: 'Timeout in seconds', kind: 'number', min: 1, max: 300 },
      ],
      outputs: [
        { key: 'body', label: 'Response data', kind: 'json' },
        { key: 'status', label: 'Status', kind: 'number' },
        { key: 'text', label: 'Response text', kind: 'text' },
      ],
      validate(input) {
        let url
        try {
          url = new URL(input.url)
        } catch {
          throw new Error('Enter a complete HTTP or HTTPS address')
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error('Use an HTTP/HTTPS address without embedded credentials')
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method))
          throw new Error('Invalid request method')
        if (
          !input.headers ||
          typeof input.headers !== 'object' ||
          Array.isArray(input.headers) ||
          Object.values(input.headers).some((value) => typeof value !== 'string')
        )
          throw new Error('Headers must be an object of text values')
        if (
          !Number.isFinite(input.timeoutSeconds) ||
          input.timeoutSeconds < 1 ||
          input.timeoutSeconds > 300
        )
          throw new Error('Choose a timeout between 1 and 300 seconds')
        if (input.method === 'GET' && input.body !== null)
          throw new Error('GET requests cannot have a body')
      },
      async execute(input, { signal, log }) {
        const headers = new Headers(input.headers)
        if (input.body !== null && !headers.has('content-type'))
          headers.set('content-type', 'application/json')
        const response = await fetchRequest(input.url, {
          method: input.method,
          headers,
          body: input.body === null ? undefined : JSON.stringify(input.body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(input.timeoutSeconds * 1000)]),
        })
        let size = 0
        const chunks = []
        if (response.body)
          for await (const chunk of response.body) {
            size += chunk.byteLength
            if (size > 256 * 1024) throw new Error('Response exceeds 256 KB')
            chunks.push(chunk)
          }
        const text = Buffer.concat(chunks).toString('utf8')
        if (!response.ok) throw new Error(`Web request returned ${response.status}`)
        let body = text
        if (response.headers.get('content-type')?.includes('json')) body = JSON.parse(text)
        log(`Response ${response.status}.\n`)
        return { body, text, status: response.status }
      },
    },
  }
}
module.exports = { networkActions }
