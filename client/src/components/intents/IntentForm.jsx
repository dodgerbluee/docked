/**
 * IntentForm Component
 * Form for creating/editing an intent
 */

import React, { useState, useCallback, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import cronstrue from "cronstrue";
import { Plus, X, Box, LaptopMinimalCheck, Layers, Globe, Zap, Clock } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import PortainerIcon from "../icons/PortainerIcon";
import {
  SCHEDULE_TYPES,
  SCHEDULE_TYPE_LABELS,
  CRON_PRESETS,
  DEFAULT_INTENT_FORM,
  MATCH_TYPES,
  MATCH_TYPE_LABELS,
  MATCH_TYPE_PLACEHOLDERS,
  MATCH_TYPE_HELPERS,
} from "../../constants/intents";
import styles from "./IntentForm.module.css";

/** Icon map for match type buttons */
const MATCH_TYPE_ICONS = {
  [MATCH_TYPES.CONTAINERS]: Box,
  [MATCH_TYPES.IMAGES]: LaptopMinimalCheck,
  [MATCH_TYPES.STACKS]: Layers,
  [MATCH_TYPES.INSTANCES]: PortainerIcon,
  [MATCH_TYPES.REGISTRIES]: Globe,
};

/** Icon map for schedule type buttons */
const SCHEDULE_TYPE_ICONS = {
  [SCHEDULE_TYPES.IMMEDIATE]: Zap,
  [SCHEDULE_TYPES.SCHEDULED]: Clock,
};

/**
 * Build suggestion lists for each match type from container/instance data
 */
function useSuggestions(containers, portainerInstances) {
  return useMemo(() => {
    const containerNames = new Set();
    const imagePatterns = new Set();
    const stackNames = new Set();
    const registries = new Set();
    const instanceNames = new Set();

    if (containers && containers.length > 0) {
      for (const c of containers) {
        if (c.name) containerNames.add(c.name);
        if (c.image) imagePatterns.add(c.image);
        if (c.stackName) stackNames.add(c.stackName);
        if (c.image) {
          const parts = c.image.split("/");
          if (parts.length >= 2 && parts[0].includes(".")) {
            registries.add(parts[0]);
          }
        }
      }
    }

    if (portainerInstances && portainerInstances.length > 0) {
      for (const inst of portainerInstances) {
        if (inst.name) instanceNames.add(inst.name);
      }
    }

    return {
      [MATCH_TYPES.CONTAINERS]: [...containerNames].sort(),
      [MATCH_TYPES.IMAGES]: [...imagePatterns].sort(),
      [MATCH_TYPES.STACKS]: [...stackNames].sort(),
      [MATCH_TYPES.REGISTRIES]: [...registries].sort(),
      [MATCH_TYPES.INSTANCES]: [...instanceNames].sort(),
    };
  }, [containers, portainerInstances]);
}

/**
 * Build a name↔ID map for portainer instances
 */
function usePortainerNameIdMap(portainerInstances) {
  return useMemo(() => {
    const nameToId = new Map();
    const idToName = new Map();
    if (portainerInstances && portainerInstances.length > 0) {
      for (const inst of portainerInstances) {
        if (inst.name && inst.id != null) {
          nameToId.set(inst.name, String(inst.id));
          idToName.set(String(inst.id), inst.name);
        }
      }
    }
    return { nameToId, idToName };
  }, [portainerInstances]);
}

/**
 * Determine which match type an existing intent uses (for editing)
 */
function detectMatchType(initialData) {
  if (initialData?.matchContainers?.length > 0) return MATCH_TYPES.CONTAINERS;
  if (initialData?.matchImages?.length > 0) return MATCH_TYPES.IMAGES;
  if (initialData?.matchStacks?.length > 0) return MATCH_TYPES.STACKS;
  if (initialData?.matchRegistries?.length > 0) return MATCH_TYPES.REGISTRIES;
  if (initialData?.matchInstances?.length > 0) return MATCH_TYPES.INSTANCES;
  return MATCH_TYPES.CONTAINERS;
}

/**
 * Get the match values for the detected type from initial data
 */
function getMatchValues(initialData, matchType, idToName) {
  if (!initialData) return [];
  const fieldMap = {
    [MATCH_TYPES.CONTAINERS]: initialData.matchContainers,
    [MATCH_TYPES.IMAGES]: initialData.matchImages,
    [MATCH_TYPES.STACKS]: initialData.matchStacks,
    [MATCH_TYPES.REGISTRIES]: initialData.matchRegistries,
    [MATCH_TYPES.INSTANCES]: initialData.matchInstances,
  };
  const values = fieldMap[matchType] || [];
  // Convert portainer instance IDs to names for display
  if (matchType === MATCH_TYPES.INSTANCES) {
    return values.map((id) => idToName.get(String(id)) || String(id));
  }
  return values;
}

/**
 * Convert a simple glob pattern to a RegExp (client-side mirror of server's globToRegex).
 * Supports * (any chars) and ? (single char). Case-insensitive.
 */
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const globbed = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${globbed}$`, "i");
}

/**
 * Check if a string is a glob pattern (contains * or ?)
 */
function isGlobPattern(value) {
  return value.includes("*") || value.includes("?");
}

/**
 * Find all suggestions that match a glob pattern
 */
function findGlobMatches(pattern, suggestions) {
  try {
    const regex = globToRegex(pattern);
    return suggestions.filter((s) => regex.test(s));
  } catch {
    return [];
  }
}

/**
 * Dropdown that shows all options on focus, filters as user types.
 * Supports glob patterns: if input contains * or ?, shows glob matches.
 */
const OptionsDropdown = React.memo(function OptionsDropdown({
  suggestions,
  inputValue,
  existingValues,
  onSelect,
  visible,
}) {
  const filtered = useMemo(() => {
    if (!visible) return [];
    const trimmed = inputValue.trim();

    let matches;
    if (trimmed === "") {
      // Empty input: show all suggestions not already added
      matches = suggestions.filter((s) => !existingValues.includes(s));
    } else if (isGlobPattern(trimmed)) {
      // Glob pattern: show items matching the glob
      matches = findGlobMatches(trimmed, suggestions).filter((s) => !existingValues.includes(s));
    } else {
      // Substring filter
      const lower = trimmed.toLowerCase();
      matches = suggestions.filter(
        (s) => !existingValues.includes(s) && s.toLowerCase().includes(lower)
      );
    }

    return matches.slice(0, 15);
  }, [suggestions, inputValue, existingValues, visible]);

  if (filtered.length === 0) return null;

  return (
    <div className={styles.dropdown}>
      {filtered.map((item) => (
        <button
          key={item}
          type="button"
          className={styles.dropdownItem}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item);
          }}
        >
          {item}
        </button>
      ))}
    </div>
  );
});

OptionsDropdown.propTypes = {
  suggestions: PropTypes.arrayOf(PropTypes.string).isRequired,
  inputValue: PropTypes.string.isRequired,
  existingValues: PropTypes.arrayOf(PropTypes.string).isRequired,
  onSelect: PropTypes.func.isRequired,
  visible: PropTypes.bool.isRequired,
};

/**
 * Match criteria: type selector buttons + single input + tags
 * When a glob pattern is added, it also resolves and displays matched items.
 */
const MatchCriteriaInput = React.memo(function MatchCriteriaInput({
  matchType,
  matchValues,
  onChangeType,
  onChangeValues,
  suggestions,
}) {
  const [inputValue, setInputValue] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef(null);
  const blurTimeoutRef = useRef(null);
  const wrapperRef = useRef(null);

  /**
   * On mobile, when the virtual keyboard opens it halves the visible viewport.
   * Scroll the input wrapper to the top of its scroll container so the
   * absolutely-positioned suggestions dropdown has room below the input.
   */
  const scrollInputIntoView = useCallback(() => {
    if (window.innerWidth > 768 || !wrapperRef.current) return;
    // Small delay lets the keyboard animation begin so scroll target is accurate
    setTimeout(() => {
      wrapperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, []);

  const currentSuggestions = suggestions[matchType] || [];

  // Compute which match values are glob patterns and their resolved matches
  const resolvedMatches = useMemo(() => {
    const map = new Map();
    for (const val of matchValues) {
      if (isGlobPattern(val)) {
        map.set(val, findGlobMatches(val, currentSuggestions));
      }
    }
    return map;
  }, [matchValues, currentSuggestions]);

  const addTag = useCallback(
    (value) => {
      const trimmed = (value || inputValue).trim();
      if (trimmed && !matchValues.includes(trimmed)) {
        onChangeValues([...matchValues, trimmed]);
      }
      setInputValue("");
      setShowDropdown(false);
      inputRef.current?.focus();
    },
    [inputValue, matchValues, onChangeValues]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        if (inputValue.trim()) addTag();
      }
    },
    [inputValue, addTag]
  );

  const removeTag = useCallback(
    (index) => {
      onChangeValues(matchValues.filter((_, i) => i !== index));
    },
    [matchValues, onChangeValues]
  );

  const handleTypeChange = useCallback(
    (type) => {
      // Cancel any pending blur timeout so dropdown stays open
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      onChangeType(type);
      setInputValue("");
      setShowDropdown(true);
      inputRef.current?.focus();
    },
    [onChangeType]
  );

  return (
    <div className={styles.matchCriteria}>
      {/* Type selector buttons */}
      <div className={styles.matchTypeToggle}>
        {Object.values(MATCH_TYPES).map((type) => {
          const Icon = MATCH_TYPE_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              className={`${styles.matchTypeButton} ${matchType === type ? styles.matchTypeActive : ""}`}
              onClick={() => handleTypeChange(type)}
            >
              {Icon && <Icon size={14} />}
              {MATCH_TYPE_LABELS[type]}
            </button>
          );
        })}
      </div>

      {/* Input field with dropdown */}
      <div className={styles.inputArea}>
        <div className={styles.tagInputWrapper} ref={wrapperRef}>
          <div className={styles.tagInputRow}>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => {
                setShowDropdown(true);
                scrollInputIntoView();
              }}
              onBlur={() => {
                blurTimeoutRef.current = setTimeout(() => setShowDropdown(false), 150);
              }}
              onKeyDown={handleKeyDown}
              placeholder={MATCH_TYPE_PLACEHOLDERS[matchType]}
              className={styles.tagInput}
            />
            <button
              type="button"
              className={styles.tagAddButton}
              onClick={() => addTag()}
              disabled={!inputValue.trim()}
              aria-label="Add"
            >
              <Plus size={14} />
            </button>
          </div>
          <OptionsDropdown
            suggestions={currentSuggestions}
            inputValue={inputValue}
            existingValues={matchValues}
            onSelect={addTag}
            visible={showDropdown}
          />
        </div>
        <span className={styles.helperText}>{MATCH_TYPE_HELPERS[matchType]}</span>
      </div>

      {/* Display tags */}
      {matchValues.length > 0 && (
        <div className={styles.tagsSection}>
          {matchValues.map((val, i) => {
            const isGlob = isGlobPattern(val);
            const matches = isGlob ? resolvedMatches.get(val) || [] : [];
            return (
              <div key={i} className={styles.tagGroup}>
                <span className={`${styles.tag} ${isGlob ? styles.tagGlob : ""}`}>
                  {val}
                  <button
                    type="button"
                    className={styles.tagRemove}
                    onClick={() => removeTag(i)}
                    aria-label={`Remove ${val}`}
                  >
                    <X size={12} />
                  </button>
                </span>
                {isGlob && matches.length > 0 && (
                  <div className={styles.globMatches}>
                    {matches.map((m) => (
                      <span key={m} className={styles.globMatchTag}>
                        {m}
                      </span>
                    ))}
                  </div>
                )}
                {isGlob && matches.length === 0 && (
                  <span className={styles.globNoMatches}>No current matches</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

MatchCriteriaInput.propTypes = {
  matchType: PropTypes.string.isRequired,
  matchValues: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChangeType: PropTypes.func.isRequired,
  onChangeValues: PropTypes.func.isRequired,
  suggestions: PropTypes.object.isRequired,
};

/**
 * IntentForm component
 */
const IntentForm = React.memo(function IntentForm({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting,
  containers = [],
  portainerInstances = [],
}) {
  const isEditing = !!initialData?.id;
  const { nameToId, idToName } = usePortainerNameIdMap(portainerInstances);
  const suggestions = useSuggestions(containers, portainerInstances);

  const [formData, setFormData] = useState(() => {
    if (initialData) {
      const matchType = detectMatchType(initialData);
      const matchValues = getMatchValues(initialData, matchType, idToName);
      return {
        name: initialData.name || "",
        enabled: initialData.enabled !== undefined ? Boolean(initialData.enabled) : true,
        matchType,
        matchValues,
        scheduleType: initialData.scheduleType || SCHEDULE_TYPES.IMMEDIATE,
        scheduleCron: initialData.scheduleCron || "",
        dryRun: initialData.dryRun !== undefined ? Boolean(initialData.dryRun) : true,
      };
    }
    return { ...DEFAULT_INTENT_FORM };
  });

  const [formError, setFormError] = useState("");

  // Compute human-readable cron description
  const cronDescription = useMemo(() => {
    const raw = formData.scheduleCron.trim();
    if (!raw) return { text: "Enter a cron expression", isError: false };
    try {
      const text = cronstrue.toString(raw, {
        use24HourTimeFormat: false,
        verbose: false,
      });
      return { text, isError: false };
    } catch {
      return { text: "Invalid cron expression", isError: true };
    }
  }, [formData.scheduleCron]);

  const updateField = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setFormError("");
  }, []);

  // When changing match type, clear the values
  const handleMatchTypeChange = useCallback((newType) => {
    setFormData((prev) => ({
      ...prev,
      matchType: newType,
      matchValues: [],
    }));
    setFormError("");
  }, []);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setFormError("");

      if (!formData.name.trim()) {
        setFormError("Name is required");
        return;
      }

      if (formData.scheduleType === SCHEDULE_TYPES.SCHEDULED && !formData.scheduleCron.trim()) {
        setFormError("Cron expression is required for scheduled intents");
        return;
      }

      // Build the submit payload — map the single matchType + matchValues
      // into the correct server field, leaving the others empty
      let matchValues = formData.matchValues;

      // Convert portainer instance names back to IDs for the server
      if (formData.matchType === MATCH_TYPES.INSTANCES) {
        matchValues = matchValues.map((name) => {
          const id = nameToId.get(name);
          return id || name;
        });
      }

      const submitData = {
        name: formData.name,
        enabled: formData.enabled,
        matchContainers: formData.matchType === MATCH_TYPES.CONTAINERS ? matchValues : [],
        matchImages: formData.matchType === MATCH_TYPES.IMAGES ? matchValues : [],
        matchStacks: formData.matchType === MATCH_TYPES.STACKS ? matchValues : [],
        matchRegistries: formData.matchType === MATCH_TYPES.REGISTRIES ? matchValues : [],
        matchInstances: formData.matchType === MATCH_TYPES.INSTANCES ? matchValues : [],
        scheduleType: formData.scheduleType,
        scheduleCron: formData.scheduleCron,
        dryRun: formData.dryRun,
      };

      const result = await onSubmit(submitData);
      if (result && !result.success) {
        setFormError(result.error || "An error occurred");
      }
    },
    [formData, onSubmit, nameToId]
  );

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {formError && <div className={styles.formError}>{formError}</div>}

      {/* Name */}
      <Input
        label="Name"
        value={formData.name}
        onChange={(e) => updateField("name", e.target.value)}
        placeholder="e.g., Upgrade all nginx containers"
        required
        maxLength={100}
      />

      {/* Match criteria */}
      <div className={styles.formGroup}>
        <label className={styles.label}>Match Criteria</label>
        <span className={styles.helperText}>
          Select a match type and add entries to filter which containers this intent applies to.
        </span>
        <MatchCriteriaInput
          matchType={formData.matchType}
          matchValues={formData.matchValues}
          onChangeType={handleMatchTypeChange}
          onChangeValues={(values) => updateField("matchValues", values)}
          suggestions={suggestions}
        />
      </div>

      {/* Schedule */}
      <div className={styles.formGroup}>
        <label className={styles.label}>Schedule Type</label>
        <div className={styles.scheduleTypeButtons}>
          {Object.entries(SCHEDULE_TYPE_LABELS).map(([value, label]) => {
            const Icon = SCHEDULE_TYPE_ICONS[value];
            return (
              <button
                key={value}
                type="button"
                className={`${styles.scheduleTypeButton} ${
                  formData.scheduleType === value ? styles.scheduleTypeActive : ""
                }`}
                onClick={() => updateField("scheduleType", value)}
              >
                {Icon && <Icon size={15} />}
                {label}
              </button>
            );
          })}
        </div>
        {formData.scheduleType === SCHEDULE_TYPES.IMMEDIATE && (
          <span className={styles.helperText}>
            When an update is detected during a scan, matched containers will be upgraded
            automatically.
          </span>
        )}
        {formData.scheduleType === SCHEDULE_TYPES.SCHEDULED && (
          <span className={styles.helperText}>
            Matched containers will be checked and upgraded on the specified cron schedule.
          </span>
        )}
      </div>

      {formData.scheduleType === SCHEDULE_TYPES.SCHEDULED && (
        <div className={styles.formGroup}>
          <label className={styles.label}>Cron Expression</label>
          <div className={styles.cronRow}>
            <Input
              value={formData.scheduleCron}
              onChange={(e) => updateField("scheduleCron", e.target.value)}
              placeholder="e.g., 0 0 * * *"
              required
              className={styles.cronInput}
            />
            <span
              className={`${styles.cronDescription} ${
                cronDescription.isError ? styles.cronError : ""
              }`}
            >
              {cronDescription.text}
            </span>
          </div>
          <div className={styles.cronPresets}>
            <span className={styles.presetLabel}>Presets:</span>
            {CRON_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={`${styles.presetButton} ${
                  formData.scheduleCron === preset.value ? styles.presetButtonActive : ""
                }`}
                onClick={() => updateField("scheduleCron", preset.value)}
                title={preset.value}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dry Run toggle */}
      <div className={styles.toggleGroup}>
        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={formData.dryRun}
            onChange={(e) => updateField("dryRun", e.target.checked)}
            className={styles.toggleCheckbox}
          />
          <span className={styles.toggleTrack} aria-hidden="true">
            <span className={styles.toggleKnob} />
          </span>
          <span>Dry Run Mode</span>
        </label>
        <span className={styles.helperText}>
          When enabled, matched containers will be logged but not actually upgraded
        </span>
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="outline"
          disabled={isSubmitting}
          className={styles.submitButton}
        >
          {isSubmitting
            ? isEditing
              ? "Updating..."
              : "Creating..."
            : isEditing
              ? "Update Intent"
              : "Create Intent"}
        </Button>
      </div>
    </form>
  );
});

IntentForm.propTypes = {
  initialData: PropTypes.object,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool,
  containers: PropTypes.array,
  portainerInstances: PropTypes.array,
};

export default IntentForm;
