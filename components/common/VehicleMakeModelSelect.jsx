// components/common/VehicleMakeModelSelect.jsx
// The ONE production Vehicle Master component: Manufacturer → Model, using the shared
// MiniSelect and the shared lib/vehicleCatalog.js data everywhere. Consolidates what
// used to be three separately-written cascade wrappers (Job Cards' CascadeVehicleSelect,
// Vehicles' Cascade, and two inline MiniSelect pairs in Customers) that all reimplemented
// the identical Manufacturer→Model dependency rule by hand: Model is disabled until a
// Manufacturer is chosen, and options come from the same catalog. Enforcing that rule
// here, once, is what actually guarantees "users can never save an invalid
// Manufacturer → Model combination" — previously that guarantee depended on every call
// site's hand-written `disabled={!make}` staying correct independently.
//
// Deliberately does NOT own Variant: each caller's Variant field already has its own
// (slightly different, pre-existing) enable/clear rules — e.g. some clear Variant on a
// Model change, some don't — and unifying that would be a business-logic change, not a
// layout/duplication fix. Callers keep their own Variant field alongside this one.
//
// onPickMake / onPickModel are separate, explicit callbacks (not one combined onChange)
// so each caller decides exactly what a Manufacturer vs. a Model change does to ITS
// OWN other fields (Variant, a combined "vehicle" string, etc.) — this component only
// owns the Manufacturer→Model rule, not what happens around it.
import React from 'react';
import MiniSelect from './MiniSelect';
import { MAKES, VEHICLES } from '../../lib/vehicleCatalog';

export default function VehicleMakeModelSelect({
  make,
  model,
  onPickMake,
  onPickModel,
  makeOptions = MAKES,
  modelsFor = (m) => VEHICLES[m] || [],
  onAddMake,
  onAddModel,
  makeLabel,
  modelLabel,
  makeReq,
  modelReq,
  makePlaceholder = 'Manufacturer',
  modelPlaceholder = 'Model',
  modelDisabledPlaceholder = 'Select manufacturer first',
  className = 'grid grid-cols-2 gap-2',
  inputCls,
  // Optional (label, required, children) => JSX wrapper, matching each module's own
  // Field/WField component. Omitted entirely by callers that wrap the whole pair in
  // ONE external label themselves (e.g. Job Cards' single "Make & Model" Field).
  renderField,
  // Forwarded to both MiniSelects — see MiniSelect's own boundaryRef doc (Batch 4D).
  boundaryRef,
}) {
  const models = make ? modelsFor(make) : [];
  const wrap = renderField || ((label, req, children) => children);
  return (
    <div className={className}>
      {wrap(
        makeLabel,
        makeReq,
        <MiniSelect value={make || ''} placeholder={makePlaceholder} options={makeOptions} onPick={onPickMake} onAdd={onAddMake} inputCls={inputCls} boundaryRef={boundaryRef} />,
      )}
      {wrap(
        modelLabel,
        modelReq,
        <MiniSelect value={model || ''} placeholder={make ? modelPlaceholder : modelDisabledPlaceholder} options={models} disabled={!make} onPick={onPickModel} onAdd={onAddModel} inputCls={inputCls} boundaryRef={boundaryRef} />,
      )}
    </div>
  );
}
