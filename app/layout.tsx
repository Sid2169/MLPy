import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MLPy — Python for Applied AI and Backend Engineering",
    template: "%s · MLPy",
  },
  description:
    "A self-study course for experienced TypeScript and Node.js developers who want practical Python fluency for AI services, data pipelines, ML experiments, and production backends.",
  applicationName: "MLPy",
  keywords: [
    "Python",
    "TypeScript",
    "AI engineering",
    "backend engineering",
    "FastAPI",
    "PyTorch",
    "NumPy",
    "pandas",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
