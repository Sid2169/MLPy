import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReferencePage } from "@/components/reference-page";
import { getReferenceDocument } from "@/lib/content";

export const metadata: Metadata = {
  title: "Chapter Generation Guide",
  description:
    "The specification used to generate each lesson and exercise set.",
};

export default async function ChapterGenerationPage() {
  const document = getReferenceDocument(
    "Chapter-generation.md",
    "/chapter-generation",
  );

  if (!document) {
    notFound();
  }

  return (
    <ReferencePage document={document} eyebrow="Contributor reference" />
  );
}
