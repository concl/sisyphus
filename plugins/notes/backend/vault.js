const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

const LIMIT = 2 * 1024 * 1024
const revision = (content) => createHash('sha256').update(content).digest('hex')
function relativePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a path')
  let name = value.trim().replaceAll('\\', '/')
  if (
    name.length > 240 ||
    name
      .split('/')
      .some(
        (part) =>
          !part ||
          part.startsWith('.') ||
          /[<>:"|?*\x00-\x1f]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error('Use a relative path without hidden folders, reserved names, or ..')
  return name
}
function notePath(value) {
  const name = relativePath(value)
  return /\.md$/i.test(name) ? name : `${name}.md`
}
function metadata(name, content, stat) {
  const prose = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, '')
  return {
    path: name,
    title: path.posix.basename(name).replace(/\.md$/i, ''),
    revision: revision(content),
    modified: stat.mtime.toISOString(),
    tags: [...new Set([...prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]))],
    links: [
      ...new Set(
        [...prose.matchAll(/\[\[([^\]\n]+)\]\]/g)]
          .map((m) => m[1].split('|')[0].split('#')[0].trim())
          .filter(Boolean),
      ),
    ],
    excerpt: content.replace(/\s+/g, ' ').slice(0, 160),
  }
}
class Vault {
  constructor(userData, changed = () => {}) {
    this.config = path.join(userData, 'notes-vault.json')
    this.folder = ''
    this.projects = []
    this.userData = userData
    this.changed = changed
    this.queue = Promise.resolve()
    this.ready = this.initialize()
    this.ready.catch(() => {})
  }
  async initialize() {
    try {
      const config = JSON.parse(await fs.readFile(this.config, 'utf8'))
      if (typeof config.folder !== 'string' || (config.folder && !path.isAbsolute(config.folder)))
        throw new Error('Invalid notes vault configuration')
      this.folder = config.folder
      this.projects = Array.isArray(config.projects)
        ? config.projects.filter((value) => typeof value === 'string' && path.isAbsolute(value))
        : []
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      // Keep notes written by the earlier default-folder version accessible.
      const legacy = path.join(this.userData, 'notes')
      try {
        if ((await fs.readdir(legacy)).length) this.folder = await fs.realpath(legacy)
      } catch (cause) {
        if (cause.code !== 'ENOENT') throw cause
      }
    }
    if (this.folder) this.projects = [...new Set([this.folder, ...this.projects])].slice(0, 20)
  }
  run(work) {
    const result = this.queue.then(() => this.ready).then(work)
    this.queue = result.catch(() => {})
    return result
  }
  async target(name, mkdir = false, markdown = true) {
    if (!this.folder) throw new Error('Open or create a project folder first')
    name = markdown ? notePath(name) : relativePath(name)
    const parts = name.split('/')
    let current = this.folder
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i])
      try {
        const stat = await fs.lstat(current)
        if (stat.isSymbolicLink())
          throw new Error('Symbolic links are not supported in a notes vault')
        if (i < parts.length - 1 && !stat.isDirectory())
          throw new Error('A note folder is not a directory')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        if (mkdir && i < parts.length - 1) await fs.mkdir(current)
      }
    }
    return current
  }
  async readFile(name) {
    name = notePath(name)
    const file = await this.target(name)
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > LIMIT)
      throw new Error(`Cannot open ${name}: notes must be files under 2 MB`)
    const content = await fs.readFile(file, 'utf8')
    return { ...metadata(name, content, stat), content }
  }
  async scan(query = '', folder = this.folder) {
    const notes = [],
      warnings = [],
      folders = []
    if (!folder) return { folder: '', projects: this.projects, notes, folders, warnings }
    const visit = async (relative = '') => {
      const entries = await fs.readdir(path.join(folder, relative), { withFileTypes: true })
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.isSymbolicLink() ||
          ['node_modules', '__pycache__'].includes(entry.name)
        )
          continue
        const name = relative ? `${relative}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          folders.push(name)
          await visit(name)
        } else if (entry.isFile() && /\.md$/i.test(name)) {
          try {
            const { content, ...note } = await this.readFile(name)
            if (`${name}\n${content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
              notes.push(note)
          } catch (error) {
            warnings.push(`${name}: ${error.message}`)
          }
        }
      }
    }
    await visit()
    notes.sort((a, b) => a.path.localeCompare(b.path))
    folders.sort((a, b) => a.localeCompare(b))
    return { folder, projects: this.projects, notes, folders, warnings }
  }
  list({ query = '' } = {}) {
    if (typeof query !== 'string') return Promise.reject(new Error('Search must be text'))
    return this.run(() => this.scan(query))
  }
  read({ path: name }) {
    return this.run(() => this.readFile(name))
  }
  async writeFile(name, content, expected) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > LIMIT)
      throw new Error('Note content must be text under 2 MB')
    name = notePath(name)
    const file = await this.target(name, true)
    if (expected === null) {
      await fs.writeFile(file, content, { encoding: 'utf8', flag: 'wx' })
    } else {
      const previous = await this.readFile(name)
      if (typeof expected !== 'string' || previous.revision !== expected)
        throw new Error('File changed on disk. Save a copy or reload.')
      const temp = `${file}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
        // Recheck after writing the temporary file to catch concurrent external edits.
        if ((await this.readFile(name)).revision !== expected)
          throw new Error('File changed on disk. Save a copy or reload.')
        await fs.rename(temp, file)
      } finally {
        await fs.rm(temp, { force: true })
      }
    }
    this.changed()
    return this.readFile(name)
  }
  create({ path: name, content = '' }) {
    return this.run(() => this.writeFile(name, content, null))
  }
  save({ path: name, content, revision: expected }) {
    return this.run(() => this.writeFile(name, content, expected))
  }
  append({ path: name, content }) {
    return this.run(async () => {
      if (typeof content !== 'string') throw new Error('Content must be text')
      const note = await this.readFile(name)
      return this.writeFile(name, note.content + content, note.revision)
    })
  }
  rename({ path: name, newPath, revision: expected }) {
    return this.run(async () => {
      const note = await this.readFile(name)
      if (note.revision !== expected)
        throw new Error('This note changed on disk. Reload before renaming.')
      const destination = notePath(newPath)
      if (note.path === destination) return note
      const source = await this.target(note.path),
        target = await this.target(destination, true)
      // Exclusive copy protects an existing destination, including case-insensitive collisions.
      await fs.copyFile(source, target, require('node:fs').constants.COPYFILE_EXCL)
      await fs.unlink(source)
      this.changed()
      return this.readFile(destination)
    })
  }
  trash({ path: name, revision: expected }) {
    return this.run(async () => {
      const note = await this.readFile(name)
      if (note.revision !== expected)
        throw new Error('This note changed on disk. Reload before moving it to trash.')
      const trash = path.join(this.folder, '.trash')
      await fs.mkdir(trash, { recursive: true })
      if ((await fs.lstat(trash)).isSymbolicLink())
        throw new Error('Trash cannot be a symbolic link')
      const destination = path.join(
        trash,
        `${Date.now()}-${randomUUID()}-${path.basename(note.path)}`,
      )
      await fs.rename(await this.target(note.path), destination)
      this.changed()
      return { path: note.path, trashPath: destination }
    })
  }
  daily({ date } = {}) {
    return this.run(async () => {
      if (!date) {
        const now = new Date()
        date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      }
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
      )
        throw new Error('Use a valid YYYY-MM-DD date')
      const name = `Daily/${date}.md`
      try {
        return await this.readFile(name)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      return this.writeFile(name, `# ${date}\n\n`, null)
    })
  }
  createFolder({ path: name }) {
    return this.run(async () => {
      name = relativePath(name)
      const destination = await this.target(name, true, false)
      await fs.mkdir(destination)
      this.changed()
      return { path: name }
    })
  }
  async selectFolder(folder) {
    if (!path.isAbsolute(folder)) throw new Error('Choose an absolute project folder')
    const resolved = await fs.realpath(folder)
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error('Choose a directory')
    await fs.readdir(resolved)
    const projects = [...new Set([resolved, ...this.projects])].slice(0, 20)
    await fs.mkdir(this.userData, { recursive: true })
    const temp = `${this.config}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, JSON.stringify({ folder: resolved, projects }), 'utf8')
      await fs.rename(temp, this.config)
    } finally {
      await fs.rm(temp, { force: true })
    }
    this.folder = resolved
    this.projects = projects
    this.changed()
    return this.scan()
  }
  setFolder(folder) {
    return this.run(() => this.selectFolder(folder))
  }
  createProject({ parent, name }) {
    return this.run(async () => {
      name = relativePath(name)
      if (name.includes('/')) throw new Error('Enter a folder name, without a path')
      if (typeof parent !== 'string' || !path.isAbsolute(parent))
        throw new Error('Choose a location')
      const destination = path.join(await fs.realpath(parent), name)
      // Never adopt or overwrite an existing folder through "New project".
      await fs.mkdir(destination)
      return this.selectFolder(destination)
    })
  }
}
module.exports = { Vault, notePath }
