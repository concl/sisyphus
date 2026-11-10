const path = require('node:path')
const { validateFolder } = require('@sisyphus/native/folder')

const MAX_MESSAGE_LENGTH = 20_000

function validateConversationInput({ prompt, folder }) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Enter a prompt.')
  if (prompt.length > MAX_MESSAGE_LENGTH) throw new Error('A prompt can be up to 20,000 characters.')
  if (typeof folder !== 'string' || !path.isAbsolute(folder))
    throw new Error('Choose a folder or enter its absolute path.')
  return validateFolder(folder)
}

module.exports = { MAX_MESSAGE_LENGTH, validateConversationInput }
