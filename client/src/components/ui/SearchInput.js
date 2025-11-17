import React from "react";
import PropTypes from "prop-types";
import { Search, X } from "lucide-react";
import styles from "./SearchInput.module.css";

/**
 * SearchInput Component
 * Modern search input with icon and clear button
 */
const SearchInput = React.memo(function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  disabled = false,
  className = "",
  ...props
}) {
  const handleClear = (e) => {
    e.stopPropagation();
    onChange({ target: { value: "" } });
  };

  return (
    <div className={`${styles.searchContainer} ${className}`}>
      <div className={styles.searchWrapper}>
        <Search className={styles.searchIcon} size={18} />
        <input
          type="text"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className={styles.searchInput}
          {...props}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className={styles.clearButton}
            aria-label="Clear search"
            disabled={disabled}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
});

SearchInput.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  disabled: PropTypes.bool,
  className: PropTypes.string,
};

export default SearchInput;
