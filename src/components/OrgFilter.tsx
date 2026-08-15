import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { useSession } from '../lib/session'

interface Props {
  /** Organisations found in the current input, offered alongside the saved ones. */
  available?: string[]
  /** Rendered on the right, e.g. "8 of 40 packages". */
  summary?: string
  /** Folds the control away until asked for. */
  collapsible?: boolean
}

/**
 * Which GitHub organisations count as yours.
 *
 * One setting with two effects: it decides which packages become graph nodes,
 * and which rows the audit table shows. It sits above the results rather than
 * behind a header button because it changes what you are looking at — a control
 * that silently removes rows has no business being hidden.
 *
 * Selection is persisted, and `bhashacode` is what an unconfigured browser
 * starts with.
 */
export function OrgFilter({ available = [], summary, collapsible }: Props) {
  const { orgs, setOrgs } = useSession()
  const [draft, setDraft] = useState('')

  // Saved organisations always appear, even when the current input has none of
  // them — otherwise unchecking the last one would make it unreachable.
  const choices = [...new Set([...orgs, ...available.map((o) => o.toLowerCase())])].sort()
  const allSelected = choices.every((org) => orgs.includes(org))

  const toggle = (org: string) => {
    setOrgs(orgs.includes(org) ? orgs.filter((o) => o !== org) : [...orgs, org])
  }

  const body = (
    <>

      <ul className="org-chips" role="group" aria-label="Filter by organisation">
        {choices.map((org) => {
          const on = orgs.includes(org)
          return (
            <li key={org}>
              <button
                type="button"
                className="org-chip"
                aria-pressed={on}
                onClick={() => toggle(org)}
              >
                <span className="org-chip-box" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                {org}
              </button>
            </li>
          )
        })}
      </ul>

      {choices.length > 1 ? (
        <button
          type="button"
          className="btn btn-icon-text"
          disabled={allSelected}
          onClick={() => setOrgs(choices)}
        >
          Select all
        </button>
      ) : null}

      <form
        className="org-add"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return
          setOrgs([...orgs, draft])
          setDraft('')
        }}
      >
        <label className="sr-only" htmlFor="org-add-input">
          Add an organisation
        </label>
        <input
          id="org-add-input"
          value={draft}
          placeholder="add organisation"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="btn" disabled={!draft.trim()}>
          <FontAwesomeIcon icon={faPlus} aria-hidden="true" fixedWidth />
          Add
        </button>
      </form>

      {summary ? (
        <p className="org-summary" role="status">
          {summary}
        </p>
      ) : null}
    </>
  )

  if (!collapsible) {
    return (
      <div className="org-filter">
        <span className="micro">Organisations</span>
        {body}
      </div>
    )
  }

  return (
    <details className="org-details">
      <summary>
        <span className="micro">Organisations</span>
        <span className="mono">{orgs.join(', ')}</span>
      </summary>
      <div className="org-filter">{body}</div>
    </details>
  )
}
