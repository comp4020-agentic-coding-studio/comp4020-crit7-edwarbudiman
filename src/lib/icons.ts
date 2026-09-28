// Course artwork for the skill tree. Put an image named after a course code
// (COMP2310.png, .jpg, .webp or .svg) in src/assets/course-icons/ and that
// course's tile shows it instead of the code monogram. None exist yet — the
// generated artwork comes later.
const files = import.meta.glob<string>("../assets/course-icons/*.{png,jpg,jpeg,webp,svg}", {
  eager: true,
  query: "?url",
  import: "default",
});

const byCode = new Map(
  Object.entries(files).map(([path, url]) => [path.split("/").pop()!.replace(/\.\w+$/, "").toUpperCase(), url]),
);

export const iconFor = (code: string): string | undefined => byCode.get(code);

// The monogram's colour band, by subject: SoCo's own courses in ANU gold,
// the subjects BCOMP/MCOMP draw on most in their own hues, the rest grey.
const SUBJECT_TOKEN: Record<string, string> = {
  COMP: "--subj-comp",
  MATH: "--subj-math",
  STAT: "--subj-math",
  ENGN: "--subj-engn",
  INFS: "--subj-infs",
  DESN: "--subj-arts",
  ARTH: "--subj-arts",
  MUSI: "--subj-arts",
};

export const subjectColour = (subject: string) => `var(${SUBJECT_TOKEN[subject] ?? "--subj-other"})`;
