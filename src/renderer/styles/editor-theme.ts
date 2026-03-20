import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** Editor chrome: backgrounds, gutters, selection, cursor. */
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    height: '100%',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-bg-secondary)',
    borderRight: '1px solid var(--color-border-default)',
    color: 'var(--color-text-muted)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-bg-elevated)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(139, 148, 158, 0.2)',
  },
}, { dark: true });

/** Hides the cursor — applied only when the editor is read-only (vim off). */
export const hideCursorExtension: Extension = EditorView.theme({
  '.cm-cursor': {
    display: 'none',
  },
}, { dark: true });

/** Styles for the vim status panel and command input. */
export const vimPanelTheme: Extension = EditorView.theme({
  '.cm-panels': {
    backgroundColor: 'var(--color-bg-secondary)',
    borderTop: '1px solid var(--color-border-default)',
    color: 'var(--color-text-secondary)',
  },
  '.cm-vim-panel': {
    padding: '0 8px',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
  },
  '.cm-vim-panel input': {
    backgroundColor: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border-default)',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '13px',
    outline: 'none',
  },
  '.cm-fat-cursor': {
    background: 'var(--color-text-secondary) !important',
    color: 'var(--color-bg-primary) !important',
  },
  '&:not(.cm-focused) .cm-fat-cursor': {
    outline: '1px solid var(--color-text-secondary)',
    background: 'transparent !important',
    color: 'var(--color-text-primary) !important',
  },
}, { dark: true });

/** Syntax highlighting using CSS custom properties from global.css :root. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword,
    color: 'var(--syntax-keyword)' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName],
    color: 'var(--syntax-property)' },
  { tag: [tags.propertyName],
    color: 'var(--syntax-property)' },
  { tag: [tags.function(tags.variableName), tags.labelName],
    color: 'var(--syntax-function)' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: 'var(--syntax-constant)' },
  { tag: [tags.definition(tags.name), tags.separator],
    color: 'var(--color-text-primary)' },
  { tag: [tags.typeName, tags.className, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace],
    color: 'var(--syntax-type)' },
  { tag: [tags.number],
    color: 'var(--syntax-number)' },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.special(tags.string)],
    color: 'var(--syntax-operator)' },
  { tag: [tags.meta, tags.comment],
    color: 'var(--syntax-comment)' },
  { tag: tags.strong,
    fontWeight: 'bold' },
  { tag: tags.emphasis,
    fontStyle: 'italic' },
  { tag: tags.strikethrough,
    textDecoration: 'line-through' },
  { tag: tags.link,
    color: 'var(--syntax-link)',
    textDecoration: 'underline' },
  { tag: tags.heading,
    fontWeight: 'bold',
    color: 'var(--syntax-keyword)' },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)],
    color: 'var(--syntax-constant)' },
  { tag: [tags.processingInstruction, tags.string, tags.inserted],
    color: 'var(--syntax-string)' },
  { tag: [tags.tagName],
    color: 'var(--syntax-tag)' },
  { tag: tags.invalid,
    color: 'var(--color-text-primary)' },
]);

/** Diff viewer styling: GitHub-dark addition/deletion colors. */
export const diffTheme: Extension = EditorView.theme({
  '.cm-changedLine': {
    backgroundColor: 'rgba(46, 160, 67, 0.15)',
  },
  '.cm-changedText': {
    backgroundColor: 'rgba(46, 160, 67, 0.3)',
  },
  '.cm-deletedChunk': {
    backgroundColor: 'rgba(248, 81, 73, 0.15)',
  },
  '.cm-insertedLine': {
    backgroundColor: 'rgba(46, 160, 67, 0.15)',
  },
  // Merge view gutter markers
  '.cm-changeGutter': {
    width: '3px',
  },
  '.cm-changeGutter .cm-gutterElement': {
    padding: '0',
  },
}, { dark: true });

/** Combined extension: editor chrome + syntax highlighting. */
export const mcodeEditorExtension: Extension[] = [
  editorTheme,
  syntaxHighlighting(highlightStyle),
];
