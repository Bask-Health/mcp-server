/**
 * Utility for determining if the current stage is permanent or temporary
 * Used for conditional infrastructure provisioning in SST
 */

export const SHARED_VPC_ID = "vpc-069e0c571e5d6e74b";

/**
 * Determines if the current stage should get permanent infrastructure
 * Permanent stages get dedicated VPCs, temporary stages share infrastructure
 */
export const isPermanentStage = (() => {
  if (typeof $app === "undefined") {
    // Fallback for non-SST environments
    return false;
  }

  const stage = $app.stage;
  const permanentStages = ["production", "staging", "development", "dev"];

  return permanentStages.includes(stage.toLowerCase());
})();

/**
 * Get the appropriate stage name for resource naming
 */
export const getStagePrefix = () => {
  if (typeof $app === "undefined") {
    return "dev";
  }

  return $app.stage.toLowerCase();
};
