const { validateConversationInput } = require('./lib/chat-input')

module.exports = () => ({
  id: 'desktop.chat-actions',
  name: 'Chat actions',
  inject: ['chat.v1', 'actions.v1'],
  apply(ctx) {
    const chat = ctx.get('chat.v1')
    // The watcher can mount this adapter before the updated Chat plugin reloads.
    if (typeof chat.createConversation !== 'function') return
    ctx.effect(() =>
      ctx.get('actions.v1').registerService('chat', {
        name: 'Chat',
        actions: {
          createConversation: {
            name: 'Create conversation',
            description: 'Send a prompt in a new conversation and wait for the reply.',
            defaults: { folder: '', prompt: '' },
            fields: [
              {
                key: 'folder',
                label: 'Folder',
                kind: 'folder',
                required: true,
                expose: true,
                hint: 'Choose an existing folder or enter its absolute path.',
              },
              {
                key: 'prompt',
                label: 'Prompt',
                kind: 'text',
                multiline: true,
                required: true,
                expose: true,
              },
            ],
            outputs: [
              { key: 'conversationId', label: 'Conversation ID', kind: 'text' },
              { key: 'reply', label: 'Reply', kind: 'text' },
            ],
            effects: ['Saves a new conversation. Stop cancels the reply and keeps the conversation.'],
            notes: ['Uses the current model, harness, and tool access from Chat settings.'],
            calls: ['chat.v1.createConversation({ folder, prompt }, { signal })'],
            validate: validateConversationInput,
            async execute(input, { signal }) {
              const conversation = await chat.createConversation(input, { signal })
              const reply = conversation.messages.at(-1)
              if (reply.status !== 'complete') throw new Error(reply.error || 'The reply did not finish.')
              return { conversationId: conversation.id, reply: reply.text }
            },
          },
        },
      }),
    )
  },
})
