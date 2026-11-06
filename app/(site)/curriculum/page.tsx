import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReferencePage } from "@/components/reference-page";
import { getReferenceDocument } from "@/lib/content";

export const metadata: Metadata = {
  title: "Curriculum",
  description:
    "Goals, chapter outlines, outcomes, and completion criteria for MLPy.",
};

export default async function CurriculumPage() {
  const document = getReferenceDocument("Curriculum.md", "/curriculum");

  if (!document) {
    notFound();
  }

  return <ReferencePage document={document} eyebrow="Course reference" />;
}
