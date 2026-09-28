// A demo history for showing the planner: three submitted semesters of a
// Bachelor of Computing student's real ANU courses, each with its
// prerequisites met by the semesters before (spec/catalogue.test.ts checks).
// It's demo data for this one account, not anyone's record.
export const DEMO_HISTORY: Record<string, string[]> = {
  "2025-S1": ["COMP1100", "MATH1005", "STAT1003", "INFS1001"],
  "2025-S2": ["COMP1110", "COMP1600", "COMP2400", "MATH1013"],
  "2026-S1": ["COMP2100", "COMP2300", "COMP2620", "COMP2700"],
};
