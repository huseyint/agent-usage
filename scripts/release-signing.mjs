import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { root } from "./release.mjs";

const dir = join(root, ".cache/release-signing");
const statePath = join(dir, "state.json");
// Signing commands contain passwords. Keep arguments and output out of errors.
function run(exe, args, env = process.env) {
  const result = spawnSync(exe, args, { encoding: "utf8", env });
  if (result.error || result.status !== 0)
    throw Error(
      `${exe} failed during release signing; check certificate configuration.`,
    );
  return result.stdout.trim();
}
function requireAll(names) {
  if (names.some((key) => !process.env[key]))
    throw Error(`Signing requires all of: ${names.join(", ")}`);
}
function save(state) {
  writeFileSync(statePath, JSON.stringify(state));
}

if (process.argv[2] === "cleanup") {
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.keychain) {
      run("security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        ...state.previousKeychains,
      ]);
      run("security", ["delete-keychain", state.keychain]);
    }
    if (state.thumbprint)
      run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference = 'Stop'; Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $env:RELEASE_CERT_THUMBPRINT)",
        ],
        { ...process.env, RELEASE_CERT_THUMBPRINT: state.thumbprint },
      );
  }
  rmSync(dir, { recursive: true, force: true });
} else {
  mkdirSync(dir, { recursive: true });
  if (existsSync(statePath))
    throw Error("Clean up the previous signing session first.");
  let signing = "unsigned";
  const config = { bundle: {} };
  if (process.platform === "darwin") {
    config.bundle.macOS = { signingIdentity: "-" };
    signing = "ad-hoc";
    const keys = [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_TEAM_ID",
    ];
    if (keys.some((key) => process.env[key])) {
      requireAll(keys);
      const certificate = join(dir, "apple.p12");
      const keychain = join(dir, "build.keychain-db");
      const password = randomBytes(32).toString("hex");
      writeFileSync(
        certificate,
        Buffer.from(process.env.APPLE_CERTIFICATE, "base64"),
        { mode: 0o600 },
      );
      const previousKeychains = [
        ...run("security", ["list-keychains", "-d", "user"]).matchAll(
          /"([^"]+)"/g,
        ),
      ].map((match) => match[1]);
      run("security", ["create-keychain", "-p", password, keychain]);
      save({ keychain, previousKeychains });
      run("security", ["set-keychain-settings", "-lut", "21600", keychain]);
      run("security", ["unlock-keychain", "-p", password, keychain]);
      run("security", [
        "import",
        certificate,
        "-k",
        keychain,
        "-P",
        process.env.APPLE_CERTIFICATE_PASSWORD,
        "-T",
        "/usr/bin/codesign",
        "-T",
        "/usr/bin/security",
      ]);
      run("security", [
        "set-key-partition-list",
        "-S",
        "apple-tool:,apple:,codesign:",
        "-s",
        "-k",
        password,
        keychain,
      ]);
      run("security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        ...previousKeychains,
        keychain,
      ]);
      rmSync(certificate);
      config.bundle.macOS.signingIdentity = process.env.APPLE_SIGNING_IDENTITY;
      signing = "developer-id-notarized";
    }
  } else if (
    process.platform === "win32" &&
    (process.env.WINDOWS_CERTIFICATE ||
      process.env.WINDOWS_CERTIFICATE_PASSWORD)
  ) {
    requireAll(["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD"]);
    const certificate = join(dir, "windows.pfx");
    writeFileSync(
      certificate,
      Buffer.from(process.env.WINDOWS_CERTIFICATE, "base64"),
    );
    const thumbprint = run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; $password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force; $certificate = Import-PfxCertificate -FilePath $env:RELEASE_CERT_PATH -CertStoreLocation Cert:\\CurrentUser\\My -Password $password; ($certificate | Where-Object HasPrivateKey | Select-Object -First 1).Thumbprint",
      ],
      { ...process.env, RELEASE_CERT_PATH: certificate },
    );
    if (!/^[A-Fa-f0-9]{40}$/.test(thumbprint))
      throw Error("Signing certificate has no usable private key.");
    save({ thumbprint });
    rmSync(certificate);
    config.bundle.windows = {
      certificateThumbprint: thumbprint,
      digestAlgorithm: "sha256",
      timestampUrl: "http://timestamp.digicert.com",
      tsp: true,
    };
    signing = "authenticode";
  }
  writeFileSync(
    join(dir, "tauri.conf.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
  if (process.env.GITHUB_ENV)
    appendFileSync(process.env.GITHUB_ENV, `RELEASE_SIGNING=${signing}\n`);
  console.log(
    `Release signing: ${signing}. Config: .cache/release-signing/tauri.conf.json`,
  );
}
