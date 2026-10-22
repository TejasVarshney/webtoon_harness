import { describe, expect, it } from 'vitest'
import { listSections, upsertMarkdownSection } from './markdown-sections'

const BIBLE = '# Story Bible\n\n## Premise\nold\n\n## World\nw\n'

describe('upsertMarkdownSection', () => {
  it('upserts sections without disturbing others', () => {
    expect(upsertMarkdownSection(BIBLE, 'premise', 'new')).toBe('# Story Bible\n\n## Premise\nnew\n\n## World\nw\n')
    expect(upsertMarkdownSection(BIBLE, 'Arcs', 'a')).toBe('# Story Bible\n\n## Premise\nold\n\n## World\nw\n\n## Arcs\na\n')
  })

  it('keeps the heading as it was written and matches case-insensitively with surrounding spaces ignored', () => {
    expect(upsertMarkdownSection('## Characters & Relationships\nx\n', '  CHARACTERS & relationships ', 'y')).toBe('## Characters & Relationships\ny\n')
    expect(upsertMarkdownSection('## World   \nx\n\n## Tone\nt\n', 'world', 'y')).toBe('## World   \ny\n\n## Tone\nt\n')
  })

  it('replaces the last section in place and keeps the trailing newline', () => {
    expect(upsertMarkdownSection(BIBLE, 'World', 'x')).toBe('# Story Bible\n\n## Premise\nold\n\n## World\nx\n')
  })

  it('keeps a missing trailing newline missing', () => {
    expect(upsertMarkdownSection('## A\nold', 'A', 'new')).toBe('## A\nnew')
    expect(upsertMarkdownSection('## A\nold', 'B', 'b')).toBe('## A\nold\n\n## B\nb')
  })

  it('treats only "## " at column 0 as a heading: ### subheadings belong to the body and go with it', () => {
    const md = '## Premise\nintro\n### Detail\nmore\n\n## World\nw\n'
    expect(listSections(md)).toEqual(['Premise', 'World'])
    expect(upsertMarkdownSection(md, 'Premise', 'fresh')).toBe('## Premise\nfresh\n\n## World\nw\n')
    expect(upsertMarkdownSection(md, 'Detail', 'x')).toBe(`${md}\n## Detail\nx\n`)
  })

  it('does not take indented or mid-line "## " for a heading', () => {
    const md = '## A\n  ## B\nsee ## C\n'
    expect(listSections(md)).toEqual(['A'])
    expect(upsertMarkdownSection(md, 'B', 'b')).toBe('## A\n  ## B\nsee ## C\n\n## B\nb\n')
  })

  it('writes an empty body as one blank line and never stacks blank lines', () => {
    expect(upsertMarkdownSection(BIBLE, 'Premise', '')).toBe('# Story Bible\n\n## Premise\n\n## World\nw\n')
    expect(upsertMarkdownSection(BIBLE, 'World', '')).toBe('# Story Bible\n\n## Premise\nold\n\n## World\n')
    expect(upsertMarkdownSection(BIBLE, 'Premise', '\n\nnew text\n\n\n')).toBe('# Story Bible\n\n## Premise\nnew text\n\n## World\nw\n')
    expect(upsertMarkdownSection('# T\n\n\n', 'A', 'a')).toBe('# T\n\n## A\na\n')
  })

  it('keeps the first line indent and multi-line bodies of the new content', () => {
    expect(upsertMarkdownSection(BIBLE, 'Premise', '    code\n- item\n\nlast')).toBe('# Story Bible\n\n## Premise\n    code\n- item\n\nlast\n\n## World\nw\n')
  })

  it('builds a document from nothing', () => {
    expect(upsertMarkdownSection('', 'Premise', 'p')).toBe('## Premise\np\n')
  })

  it('replaces only the first of two sections with the same name', () => {
    expect(upsertMarkdownSection('## A\n1\n\n## A\n2\n', 'a', 'x')).toBe('## A\nx\n\n## A\n2\n')
  })

  it('rejects a heading that is empty or spans lines', () => {
    expect(() => upsertMarkdownSection(BIBLE, '  ', 'x')).toThrow(/heading/i)
    expect(() => upsertMarkdownSection(BIBLE, 'A\nB', 'x')).toThrow(/heading/i)
  })
})

describe('listSections', () => {
  it('lists headings in order, ignoring the title and empty headings', () => {
    expect(listSections(BIBLE)).toEqual(['Premise', 'World'])
    expect(listSections('# Title\n## \n##   \n## Real\n')).toEqual(['Real'])
    expect(listSections('')).toEqual([])
  })
})
