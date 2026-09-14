// components/common/fieldStyles.js
//
// Dropdown/field design-consistency pass — the canonical trigger style for a
// full-size filter/picker field (native <select> and MiniSelect's own default
// trigger alike). Before this file existed, the exact same className string was
// independently retyped in 7 places (BillingModule, CustomersModule,
// RemindersModule, JobCardModule, VehiclesModule, DateTimeField, MiniSelect) —
// already byte-for-byte identical, so there was no actual visual inconsistency,
// but a real risk that one of the seven drifted the next time anyone touched the
// gold accent color or the corner radius and forgot the other six. One export,
// one place to change it.
export const FILTER_FIELD_CLS = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';
