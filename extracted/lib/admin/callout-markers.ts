/**
 * Pure markdown helper for callout marker pre-processing.
 * Extracted here so it can be unit-tested in the vitest node environment
 * without importing JSX components.
 *
 * Used by components/article-preview-pane.tsx.
 */

/**
 * Moves inline callout markers (e.g. `> [KEY TAKEAWAY] content`) onto their
 * own blockquote line so that the React blockquote renderer can reliably
 * detect and strip the marker token.
 *
 * Input:  `> [INFO] Smart tip content here.`
 * Output: `> [INFO]\n> \n> Smart tip content here.`
 */
export function preprocessCalloutMarkers(md: string): string {
  return md.replace(
    /^(> ?)\[(KEY TAKEAWAY|INFO|TIP|AU|NZ|INTERESTING FACT|INSIGHT|DONT WORRY|REASSURANCE|CASE STUDY:[^\]]+)\] +(.+)$/gm,
    (_match, prefix, type, content) =>
      `${prefix}[${type}]\n${prefix}\n${prefix}${content}`
  )
}
