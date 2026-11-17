import type { ModuleId } from "../services/api";

export interface ModuleDescriptor {
  id: ModuleId;
  name: string;
  code: string;
  tagline: string;
  description: string;
  features: readonly string[];
}

/**
 * Presentation-only metadata. Ports, URLs and status always come from
 * GET /api/state — never from this file.
 */
export const MODULES: readonly ModuleDescriptor[] = [
  {
    id: "ists",
    name: "ISTS",
    code: "01",
    tagline: "Study workspace",
    description:
      "A single-user workspace for daily practice, mock exams and steady progress through your own material.",
    features: [
      "Vocabulary SRS",
      "Reading & listening",
      "Writing feedback",
      "Mock exams",
      "Analytics",
      "AI coach",
    ],
  },
  {
    id: "bandready",
    name: "BandReady",
    code: "02",
    tagline: "Exam training",
    description:
      "Exam-room style training with a speaking examiner, timed drills and skill-by-skill feedback.",
    features: [
      "Speaking examiner",
      "Writing tasks",
      "Reading & listening",
      "Vocabulary",
      "Grammar",
      "Pronunciation",
    ],
  },
];
