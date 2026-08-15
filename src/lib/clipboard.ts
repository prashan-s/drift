import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A copy action with its own "Copied" state.
 *
 * The feedback matters more than it looks: without it people press the button
 * again to check it worked. The timer is cleared on unmount so a copy from a
 * panel that then closes cannot set state on a gone component.
 */
export function useCopy(resetAfter = 1500): {
  copied: boolean
  copy: (text: string) => void
} {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), resetAfter)
      })
    },
    [resetAfter],
  )

  return { copied, copy }
}

/**
 * Renders rows as a GitHub-flavoured Markdown table.
 *
 * Pipes inside a cell would break the table, so they are escaped rather than
 * silently corrupting the output someone is about to paste into a pull request.
 */
export function markdownTable(headers: string[], rows: string[][]): string {
  const escape = (cell: string) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  return [
    `| ${headers.map(escape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n')
}
