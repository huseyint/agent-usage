import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { createProjectIconLoader } from "@/lib/project-icons";
import { usageApi } from "@/lib/usage-api";
import { UIcon } from "./usage-icon";
import gitlab from "@/assets/repositories/gitlab.svg";
import github from "@/assets/repositories/github.svg";
import "./project-icon.css";

const loadIcon = createProjectIconLoader(usageApi.projectIcons);

export function ProjectIcon({
  path,
  size = 16,
}: {
  path: string;
  size?: number;
}) {
  const { data } = useQuery({
    queryKey: ["project-icon", path],
    queryFn: () => loadIcon(path),
    enabled: Boolean(path),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });
  const [failed, setFailed] = useState<string[]>([]);
  const light = data?.src && !failed.includes(data.src) ? data.src : null;
  const dark =
    data?.darkSrc && !failed.includes(data.darkSrc) ? data.darkSrc : light;
  const brand =
    data?.kind === "gitlab" ? gitlab : data?.kind === "github" ? github : null;
  const src =
    light || dark || (brand && !failed.includes(brand) ? brand : null);
  return (
    <span
      className={`project-avatar${data?.kind === "github" ? " project-avatar-github" : ""}`}
      style={{ "--project-icon-size": `${size}px` } as CSSProperties}
      title={data?.source || "Project folder"}
      aria-hidden="true"
    >
      {src ? (
        <>
          <img
            className={
              dark && dark !== light ? "project-avatar-light" : undefined
            }
            src={src}
            alt=""
            width={size}
            height={size}
            draggable={false}
            onError={() => setFailed((values) => [...values, src])}
          />
          {dark && dark !== light && (
            <img
              className="project-avatar-dark"
              src={dark}
              alt=""
              width={size}
              height={size}
              draggable={false}
              onError={() => setFailed((values) => [...values, dark])}
            />
          )}
        </>
      ) : data?.kind === "git" ? (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="7" cy="5" r="2.5" />
          <circle cx="7" cy="19" r="2.5" />
          <circle cx="17" cy="5" r="2.5" />
          <path d="M7 7.5v9M17 7.5v1a5 5 0 0 1-5 5H7" />
        </svg>
      ) : (
        <UIcon name="folder" size={size} />
      )}
    </span>
  );
}

export function ProjectLabel({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  return (
    <span className="project-label">
      <ProjectIcon path={path} />
      <span className="project-label-name">{children}</span>
    </span>
  );
}
