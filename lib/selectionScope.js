/**
 * Shared selection → document-generation contract.
 *
 * Reference behaviour (components/jobcards/JobCardModule.jsx, JC 1.4): a row selection
 * is a Set of ids that deliberately survives search/filter changes — the same
 * cross-filter bulk-pick convention Inventory Parts, Customers, Vehicles and Billing
 * all already use. The bug this fixes: Print/PDF/bulk-action handlers that resolve the
 * selection by re-intersecting it with the CURRENTLY FILTERED list (`filtered.filter(id
 * => selectedIds.has(id))`) silently produce fewer records than the "N selected" badge
 * promises the moment a filter change hides some of them — the exact "20 selected -> PDF
 * -> 300 records" (or worse, "20 selected -> PDF -> 18 records", quietly) class of bug.
 *
 * Fix: always resolve a selection against the FULL record list (never the filtered
 * view), via an id lookup — same as Job Cards' `savedByJobNo`. A selected record that's
 * currently hidden by a filter is still included in what gets generated; it is
 * surfaced to the user as a count via countHiddenSelections, not silently dropped.
 */

export function resolveSelectedRecords(selectedIds, allRecords, getId) {
  if (!selectedIds || selectedIds.size === 0) return [];
  const byId = new Map(allRecords.map((r) => [getId(r), r]));
  const out = [];
  selectedIds.forEach((id) => {
    const r = byId.get(id);
    if (r) out.push(r);
  });
  return out;
}

/**
 * Count of selected ids absent from `visibleRecords` (the current search/filter
 * result). Surfaced next to the selection count as "(N not shown by current filters)"
 * so a filter change is visible instead of a silent gap — the selected records
 * themselves are NOT dropped from document generation because of it.
 */
export function countHiddenSelections(selectedIds, visibleRecords, getId) {
  if (!selectedIds || selectedIds.size === 0) return 0;
  const visibleIds = new Set(visibleRecords.map(getId));
  let n = 0;
  selectedIds.forEach((id) => { if (!visibleIds.has(id)) n += 1; });
  return n;
}
