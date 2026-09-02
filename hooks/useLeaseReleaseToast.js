// hooks/useLeaseReleaseToast.js
//
// CONCURRENCY PHASE 1c — spec §12. When the edit lease a viewer was waiting on is
// released, tell them editing is available — once, without an intrusive modal, and
// without re-firing on duplicate / no-op lease snapshots.

import { useEffect, useRef } from 'react';
import toast from '../lib/toast';

export function useLeaseReleaseToast(leaseStatus) {
  const prev = useRef(leaseStatus);
  useEffect(() => {
    if (prev.current === 'held' && leaseStatus === 'available') {
      toast.success('✅ This record is now available to edit.');
    }
    prev.current = leaseStatus;
  }, [leaseStatus]);
}
