import { blocksApproval, needsCheck } from './publish';
import { exportReadiness } from './readiness';

export const missingFields = blocksApproval;
export const unverifiedFields = item => (item?.guessed ?? []).filter(field => String(item?.[field] ?? '').trim());
// Complete fields and approval are separate steps. Only both make a CSV-ready item.
export const reviewFieldsComplete = item => !missingFields(item).length && !unverifiedFields(item).length;
export const exportReady = item => !needsCheck(item) && reviewFieldsComplete(item) && exportReadiness(item).ready;

export function selectExportRows(items, selected) {
  const picked = items.filter(i => selected.has(i.id));
  const rows = picked.filter(i => !needsCheck(i));
  return { picked, rows, notReady: rows.filter(i => !exportReady(i)).length };
}

// Toggle only the currently visible group; preserve choices in every other group.
export function toggleVisibleSelection(selected, visible) {
  const next = new Set(selected);
  const clear = visible.length > 0 && visible.every(item => next.has(item.id));
  for (const item of visible) clear ? next.delete(item.id) : next.add(item.id);
  return next;
}
