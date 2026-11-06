import type {
  AnchorHTMLAttributes,
  ComponentPropsWithoutRef,
  ReactNode,
} from "react";
import Link from "next/link";
import clsx from "clsx";
import { CodeActions } from "@/components/code-actions";
import { ExerciseMarker } from "@/components/exercise-marker";
import type { ChapterMeta } from "@/lib/types";

type ParagraphProps = ComponentPropsWithoutRef<"p"> & {
  "data-exercise-id"?: string;
  "data-exercise-label"?: string;
  "data-exercise-chapter"?: string;
};

type PreProps = ComponentPropsWithoutRef<"pre"> & {
  "data-snippet-id"?: string;
  interactiveCode?: boolean;
  "data-language"?: string;
  "data-theme"?: string;
};

type HeadingProps = ComponentPropsWithoutRef<"h2"> & {
  id?: string;
};

function nodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map(nodeText).join("");
  }

  if (children && typeof children === "object" && "props" in children) {
    const props = children.props as { children?: ReactNode };
    return nodeText(props.children);
  }

  return "";
}

function isExercisesHeading(children: ReactNode): boolean {
  return nodeText(children).trim().startsWith("Exercises");
}

function Heading({ id, children, className, ...props }: HeadingProps) {
  return (
    <h2
      id={id}
      className={clsx(
        "scroll-mt-28",
        isExercisesHeading(children) && "exercise-divider",
        className,
      )}
      {...props}
    >
      {children}
    </h2>
  );
}

function Subheading({ id, children, className, ...props }: HeadingProps) {
  return (
    <h3
      id={id}
      className={clsx("scroll-mt-28", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

function Paragraph({ children, className, ...props }: ParagraphProps) {
  const exerciseId = props["data-exercise-id"];
  const exerciseLabel = props["data-exercise-label"];
  const chapterSlug = props["data-exercise-chapter"];

  if (exerciseId && exerciseLabel && chapterSlug) {
    const paragraphProps = { ...props };
    delete paragraphProps["data-exercise-id"];
    delete paragraphProps["data-exercise-label"];
    delete paragraphProps["data-exercise-chapter"];

    return (
      <div
        id={`exercise-${exerciseId.toLowerCase()}`}
        className="exercise-block scroll-mt-28"
        data-exercise-id={exerciseId}
      >
        <ExerciseMarker
          chapterSlug={chapterSlug}
          exerciseId={exerciseId}
          label={exerciseLabel}
        />
        <p className={clsx("exercise-prompt", className)} {...paragraphProps}>
          {children}
        </p>
      </div>
    );
  }

  return (
    <p className={className} {...props}>
      {children}
    </p>
  );
}

function Anchor({
  href,
  children,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href && (href.startsWith("/") || href.startsWith("#"))) {
    return (
      <Link href={href} className={className} {...props}>
        {children}
      </Link>
    );
  }

  if (href && /^https?:\/\//.test(href)) {
    return (
      <a
        href={href}
        className={className}
        target="_blank"
        rel="noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  );
}

function Pre({ children, className, interactiveCode = true, ...props }: PreProps) {
  const language = props["data-language"] ?? "text";
  const snippetId = props["data-snippet-id"];

  return (
    <div
      className="code-frame"
      data-code-frame
      data-language={language}
    >
      <pre className={clsx("shiki", className)} {...props}>
        {children}
      </pre>
      {interactiveCode ? <CodeActions language={language} snippetId={snippetId} originalSource={nodeText(children)} /> : null}
    </div>
  );
}

function Table({ children, ...props }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="table-wrapper">
      <table {...props}>{children}</table>
    </div>
  );
}

export function createMdxComponents({ chapter, interactiveCode = true }: { chapter?: ChapterMeta; interactiveCode?: boolean }) {
  void chapter;

  return {
    h1: ({
      id,
      children,
      className,
      ...props
    }: ComponentPropsWithoutRef<"h1">) => (
      <h2
        id={id}
        className={clsx("exercise-divider scroll-mt-28", className)}
        {...props}
      >
        {children}
      </h2>
    ),
    h2: Heading,
    h3: Subheading,
    p: Paragraph,
    a: Anchor,
    pre: (props: PreProps) => <Pre {...props} interactiveCode={interactiveCode} />,
    table: Table,
  };
}
