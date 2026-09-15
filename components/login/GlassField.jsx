import { forwardRef } from 'react';
import styles from '../../styles/login.module.css';

/**
 * Reusable glass field: label + icon + input, with the gold focus ring.
 * Deliberately generic — this is the primitive the in-app forms could later adopt.
 * It carries NO auth logic; value/onChange come from the parent.
 */
const GlassField = forwardRef(function GlassField(
  { id, label, icon, type = 'text', value, onChange, placeholder, autoComplete, trailing, ...rest },
  ref,
) {
  return (
    <div className={styles.fieldWrap}>
      <label htmlFor={id} className={styles.fieldLabel}>{label}</label>
      <div style={{ position: 'relative' }}>
        {icon && <span className={styles.fieldIcon}>{icon}</span>}
        <input
          ref={ref}
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={styles.field}
          {...rest}
        />
        {trailing}
      </div>
    </div>
  );
});

export default GlassField;
