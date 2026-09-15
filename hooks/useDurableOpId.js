// hooks/useDurableOpId.js
//
// Phase 5b — React binding for lib/durableOpId. Gives a modal / form a business
// operation id that is stable within one intent AND survives a browser refresh of
// the tab (unlike the Phase 4b `useRef` id, which the reload destroyed).
//
//   const { opId, hadPending, clear } = useDurableOpId(`payment:${invoice.id}`, 'p');
//
//   - opId       : pass to the backend; its idempotency marker de-duplicates.
//   - hadPending : an id was already stored on mount => an earlier attempt on THIS
//                  exact intent did not confirm. Show a "check the record before
//                  retrying" notice; the retry is still safe (same opId).
//   - clear()    : call once the result is CONFIRMED (success, or a business
//                  rejection that definitely did not commit). Do NOT call on an
//                  ambiguous failure.
//
// The scope is read once, on first render, and pinned for the life of the
// component instance — the parent keys these modals per record, so a new intent
// remounts with a fresh scope read.
import { useRef } from 'react';
import { readOrCreateOpId, clearOpId, peekOpId } from '../lib/durableOpId';

export function useDurableOpId(scope, prefix = 'op') {
  const state = useRef(null);
  if (state.current === null) {
    const hadPending = !!peekOpId(scope);
    state.current = { scope, opId: readOrCreateOpId(scope, prefix), hadPending };
  }
  return {
    opId: state.current.opId,
    hadPending: state.current.hadPending,
    clear: () => clearOpId(state.current.scope),
  };
}
