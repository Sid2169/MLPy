export type TocHeading = {
  id: string;
  text: string;
  level: number;
};

export type ExerciseRef = {
  id: string;
  label: string;
};

export type ChapterMeta = {
  number: number;
  slug: string;
  title: string;
  fullTitle: string;
  description: string;
  fileName: string;
  filePath: string;
  headings: TocHeading[];
  exercises: ExerciseRef[];
  wordCount: number;
  readingMinutes: number;
};

export type Chapter = ChapterMeta & {
  body: string;
};

export type SearchDocument = {
  id: string;
  route: string;
  chapterSlug: string;
  chapterNumber: number;
  chapterTitle: string;
  heading: string;
  anchor: string;
  text: string;
};

export type SearchIndexFile = {
  version: 1;
  documents: SearchDocument[];
};
