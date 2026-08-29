/**
 * Sealed evaluator-only authoring overlay for the private changing Run-target
 * checkpoint. This module is bundled into Jig's trusted evaluator toolchain;
 * it is deliberately absent from the published package exports.
 */
export {
  definePrivateProjectRunTargetsBinding as defineBinding,
  projectRunTargets,
} from "./author.js";
