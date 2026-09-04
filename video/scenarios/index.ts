// Scenario registry. Adding a video means adding a file here and listing it —
// nothing under src/ changes.

import type { Scenario } from "../src/types";
import { kyotoBasics } from "./kyoto-basics";
import { aiChat } from "./ai-chat";
import { profile } from "./profile";
import { videoWatch } from "./video-watch";

export const SCENARIOS: Scenario[] = [kyotoBasics, videoWatch, profile, aiChat];

export function getScenario(id: string): Scenario {
  const found = SCENARIOS.find((scenario) => scenario.id === id);
  if (!found) {
    throw new Error(`unknown scenario "${id}" — known: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  }
  return found;
}
