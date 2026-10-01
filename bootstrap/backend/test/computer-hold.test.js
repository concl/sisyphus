const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { WindowsDriver } = require('../../../plugins/computer/backend/lib/computer')

// Exercise the actual PowerShell hold/finally path while substituting only the
// native input primitives. No click or pointer movement reaches the desktop.
test('Windows holds each click for the requested duration and releases on cancellation', { skip: process.platform !== 'win32' }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-hold-'))
  const file = path.join(directory, 'helper.ps1')
  const log = path.join(directory, 'events.txt')
  const cancelFile = path.join(directory, 'cancel')
  const driver = new WindowsDriver()
  try {
    const frame = await driver.call({ action: 'screenshot' }, new AbortController().signal)
    const source = fs.readFileSync(path.join(__dirname, '../../../plugins/computer/backend/lib/windows.ps1'), 'utf8')
    const sendPattern = /  static void Send\(INPUT input\) \{[\s\S]*?\n  \}/
    const movePattern = /  public static void Move\(int x, int y\) \{[^\n]*\}/
    assert(sendPattern.test(source) && movePattern.test(source))
    const stub = source.replace(sendPattern, `  static void Send(INPUT input) {
    File.AppendAllText(${JSON.stringify(log)}, input.u.mouse.flags + ":" + DateTime.UtcNow.Ticks + "\\n");
    if (input.u.mouse.flags == 2 && File.Exists(${JSON.stringify(log + '.cancel-on-down')})) File.WriteAllText(CancelFile, "");
  }`).replace(movePattern, '  public static void Move(int x, int y) {}')
    fs.writeFileSync(file, stub)
    const run = durationMs => spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      windowsHide: true, encoding: 'utf8', timeout: 10000,
      input: JSON.stringify({ action: 'click', frame, x: 1, y: 1, button: 'left', count: 1, durationMs, capture: false, cancelFile }) + '\n',
    })
    const first = run(180)
    assert.equal(first.status, 0, first.stderr)
    assert.equal(JSON.parse(first.stdout).inputSent, true)
    const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => line.split(':'))
    assert.deepEqual(entries.map(entry => entry[0]), ['2', '4'])
    assert(Number(BigInt(entries[1][1]) - BigInt(entries[0][1])) / 10000 >= 170, 'button must remain down across the hold interval')
    fs.writeFileSync(log, '')
    fs.writeFileSync(log + '.cancel-on-down', '')
    const cancelled = run(10000)
    assert.equal(cancelled.status, 0, cancelled.stderr)
    assert.match(JSON.parse(cancelled.stdout).error, /Request stopped/)
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').map(line => line.split(':')[0]), ['2', '4'])
  } finally {
    driver.dispose()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
