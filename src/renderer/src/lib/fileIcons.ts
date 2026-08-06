import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Link,
  type LucideIcon
} from 'lucide-react'

interface FileIconSpec {
  Icon: LucideIcon
  /** Muted per-type tint — status colors must stay the loudest thing in a row. */
  colorClass: string
}

const FAMILY: Record<string, FileIconSpec> = {
  doc: { Icon: FileText, colorClass: 'text-sky-600/70 dark:text-sky-400/70' },
  sheet: { Icon: FileSpreadsheet, colorClass: 'text-emerald-600/70 dark:text-emerald-400/70' },
  image: { Icon: FileImage, colorClass: 'text-violet-600/70 dark:text-violet-400/70' },
  video: { Icon: FileVideo, colorClass: 'text-rose-600/70 dark:text-rose-400/70' },
  audio: { Icon: FileAudio, colorClass: 'text-amber-600/70 dark:text-amber-400/70' },
  archive: { Icon: FileArchive, colorClass: 'text-orange-600/70 dark:text-orange-400/70' },
  code: { Icon: FileCode, colorClass: 'text-teal-600/70 dark:text-teal-400/70' },
  other: { Icon: File, colorClass: 'text-ink-faint' }
}

const EXT_FAMILY: Record<string, keyof typeof FAMILY> = {
  pdf: 'doc', doc: 'doc', docx: 'doc', txt: 'doc', md: 'doc', rtf: 'doc', odt: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'sheet', ods: 'sheet',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', heic: 'image',
  svg: 'image', bmp: 'image', tiff: 'image', raw: 'image', psd: 'image',
  mp4: 'video', mov: 'video', mkv: 'video', avi: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio',
  zip: 'archive', rar: 'archive', gz: 'archive', tar: 'archive', bz2: 'archive', xz: 'archive',
  '7z': 'archive', dmg: 'archive', iso: 'archive',
  js: 'code', ts: 'code', tsx: 'code', jsx: 'code', py: 'code', rb: 'code', go: 'code',
  rs: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', sh: 'code', json: 'code',
  yaml: 'code', yml: 'code', toml: 'code', html: 'code', css: 'code', sql: 'code',
  stl: 'other', '3mf': 'other', obj: 'other', step: 'other'
}

export function iconForFile(ext: string | undefined, isSymlink = false): FileIconSpec {
  if (isSymlink) return { Icon: Link, colorClass: 'text-ink-faint' }
  return FAMILY[EXT_FAMILY[ext ?? ''] ?? 'other']
}
