// A course's section menu, as ANU Canvas shows it: the sections most ANU
// courses share, in Canvas's usual order. Home is the course's root URL.
export const COURSE_SECTIONS = [
  { slug: "", label: "Home" },
  { slug: "modules", label: "Modules" },
  { slug: "ed-discussion", label: "Ed Discussion" },
  { slug: "class-recordings", label: "Class Recordings" },
  { slug: "readings", label: "Readings" },
  { slug: "assignments", label: "Assignments" },
  { slug: "marks", label: "Marks" },
  { slug: "people", label: "People" },
  { slug: "notebook", label: "Notebook" },
] as const;

export type CourseSection = (typeof COURSE_SECTIONS)[number];

export const sectionHref = (courseId: number, section: CourseSection) =>
  `/courses/${courseId}/${section.slug ? `${section.slug}/` : ""}`;
