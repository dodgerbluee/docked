import React, { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Button from "../ui/Button";
import styles from "./ContainerBlocklist.module.css";

/**
 * ContainerBlocklist
 * Dual-panel transfer component for managing the upgrade blocklist.
 * Left = allowed (can be upgraded), Right = disallowed (blocked from upgrade).
 *
 * Each container instance is shown as a separate card.
 * Blocking is name-based: transferring one nginx moves ALL nginx instances.
 * Saving deduplicates by name.
 */
function ContainerBlocklist({ containers = [] }) {
  const [loading, setLoading] = useState(true);
  const [allowedList, setAllowedList] = useState([]);
  const [disallowedList, setDisallowedList] = useState([]);
  const [allowedSearch, setAllowedSearch] = useState("");
  const [disallowedSearch, setDisallowedSearch] = useState("");
  const [selectedAllowed, setSelectedAllowed] = useState(new Set()); // Set of ids
  const [selectedDisallowed, setSelectedDisallowed] = useState(new Set()); // Set of ids
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [manualAddName, setManualAddName] = useState("");
  const saveMessageTimer = useRef(null);

  /**
   * Build a flat list of container entries, one per container instance.
   * Uses container.id as the unique key (falls back to name+instance if no id).
   */
  const buildEntries = useCallback(() => {
    const entries = [];
    const seenIds = new Set();
    for (const c of containers) {
      const name = (c.name || "").replace(/^\//, "");
      if (!name) continue;
      const id = c.id || `${name}__${c.portainerName || ""}__${c.stackName || ""}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      entries.push({
        id,
        name,
        image: c.image || c.imageName || "",
        instance: c.portainerName || "",
        stackName: c.stackName || "",
        portainerUrl: !!c.portainerUrl,
      });
    }
    // Sort: by name, then by instance
    entries.sort((a, b) => {
      const nameCmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return nameCmp !== 0 ? nameCmp : a.instance.toLowerCase().localeCompare(b.instance.toLowerCase());
    });
    return entries;
  }, [containers]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data } = await axios.get(`${API_BASE_URL}/api/settings/disallowed-containers`);
        if (cancelled) return;

        const entries = buildEntries();

        // Build a map of name → whether ANY container with that name has portainerUrl
        const nameHasPortainer = new Map();
        for (const e of entries) {
          const key = e.name.toLowerCase();
          if (!nameHasPortainer.has(key)) nameHasPortainer.set(key, false);
          if (e.portainerUrl) nameHasPortainer.set(key, true);
        }

        let disallowedNameSet; // Set<string> of lowercase names
        if (data.containers === null) {
          // Never saved — compute defaults:
          // 1. Block names where no instance has a portainerUrl
          // 2. Block names whose image matches known infra patterns
          const patterns = data.defaultPatterns || ["portainer", "docked", "nginx-proxy-manager"];
          disallowedNameSet = new Set();
          for (const e of entries) {
            const key = e.name.toLowerCase();
            if (disallowedNameSet.has(key)) continue;
            if (!nameHasPortainer.get(key)) {
              disallowedNameSet.add(key);
            } else if (patterns.some((p) => e.image.toLowerCase().includes(p))) {
              disallowedNameSet.add(key);
            }
          }
        } else {
          // Saved list — also auto-add non-Portainer container names not already saved
          const savedNames = new Set((data.containers || []).map((n) => n.toLowerCase()));
          disallowedNameSet = new Set(savedNames);
          for (const [key, hasPortainer] of nameHasPortainer) {
            if (!hasPortainer && !savedNames.has(key)) {
              disallowedNameSet.add(key);
            }
          }
        }

        const allowed = entries.filter((e) => !disallowedNameSet.has(e.name.toLowerCase()));
        const disallowed = entries
          .filter((e) => disallowedNameSet.has(e.name.toLowerCase()))
          .map((e) => ({ ...e, orphan: false, notPortainer: !e.portainerUrl }));

        // Add orphans: saved names with no matching live container
        for (const n of disallowedNameSet) {
          const hasLive = entries.some((e) => e.name.toLowerCase() === n);
          if (!hasLive) {
            disallowed.push({
              id: `orphan:${n}`,
              name: n,
              image: "",
              instance: "",
              stackName: "",
              portainerUrl: false,
              orphan: true,
              notPortainer: false,
            });
          }
        }

        setAllowedList(allowed);
        setDisallowedList(disallowed);
      } catch (err) {
        console.error("Failed to load disallowed containers:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [buildEntries]);

  const filteredAllowed = allowedSearch
    ? allowedList.filter(
        (c) =>
          c.name.toLowerCase().includes(allowedSearch.toLowerCase()) ||
          c.image.toLowerCase().includes(allowedSearch.toLowerCase()) ||
          c.instance.toLowerCase().includes(allowedSearch.toLowerCase()) ||
          c.stackName.toLowerCase().includes(allowedSearch.toLowerCase())
      )
    : allowedList;

  const filteredDisallowed = disallowedSearch
    ? disallowedList.filter(
        (c) =>
          c.name.toLowerCase().includes(disallowedSearch.toLowerCase()) ||
          (c.image || "").toLowerCase().includes(disallowedSearch.toLowerCase()) ||
          (c.instance || "").toLowerCase().includes(disallowedSearch.toLowerCase()) ||
          (c.stackName || "").toLowerCase().includes(disallowedSearch.toLowerCase())
      )
    : disallowedList;

  const toggleAllowedSelection = useCallback((id) => {
    setSelectedAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleDisallowedSelection = useCallback((id) => {
    setSelectedDisallowed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleKeyDownAllowed = useCallback(
    (e, id) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleAllowedSelection(id);
      }
    },
    [toggleAllowedSelection]
  );

  const handleKeyDownDisallowed = useCallback(
    (e, id) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleDisallowedSelection(id);
      }
    },
    [toggleDisallowedSelection]
  );

  // Move selected from allowed → disallowed.
  // Moves ALL containers sharing the same name (since blocking is name-based).
  const moveToDisallowed = useCallback(() => {
    if (selectedAllowed.size === 0) return;
    const namesToBlock = new Set(
      allowedList
        .filter((c) => selectedAllowed.has(c.id))
        .map((c) => c.name.toLowerCase())
    );
    const moving = allowedList.filter((c) => namesToBlock.has(c.name.toLowerCase()));
    setAllowedList((prev) => prev.filter((c) => !namesToBlock.has(c.name.toLowerCase())));
    setDisallowedList((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const toAdd = moving
        .filter((c) => !existingIds.has(c.id))
        .map((c) => ({ ...c, orphan: false }));
      return [...prev, ...toAdd];
    });
    setSelectedAllowed(new Set());
  }, [selectedAllowed, allowedList]);

  // Move selected from disallowed → allowed.
  // Moves ALL containers sharing the same name.
  const moveToAllowed = useCallback(() => {
    if (selectedDisallowed.size === 0) return;
    const namesToUnblock = new Set(
      disallowedList
        .filter((c) => selectedDisallowed.has(c.id))
        .map((c) => c.name.toLowerCase())
    );
    const moving = disallowedList.filter(
      (c) => !c.orphan && namesToUnblock.has(c.name.toLowerCase())
    );
    setDisallowedList((prev) => prev.filter((c) => !namesToUnblock.has(c.name.toLowerCase())));
    setAllowedList((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const toAdd = moving
        .filter((c) => !existingIds.has(c.id))
        .map(({ id, name, image, instance, stackName, portainerUrl }) => ({
          id, name, image, instance, stackName, portainerUrl,
        }));
      return [...prev, ...toAdd];
    });
    setSelectedDisallowed(new Set());
  }, [selectedDisallowed, disallowedList]);

  // Block all
  const blockAll = useCallback(() => {
    setDisallowedList((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const toAdd = allowedList
        .filter((c) => !existingIds.has(c.id))
        .map((c) => ({ ...c, orphan: false }));
      return [...prev, ...toAdd];
    });
    setAllowedList([]);
    setSelectedAllowed(new Set());
  }, [allowedList]);

  // Unblock all
  const unblockAll = useCallback(() => {
    setAllowedList((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const toAdd = disallowedList
        .filter((c) => !c.orphan && !existingIds.has(c.id))
        .map(({ id, name, image, instance, stackName, portainerUrl }) => ({
          id, name, image, instance, stackName, portainerUrl,
        }));
      return [...prev, ...toAdd];
    });
    setDisallowedList([]);
    setSelectedDisallowed(new Set());
  }, [disallowedList]);

  // Manually add a container by name to blocked list
  const handleManualAdd = useCallback(() => {
    const name = manualAddName.trim();
    if (!name) return;
    const id = `orphan:${name.toLowerCase()}`;
    setDisallowedList((prev) => {
      if (prev.some((c) => c.name.toLowerCase() === name.toLowerCase())) return prev;
      return [...prev, {
        id,
        name,
        image: "",
        instance: "",
        stackName: "",
        portainerUrl: false,
        orphan: true,
        notPortainer: false,
      }];
    });
    setManualAddName("");
  }, [manualAddName]);

  const handleManualAddKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleManualAdd();
      }
    },
    [handleManualAdd]
  );

  const showSaveMessage = (type, text) => {
    setSaveMessage({ type, text });
    if (saveMessageTimer.current) clearTimeout(saveMessageTimer.current);
    saveMessageTimer.current = setTimeout(() => setSaveMessage(null), 3500);
  };

  // Save: deduplicate names before sending
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const containerNames = [...new Set(disallowedList.map((c) => c.name))];
      await axios.put(`${API_BASE_URL}/api/settings/disallowed-containers`, {
        containers: containerNames,
      });
      showSaveMessage("success", "Blocklist saved successfully");
    } catch (err) {
      showSaveMessage(
        "error",
        err.response?.data?.error || "Failed to save blocklist"
      );
    } finally {
      setSaving(false);
    }
  }, [disallowedList]);

  // Unique blocked name count (for the badge)
  const blockedNameCount = new Set(disallowedList.map((c) => c.name.toLowerCase())).size;

  if (loading) {
    return <div className={styles.loadingState}>Loading containers...</div>;
  }

  return (
    <div>
      <div className={styles.wrapper}>
        {/* Left panel: Available (allowed) */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Available</span>
            <span className={styles.countBadge}>{allowedList.length}</span>
          </div>
          <div className={styles.searchBar}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search containers..."
              value={allowedSearch}
              onChange={(e) => setAllowedSearch(e.target.value)}
            />
          </div>
          <div className={styles.containerList}>
            {filteredAllowed.length === 0 ? (
              <div className={styles.emptyList}>No containers</div>
            ) : (
              filteredAllowed.map((c) => {
                const isSelected = selectedAllowed.has(c.id);
                return (
                  <div
                    key={c.id}
                    className={`${styles.containerCard} ${isSelected ? styles.selected : ""}`}
                    onClick={() => toggleAllowedSelection(c.id)}
                    onKeyDown={(e) => handleKeyDownAllowed(e, c.id)}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                  >
                    <span className={styles.containerName}>{c.name}</span>
                    {c.image && <span className={styles.containerImage}>{c.image}</span>}
                    {(c.instance || c.stackName) && (
                      <div className={styles.cardFooter}>
                        {c.instance && (
                          <span className={styles.instanceBadge}>{c.instance}</span>
                        )}
                        {c.stackName && c.stackName !== "Standalone" && (
                          <span className={styles.stackBadge}>{c.stackName}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Transfer buttons */}
        <div className={styles.transferButtons}>
          <button
            className={styles.transferBtn}
            title="Block selected"
            onClick={moveToDisallowed}
            disabled={selectedAllowed.size === 0}
            type="button"
          >
            &gt;
          </button>
          <button
            className={styles.transferBtn}
            title="Unblock selected"
            onClick={moveToAllowed}
            disabled={selectedDisallowed.size === 0}
            type="button"
          >
            &lt;
          </button>
          <button
            className={styles.transferBtn}
            title="Block all"
            onClick={blockAll}
            disabled={allowedList.length === 0}
            type="button"
          >
            &gt;&gt;
          </button>
          <button
            className={styles.transferBtn}
            title="Unblock all"
            onClick={unblockAll}
            disabled={disallowedList.length === 0}
            type="button"
          >
            &lt;&lt;
          </button>
        </div>

        {/* Right panel: Disallowed (blocked) */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Blocked</span>
            <span className={styles.countBadge}>{blockedNameCount}</span>
          </div>
          <div className={styles.searchBar}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search containers..."
              value={disallowedSearch}
              onChange={(e) => setDisallowedSearch(e.target.value)}
            />
          </div>
          <div className={styles.containerList}>
            {filteredDisallowed.length === 0 ? (
              <div className={styles.emptyList}>No blocked containers</div>
            ) : (
              filteredDisallowed.map((c) => {
                const isSelected = selectedDisallowed.has(c.id);
                return (
                  <div
                    key={c.id}
                    className={`${styles.containerCard} ${isSelected ? styles.selected : ""}`}
                    onClick={() => toggleDisallowedSelection(c.id)}
                    onKeyDown={(e) => handleKeyDownDisallowed(e, c.id)}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                  >
                    <span className={styles.containerName}>{c.name}</span>
                    {c.image && <span className={styles.containerImage}>{c.image}</span>}
                    <div className={styles.cardFooter}>
                      {c.instance && (
                        <span className={styles.instanceBadge}>{c.instance}</span>
                      )}
                      {c.stackName && c.stackName !== "Standalone" && (
                        <span className={styles.stackBadge}>{c.stackName}</span>
                      )}
                      {c.notPortainer && !c.orphan && (
                        <span className={styles.notPortainerBadge}>not in Portainer</span>
                      )}
                      {c.orphan && (
                        <span className={styles.orphanBadge}>offline</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className={styles.manualAddRow}>
            <input
              className={styles.manualAddInput}
              type="text"
              placeholder="Block by name..."
              value={manualAddName}
              onChange={(e) => setManualAddName(e.target.value)}
              onKeyDown={handleManualAddKeyDown}
            />
            <button
              className={styles.manualAddBtn}
              onClick={handleManualAdd}
              disabled={!manualAddName.trim()}
              type="button"
              title="Add to blocklist"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className={styles.saveRow}>
        <Button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving}
          type="button"
        >
          {saving ? "Saving..." : "Save Blocklist"}
        </Button>
        {saveMessage && (
          <span className={`${styles.saveMessage} ${styles[saveMessage.type]}`}>
            {saveMessage.text}
          </span>
        )}
      </div>
    </div>
  );
}

ContainerBlocklist.propTypes = {
  containers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      image: PropTypes.string,
      imageName: PropTypes.string,
      portainerName: PropTypes.string,
      portainerUrl: PropTypes.string,
      stackName: PropTypes.string,
    })
  ),
};

export default ContainerBlocklist;
