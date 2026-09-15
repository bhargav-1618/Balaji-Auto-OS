import React from 'react';

/**
 * DetailHero — the ONE hero/media block rendered at the top of every details panel
 * (Vehicle Details, Customer Details, …).
 *
 * Why this exists: Vehicles and Customers each carried their own copy of this block.
 * The two copies happened to be written identically, but duplicated markup is exactly
 * how panels drift apart — one gets a tweak, the other doesn't, and the panels stop
 * matching. There is now a single implementation of the box (size, radius, background
 * tint) and a single placeholder treatment (icon size + opacity), so the two panels
 * render the same hero by construction rather than by coincidence.
 *
 * Entities that carry images (vehicles) pass `photos`; entities that don't (customers)
 * simply render the placeholder. Both paths keep identical box geometry so the panel
 * layout never shifts between them.
 */
export default function DetailHero({
  icon: Icon,
  photos = [],
  coverPhoto = 0,
  alt = '',
  className = '',
}) {
  const list = Array.isArray(photos) ? photos.filter(Boolean) : [];

  if (list.length > 0) {
    return (
      <img
        src={list[coverPhoto] || list[0]}
        alt={alt}
        className={`w-full h-36 rounded-xl object-cover mb-2 ${className}`}
      />
    );
  }

  return (
    <div
      className={`w-full h-36 rounded-xl flex items-center justify-center mb-2 ${className}`}
      style={{ background: 'rgba(212,175,55,0.06)' }}
    >
      {Icon ? <Icon size={30} className="text-[#d4af37]/50" /> : null}
    </div>
  );
}
