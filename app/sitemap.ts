import type { MetadataRoute } from "next";
import { getChapterMetas } from "@/lib/content";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://mlpy.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const chapters = getChapterMetas().map((chapter) => ({
    url: `${SITE_URL}/chapters/${chapter.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));
  const exercises = getChapterMetas().flatMap((chapter) => chapter.exercises.map((exercise) => ({
    url: `${SITE_URL}/practice/${chapter.slug}/${exercise.id}`,
    changeFrequency: "monthly" as const,
    priority: 0.5,
  })));

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    ...chapters,
    ...exercises,
    {
      url: `${SITE_URL}/curriculum`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/chapter-generation`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
