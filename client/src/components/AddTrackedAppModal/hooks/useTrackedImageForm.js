/**
 * Custom hook for managing tracked image form state and logic
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { PREDEFINED_GITHUB_REPOS, PREDEFINED_DOCKER_IMAGES } from "../../../constants/trackedApps";
import {
  getTrackedGitHubRepos,
  getTrackedDockerImages,
  filterTrackedItems,
} from "../../../utils/trackedAppsFilters";
import { extractDisplayName } from "../utils/trackedImageValidation";

/**
 * Hook to manage tracked image form state
 * @param {Object} options
 * @param {Array} options.trackedImages - Currently tracked images
 * @param {Object} options.initialData - Initial data for editing
 * @param {boolean} options.isOpen - Whether modal is open
 * @returns {Object} Form state and handlers
 */
export const useTrackedImageForm = ({ trackedImages = [], initialData = null, isOpen }) => {
  const [sourceType, setSourceType] = useState("github");
  const [usePredefined, setUsePredefined] = useState(true);
  const [usePredefinedDocker, setUsePredefinedDocker] = useState(true);
  const [selectedPredefinedRepo, setSelectedPredefinedRepo] = useState(null);
  const [selectedPredefinedImage, setSelectedPredefinedImage] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    imageName: "",
    githubRepo: "",
    currentVersion: "",
    gitlabToken: "",
  });
  const lastAutoPopulatedName = useRef("");

  // Get available options for react-select (filter out already tracked)
  const githubRepoOptions = useMemo(() => {
    const tracked = getTrackedGitHubRepos(trackedImages);
    return filterTrackedItems(PREDEFINED_GITHUB_REPOS, tracked).map((repo) => ({
      value: repo,
      label: repo,
    }));
  }, [trackedImages]);

  const dockerImageOptions = useMemo(() => {
    const tracked = getTrackedDockerImages(trackedImages);
    return filterTrackedItems(PREDEFINED_DOCKER_IMAGES, tracked).map((image) => ({
      value: image,
      label: image,
    }));
  }, [trackedImages]);

  // Auto-populate display name from selected repository/image
  // Skip auto-population when editing (initialData exists)
  useEffect(() => {
    // Don't auto-populate if we're editing an existing item
    if (initialData) {
      return;
    }

    const currentName = (formData.name || "").trim();
    const shouldUpdate = currentName === "" || currentName === lastAutoPopulatedName.current;

    if (shouldUpdate) {
      let nameToSet = "";

      if (
        (sourceType === "github" || sourceType === "gitlab") &&
        usePredefined &&
        selectedPredefinedRepo
      ) {
        const repo = selectedPredefinedRepo.value || selectedPredefinedRepo;
        nameToSet = extractDisplayName(repo, sourceType);
      } else if (
        (sourceType === "github" || sourceType === "gitlab") &&
        !usePredefined &&
        formData.githubRepo
      ) {
        nameToSet = extractDisplayName(formData.githubRepo, sourceType);
      } else if (sourceType === "docker" && usePredefinedDocker && selectedPredefinedImage) {
        const image = selectedPredefinedImage.value || selectedPredefinedImage;
        nameToSet = extractDisplayName(image, sourceType);
      } else if (sourceType === "docker" && !usePredefinedDocker && formData.imageName) {
        nameToSet = extractDisplayName(formData.imageName, sourceType);
      }

      if (nameToSet) {
        lastAutoPopulatedName.current = nameToSet;
        setFormData((prev) => ({ ...prev, name: nameToSet }));
      }
    }
  }, [
    initialData,
    selectedPredefinedRepo,
    selectedPredefinedImage,
    formData.githubRepo,
    formData.imageName,
    formData.name,
    sourceType,
    usePredefined,
    usePredefinedDocker,
  ]);

  // Clear error and reset form when modal opens or closes, or populate with initialData for editing
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setFormData({
          name: initialData.name || "",
          imageName: initialData.image_name || "",
          githubRepo: initialData.github_repo || "",
          currentVersion: initialData.current_version || "",
          gitlabToken: initialData.gitlab_token || "",
        });
        setSourceType(initialData.source_type || "github");
        const isPredefinedRepo = PREDEFINED_GITHUB_REPOS.includes(initialData.github_repo);
        const isPredefinedImage = PREDEFINED_DOCKER_IMAGES.some(
          (img) => initialData.image_name && initialData.image_name.split(":")[0] === img
        );
        setUsePredefined(isPredefinedRepo && initialData.source_type === "github");
        setUsePredefinedDocker(isPredefinedImage);
        if (isPredefinedRepo && initialData.source_type === "github") {
          setSelectedPredefinedRepo({
            value: initialData.github_repo,
            label: initialData.github_repo,
          });
        }
        if (isPredefinedImage && initialData.image_name) {
          const imageWithoutTag = initialData.image_name.split(":")[0];
          setSelectedPredefinedImage({
            value: imageWithoutTag,
            label: imageWithoutTag,
          });
        }
        lastAutoPopulatedName.current = initialData.name || "";
      } else {
        setFormData({
          name: "",
          imageName: "",
          githubRepo: "",
          currentVersion: "",
          gitlabToken: "",
        });
        setSourceType("github");
        setUsePredefined(true);
        setUsePredefinedDocker(true);
        setSelectedPredefinedRepo(null);
        setSelectedPredefinedImage(null);
        lastAutoPopulatedName.current = "";
      }
    }
  }, [isOpen, initialData]);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const resetForm = () => {
    setFormData({
      name: "",
      imageName: "",
      githubRepo: "",
      currentVersion: "",
      gitlabToken: "",
    });
    setSourceType("github");
    setUsePredefined(true);
    setUsePredefinedDocker(true);
    setSelectedPredefinedRepo(null);
    setSelectedPredefinedImage(null);
    lastAutoPopulatedName.current = "";
  };

  return {
    sourceType,
    setSourceType,
    usePredefined,
    setUsePredefined,
    usePredefinedDocker,
    setUsePredefinedDocker,
    selectedPredefinedRepo,
    setSelectedPredefinedRepo,
    selectedPredefinedImage,
    setSelectedPredefinedImage,
    formData,
    setFormData,
    handleChange,
    resetForm,
    githubRepoOptions,
    dockerImageOptions,
  };
};

