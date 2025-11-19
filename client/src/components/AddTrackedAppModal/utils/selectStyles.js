/**
 * Custom styles for react-select to match existing design
 */

export const selectStyles = {
  control: (base, state) => ({
    ...base,
    border: `2px solid ${state.isFocused ? "var(--dodger-blue)" : "var(--border-color)"}`,
    borderRadius: "8px",
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
    boxShadow: "none",
    "&:hover": {
      borderColor: "var(--dodger-blue)",
    },
    outline: "none",
    "&:focus-within": {
      boxShadow: "none",
    },
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: "var(--bg-primary)",
    border: "2px solid var(--border-color)",
    borderRadius: "8px",
    zIndex: 9999,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused
      ? "var(--bg-secondary)"
      : state.isSelected
        ? "var(--dodger-blue)"
        : "var(--bg-primary)",
    color: state.isSelected ? "white" : "var(--text-primary)",
    "&:active": {
      backgroundColor: "var(--dodger-blue)",
    },
  }),
  input: (base, state) => ({
    ...base,
    color: "var(--text-primary)",
    margin: 0,
    padding: 0,
    "&:focus": {
      outline: "none",
      boxShadow: "none",
      border: "none",
    },
    "& input": {
      outline: "none !important",
      boxShadow: "none !important",
      border: "none !important",
    },
  }),
  valueContainer: (base, state) => ({
    ...base,
    padding: "2px 8px",
  }),
  singleValue: (base) => ({
    ...base,
    color: "var(--text-primary)",
  }),
  placeholder: (base, state) => ({
    ...base,
    color: "var(--text-tertiary)",
    opacity: state.isFocused ? 0 : 1,
    transition: "opacity 0.2s",
  }),
};
