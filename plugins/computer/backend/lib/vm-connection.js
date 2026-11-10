const VM_PORT = 47631
const VM_HOST = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/
const VM_TOKEN = /^[a-f0-9]{64}$/

function vmCommand(host) {
  if (typeof host !== 'string' || !VM_HOST.test(host))
    throw new Error('Enter the VM’s SSH host name or config alias.')
  return {
    command: 'ssh',
    args: [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ConnectTimeout=5',
      '-o',
      'ServerAliveInterval=5',
      '-o',
      'ServerAliveCountMax=2',
      '-W',
      `127.0.0.1:${VM_PORT}`,
      host,
    ],
  }
}

module.exports = { VM_PORT, VM_HOST, VM_TOKEN, vmCommand }
