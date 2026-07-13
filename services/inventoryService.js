// services/inventoryService.js
// Inventory business writes decoupled from UI/state. Pure category-mapping
// helpers plus the Firestore batch operations. Demo (in-memory) handling and
// toasts stay in the component; these functions own the persistence.
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

// A part belongs to `name` if its primary category matches or it appears in the
// categories array.
export const catMatches = (p, name) => p.category === name || (Array.isArray(p.categories) && p.categories.includes(name));

// Produce the field patch to remap a part from oldName → newName across both the
// scalar `category` and the `categories` array (deduped). Pure.
export const remapCatFields = (p, oldName, newName) => {
  const out = {};
  if (p.category === oldName) out.category = newName;
  if (Array.isArray(p.categories) && p.categories.includes(oldName)) {
    const mapped = p.categories.map((c) => (c === oldName ? newName : c));
    out.categories = mapped.filter((c, i, a) => a.indexOf(c) === i);
  }
  return out;
};

// Batch-rename a category across all affected parts (production).
export function renameCategoryDocs(affected, oldName, newName) {
  const batch = writeBatch(db);
  affected.forEach((p) => batch.update(doc(db, 'parts', p.id), { ...remapCatFields(p, oldName, newName), updatedAt: serverTimestamp() }));
  return batch.commit();
}

// Batch-delete a category by reassigning its parts to "Uncategorised" (production).
export function deleteCategoryDocs(affected, name) {
  const batch = writeBatch(db);
  affected.forEach((p) => batch.update(doc(db, 'parts', p.id), { ...remapCatFields(p, name, 'Uncategorised'), updatedAt: serverTimestamp() }));
  return batch.commit();
}
