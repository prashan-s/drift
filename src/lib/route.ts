import { useEffect, useState } from 'react'

export type Route = 'audit' | 'graph'

const ROUTES: Route[] = ['audit', 'graph']
const DEFAULT: Route = 'audit'

function read(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return (ROUTES as string[]).includes(hash) ? (hash as Route) : DEFAULT
}

/**
 * Hash routing, hand-rolled.
 *
 * Two views and no nested state does not justify a router dependency, and the
 * hash keeps both views linkable and survives a refresh — which is the only
 * thing a router would have bought here.
 */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(read)

  useEffect(() => {
    const sync = () => setRoute(read())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const go = (next: Route) => {
    window.location.hash = `/${next}`
    setRoute(next)
  }

  return [route, go]
}
