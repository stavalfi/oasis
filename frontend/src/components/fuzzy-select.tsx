/**
 * fuzzy-select.tsx
 *
 * The single combobox used everywhere a user picks from a list (project,
 * assignee, and enum fields like priority). Wraps react-select for accessible
 * keyboard and mouse selection, and adds fuzzy matching with match-sorter so a
 * user can find an option by typing an approximate or out-of-order part of its
 * label (e.g. "plt" matches "Platform"). Centralizing it keeps every combobox
 * looking and behaving the same, and the built-in `isLoading` gives a spinner
 * while the options are still being fetched.
 */
import { matchSorter } from "match-sorter";
import type { ReactNode } from "react";
import Select from "react-select";

/** One selectable option: an opaque value plus the human label shown and searched. */
export interface FuzzySelectOption {
  value: string;
  label: string;
}

// Render the menu in a body-level portal with a high z-index, so it is never
// clipped by a card's overflow.
const MENU_PORTAL_Z_INDEX = 20;

export const FuzzySelect = ({
  options,
  value,
  onChange,
  inputId,
  placeholder = "Select or type to search…",
  isLoading = false,
  isClearable = false,
  isDisabled = false,
  noOptionsMessage = "No matches",
}: {
  options: FuzzySelectOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  inputId: string;
  placeholder?: string;
  isLoading?: boolean;
  isClearable?: boolean;
  isDisabled?: boolean;
  noOptionsMessage?: string;
}): ReactNode => {
  // react-select needs `null` (not undefined) for a controlled, empty value;
  // undefined would make it fall back to uncontrolled internal state.
  // eslint-disable-next-line unicorn/no-null
  const selectedOption = options.find((option) => option.value === value) ?? null;
  return (
    <Select<FuzzySelectOption>
      classNamePrefix="combobox"
      filterOption={(candidate, rawInput) =>
        rawInput.trim().length === 0 || matchSorter([candidate.label], rawInput).length > 0
      }
      inputId={inputId}
      isClearable={isClearable}
      isDisabled={isDisabled}
      isLoading={isLoading}
      menuPortalTarget={globalThis.document.body}
      noOptionsMessage={() => noOptionsMessage}
      onChange={(option) => onChange(option?.value)}
      options={options}
      placeholder={placeholder}
      styles={{ menuPortal: (base) => ({ ...base, zIndex: MENU_PORTAL_Z_INDEX }) }}
      value={selectedOption}
    />
  );
};
