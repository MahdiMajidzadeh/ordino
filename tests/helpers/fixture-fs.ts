import { promises as fs } from 'fs'
import os from 'os'
import { join, dirname } from 'path'

/**
 * Materialize a file tree in a temp dir for scanner/apply tests.
 * Spec: { 'a.txt': 'contents', 'sub/b.pdf': 'x', 'empty-dir/': null }
 */
export async function makeTree(spec: Record<string, string | null>): Promise<string> {
  const root = await fs.mkdtemp(join(os.tmpdir(), 'ordino-test-'))
  for (const [rel, content] of Object.entries(spec)) {
    const abs = join(root, rel)
    if (rel.endsWith('/') || content === null) {
      await fs.mkdir(abs, { recursive: true })
    } else {
      await fs.mkdir(dirname(abs), { recursive: true })
      await fs.writeFile(abs, content)
    }
  }
  return root
}

export async function removeTree(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true })
}

/** Sorted list of all file rel paths currently under root (POSIX separators). */
export async function snapshotFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(rel: string): Promise<void> {
    const entries = await fs.readdir(rel === '' ? root : join(root, rel), { withFileTypes: true })
    for (const e of entries) {
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) await walk(childRel)
      else out.push(childRel)
    }
  }
  await walk('')
  return out.sort()
}
