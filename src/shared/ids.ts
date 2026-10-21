// IDs are `<prefix>_<10 lowercase hex>` (spec §5). This file is imported by the renderer and
// preload too, so it must not import Node-only modules: it uses the web-standard `crypto`.

export const ID_PREFIXES = ['prj', 'ses', 'chr', 'var', 'epi', 'pnl', 'ver', 'msg', 'run', 'end', 'mdl', 'bt', 'dlg', 'upl'] as const

export type IdPrefix = (typeof ID_PREFIXES)[number]

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
}
