import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = "huseyint/agent-usage";

export function configureGithub({
  gh = (args, options) => execFileSync("gh", args, options),
} = {}) {
  const api = (method, path, body) => {
    const args = ["api", "--method", method, `repos/${repository}${path}`];
    if (body !== undefined) args.push("--input", "-");
    const output = gh(args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(body === undefined ? {} : { input: JSON.stringify(body) }),
    });
    return output.trim() ? JSON.parse(output) : null;
  };
  const repo = api("GET", "");
  if (!repo.permissions?.admin)
    throw Error("Repository administration access is required.");

  const settings = [
    ["Dependabot alerts", "PUT", "/vulnerability-alerts"],
    ["Dependabot security updates", "PUT", "/automated-security-fixes"],
    [
      "Read-only workflow tokens",
      "PUT",
      "/actions/permissions/workflow",
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: false,
      },
    ],
  ];
  const publicSettings = [
    [
      "Private vulnerability reporting",
      "PUT",
      "/private-vulnerability-reporting",
    ],
    [
      "Secret scanning and push protection",
      "PATCH",
      "",
      {
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "enabled" },
        },
      },
    ],
    [
      "Approval for all external PR workflows",
      "PUT",
      "/actions/permissions/fork-pr-contributor-approval",
      {
        approval_policy: "all_external_contributors",
      },
    ],
    [
      "Protect main against deletion and force pushes",
      "PUT",
      "/branches/main/protection",
      {
        required_status_checks: null,
        enforce_admins: true,
        required_pull_request_reviews: null,
        restrictions: null,
        required_linear_history: true,
        allow_force_pushes: false,
        allow_deletions: false,
        required_conversation_resolution: true,
      },
    ],
  ];
  const pending =
    repo.visibility === "public" ? [] : publicSettings.map(([name]) => name);
  if (!pending.length) settings.push(...publicSettings);

  const applied = [];
  const failures = [];
  for (const [name, method, path, body] of settings) {
    try {
      api(method, path, body);
      applied.push(name);
    } catch (error) {
      failures.push({
        name,
        message: error.stderr?.toString().trim() || error.message,
      });
    }
  }
  return { visibility: repo.visibility, applied, pending, failures };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = configureGithub();
  for (const name of result.applied) console.log(`Configured: ${name}`);
  for (const { name, message } of result.failures)
    console.error(`Failed: ${name}: ${message}`);
  if (result.pending.length) {
    console.log(
      "Make the repository public, then rerun pnpm github:configure to apply:",
    );
    for (const name of result.pending) console.log(`  ${name}`);
  }
  if (result.failures.length || result.pending.length) process.exitCode = 1;
}
