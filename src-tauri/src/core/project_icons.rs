use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::LazyLock,
};

const MAX_FILE: u64 = 512 * 1024;
mod platforms;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIcon {
    pub src: Option<String>,
    pub dark_src: Option<String>,
    pub kind: &'static str,
    pub source: String,
}

// Only regular, bounded files inside the selected project/repository are exposed.
fn read(root: &Path, path: &Path) -> Option<Vec<u8>> {
    let path = path.canonicalize().ok()?;
    if !path.starts_with(root) {
        return None;
    }
    read_metadata_file(&path)
}

fn read_metadata_file(path: &Path) -> Option<Vec<u8>> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_FILE {
        return None;
    }
    let file = fs::File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_FILE {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= MAX_FILE).then_some(bytes)
}

fn json(root: &Path, path: &Path) -> Option<Value> {
    serde_json::from_slice(&read(root, path)?).ok()
}

fn image(root: &Path, path: &Path, source: &str) -> Option<ProjectIcon> {
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "icns" => {
            let bytes = read(root, path)?;
            if bytes.get(..4)? != b"icns" {
                return None;
            }
            let mut offset = 8;
            let mut pngs = Vec::new();
            while offset + 8 <= bytes.len() {
                let size =
                    u32::from_be_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
                if size < 8 || size > bytes.len() - offset {
                    return None;
                }
                let data = &bytes[offset + 8..offset + size];
                if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                    pngs.push(data);
                }
                offset += size;
            }
            return Some(image_data(
                "image/png",
                pngs.into_iter().max_by_key(|png| png.len())?,
                source,
            ));
        }
        _ => return None,
    };
    let bytes = read(root, path)?;
    // Reject empty files and obvious mismatches so a broken asset does not hide
    // the next useful candidate. Browser decoding handles the remaining checks.
    let valid = match mime {
        "image/svg+xml" => std::str::from_utf8(&bytes).ok()?.contains("<svg"),
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/x-icon" => bytes.starts_with(b"\0\0\x01\0"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/gif" => bytes.starts_with(b"GIF8"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    valid.then(|| image_data(mime, &bytes, source))
}

fn image_data(mime: &str, bytes: &[u8], source: &str) -> ProjectIcon {
    ProjectIcon {
        src: Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes))),
        dark_src: None,
        kind: "image",
        source: source.into(),
    }
}

fn first_image(root: &Path, paths: &[PathBuf], source: &str) -> Option<ProjectIcon> {
    paths.iter().find_map(|path| image(root, path, source))
}

fn idea_icon(root: &Path) -> Option<ProjectIcon> {
    let mut dirs = vec![root.join(".idea")];
    // Rider stores solution settings one directory deeper.
    if let Ok(entries) = fs::read_dir(root.join(".idea")) {
        let mut nested: Vec<_> = entries
            .flatten()
            .take(64)
            .filter(|e| e.file_name().to_string_lossy().starts_with(".idea."))
            .map(|e| e.path().join(".idea"))
            .collect();
        nested.sort();
        dirs.extend(nested);
    }
    for dir in dirs {
        let light = first_image(
            root,
            &[dir.join("icon.svg"), dir.join("icon.png")],
            "JetBrains project icon",
        );
        let dark = first_image(
            root,
            &[dir.join("icon_dark.svg"), dir.join("icon_dark.png")],
            "JetBrains project icon",
        );
        if let Some(mut icon) = light.or_else(|| dark.clone()) {
            icon.dark_src = dark.and_then(|i| i.src);
            return Some(icon);
        }
    }
    None
}

fn local_ref(base: &Path, value: &str) -> Option<PathBuf> {
    let value = value.split(['?', '#']).next()?.trim();
    if value.is_empty() || value.contains(':') || value.starts_with("//") {
        return None;
    }
    Some(base.join(value.trim_start_matches('/')))
}

fn manifest_icon(root: &Path, path: &Path, web_root: &Path) -> Option<ProjectIcon> {
    let manifest = json(root, path)?;
    let icons = manifest.get("icons")?.as_array()?;
    // Prefer ordinary full-color icons over maskable/monochrome alternatives.
    let mut icons: Vec<_> = icons.iter().collect();
    icons.sort_by_key(|icon| {
        !icon["purpose"]
            .as_str()
            .unwrap_or("any")
            .split_whitespace()
            .any(|purpose| purpose == "any")
    });
    icons.into_iter().find_map(|icon| {
        let src = icon["src"].as_str()?;
        let base = if src.starts_with('/') {
            web_root
        } else {
            path.parent()?
        };
        image(root, &local_ref(base, src)?, "Web app manifest icon")
    })
}

static LINKS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<link\b[^>]*>").unwrap());
static ATTRS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\b(rel|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap()
});

fn html_icon(root: &Path, path: &Path) -> Option<ProjectIcon> {
    let bytes = read(root, path)?;
    let html = std::str::from_utf8(&bytes).ok()?;
    let base = path.parent()?;
    for link in LINKS.find_iter(html) {
        let mut rel = String::new();
        let mut href = None;
        for attr in ATTRS.captures_iter(link.as_str()) {
            let value = attr
                .get(2)
                .or_else(|| attr.get(3))
                .or_else(|| attr.get(4))?
                .as_str();
            if attr[1].eq_ignore_ascii_case("rel") {
                rel = value.to_ascii_lowercase();
            } else {
                href = Some(value.replace("&amp;", "&"));
            }
        }
        let Some(href) = href else { continue };
        for web_root in [base.join("public"), base.join("static"), base.to_path_buf()] {
            let Some(asset) = local_ref(
                if href.starts_with('/') {
                    &web_root
                } else {
                    base
                },
                &href,
            ) else {
                continue;
            };
            if rel
                .split_whitespace()
                .any(|r| r == "icon" || r == "apple-touch-icon")
            {
                if let Some(icon) = image(root, &asset, "Website icon") {
                    return Some(icon);
                }
            } else if rel == "manifest" {
                if let Some(icon) = manifest_icon(root, &asset, &web_root) {
                    return Some(icon);
                }
            }
        }
    }
    None
}

fn app_icon(root: &Path) -> Option<ProjectIcon> {
    if let Some(icon) = platforms::discover(root) {
        return Some(icon);
    }
    let config_path = root.join("src-tauri/tauri.conf.json");
    if let Some(config) = json(root, &config_path) {
        if let Some(icons) = config.pointer("/bundle/icon").and_then(Value::as_array) {
            for icon in icons.iter().filter_map(Value::as_str) {
                if let Some(icon) = local_ref(&root.join("src-tauri"), icon)
                    .and_then(|path| image(root, &path, "Desktop app icon"))
                {
                    return Some(icon);
                }
            }
        }
    }
    for dir in ["", "public", "static", "src", "app", "src/app"] {
        let base = root.join(dir);
        for name in [
            "index.html",
            "manifest.webmanifest",
            "site.webmanifest",
            "manifest.json",
        ] {
            let path = base.join(name);
            let icon = if name.ends_with("html") {
                html_icon(root, &path)
            } else {
                manifest_icon(root, &path, &base)
            };
            if icon.is_some() {
                return icon;
            }
        }
    }
    let bases = [
        "",
        "public",
        "static",
        "assets",
        "src/assets",
        "app",
        "src/app",
        "src-tauri/icons",
        "build",
        "resources",
    ];
    for name in [
        "app-icon.svg",
        "app-icon.png",
        "favicon.svg",
        "favicon.ico",
        "favicon.png",
        "icon.svg",
        "icon.png",
        "icon.ico",
        "icon.icns",
        "logo.svg",
        "logo.png",
        "logo.jpg",
        "logo.gif",
        "apple-touch-icon.png",
    ] {
        for base in bases {
            if let Some(icon) = image(
                root,
                &root.join(base).join(name),
                "Project app icon or logo",
            ) {
                return Some(icon);
            }
        }
    }
    None
}

fn nested_icon(root: &Path) -> Option<ProjectIcon> {
    // A general working directory (for example ~/projects) should not borrow
    // the identity of an unrelated child repository.
    if ![
        ".git",
        "package.json",
        "pnpm-workspace.yaml",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
    ]
    .iter()
    .any(|marker| root.join(marker).exists())
    {
        return None;
    }
    let project_name = root
        .file_name()?
        .to_string_lossy()
        .replace(['-', '_'], "")
        .to_lowercase();
    let mut candidates = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .min_depth(1)
        .max_depth(5)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.')
                && !matches!(
                    name.as_ref(),
                    "node_modules"
                        | "target"
                        | "dist"
                        | "build"
                        | "vendor"
                        | "venv"
                        | "coverage"
                        | "test-results"
                        | "tests"
                        | "__tests__"
                        | "docs"
                )
        })
        .take(2500)
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        let compact = name.replace(['-', '_'], "");
        let rank = if name == "app-icon.svg" || name == "app-icon.png" {
            0
        } else if ["favicon.svg", "favicon.ico", "favicon.png"].contains(&name.as_str()) {
            1
        } else if !project_name.is_empty()
            && compact.starts_with(&project_name)
            && ["icon.svg", "icon.png", "logo.svg", "logo.png"]
                .iter()
                .any(|s| compact.ends_with(s))
        {
            2
        } else {
            continue;
        };
        let primary_app = entry.path().components().any(|part| {
            matches!(
                part.as_os_str().to_str(),
                Some("app" | "web" | "frontend" | "client")
            )
        });
        candidates.push((rank, !primary_app, entry.depth(), entry.into_path()));
    }
    candidates.sort();
    candidates
        .into_iter()
        .find_map(|(_, _, _, path)| image(root, &path, "Project app icon or favicon"))
}

fn git_dir(root: &Path) -> Option<PathBuf> {
    let dot_git = root.join(".git");
    if dot_git.is_dir() {
        return dot_git.canonicalize().ok();
    }
    let bytes = read_metadata_file(&dot_git)?;
    let path = std::str::from_utf8(&bytes)
        .ok()?
        .trim()
        .strip_prefix("gitdir:")?
        .trim();
    root.join(path).canonicalize().ok()
}

fn common_dir(git: &Path) -> PathBuf {
    read_metadata_file(&git.join("commondir"))
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|path| git.join(path.trim()).canonicalize().ok())
        .unwrap_or_else(|| git.to_path_buf())
}

fn fallback(repo: Option<&Path>) -> ProjectIcon {
    let config = repo
        .and_then(|repo| read_metadata_file(&common_dir(&git_dir(repo)?).join("config")))
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default();
    let mut remote = false;
    let mut host = None;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            remote = line.starts_with("[remote ");
        }
        if remote {
            if let Some((key, value)) = line.split_once('=') {
                if key.trim() == "url" {
                    let value = value.trim().to_ascii_lowercase();
                    let authority = value
                        .split_once("://")
                        .map_or(value.as_str(), |(_, rest)| rest)
                        .split('/')
                        .next()
                        .unwrap_or_default();
                    let hostname = authority
                        .rsplit('@')
                        .next()
                        .unwrap_or_default()
                        .split(':')
                        .next()
                        .unwrap_or_default();
                    if hostname == "github.com" {
                        host = Some("github");
                        break;
                    }
                    if hostname.split('.').any(|part| part == "gitlab") {
                        host = Some("gitlab");
                        break;
                    }
                }
            }
        }
    }
    let kind = host.unwrap_or(if repo.is_some() { "git" } else { "folder" });
    ProjectIcon {
        kind,
        source: match kind {
            "github" => "GitHub repository",
            "gitlab" => "GitLab repository",
            "git" => "Git repository",
            _ => "Project folder",
        }
        .into(),
        ..Default::default()
    }
}

pub fn discover(path: &str) -> ProjectIcon {
    let Some(root) = Path::new(path)
        .is_absolute()
        .then(|| Path::new(path).canonicalize().ok())
        .flatten()
        .filter(|path| path.is_dir())
    else {
        return fallback(None);
    };
    let repo = root
        .ancestors()
        .take(8)
        .find(|path| path.join(".git").exists());
    let mut roots = vec![root.clone()];
    if let Some(repo) = repo {
        if repo != root {
            roots.push(repo.to_path_buf());
        }
        // Codex and Git worktrees can reuse assets from their primary checkout.
        if let Some(git) = git_dir(repo) {
            let common = common_dir(&git);
            if common.file_name().is_some_and(|name| name == ".git") {
                if let Some(main) = common
                    .parent()
                    .filter(|main| !roots.iter().any(|r| r == main))
                {
                    roots.push(main.to_path_buf());
                }
            }
        }
    }
    for root in &roots {
        if let Some(icon) = idea_icon(root)
            .or_else(|| app_icon(root))
            .or_else(|| nested_icon(root))
        {
            return icon;
        }
    }
    fallback(repo)
}

#[cfg(test)]
mod tests {
    use super::*;
    const SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h16v16z"/></svg>"#;
    fn put(root: &Path, path: &str, content: &str) {
        let path = root.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }
    fn resolve(root: &Path) -> ProjectIcon {
        discover(root.to_str().unwrap())
    }

    #[test]
    fn custom_jetbrains_icon_wins_and_preserves_dark_variant() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ".idea/icon.svg", SVG);
        put(
            dir.path(),
            ".idea/icon_dark.svg",
            &SVG.replace("<path", "<path fill='white'"),
        );
        put(dir.path(), "public/favicon.svg", SVG);
        let icon = resolve(dir.path());
        assert_eq!(icon.source, "JetBrains project icon");
        assert_ne!(icon.src, icon.dark_src);
    }

    #[test]
    fn rider_nested_settings_and_dark_only_icons() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ".idea/.idea.Example/.idea/icon_dark.svg", SVG);
        let icon = resolve(dir.path());
        assert_eq!(icon.src, icon.dark_src);
        assert!(icon.src.is_some());
    }

    #[test]
    fn reads_declared_html_favicon_and_relative_manifest_icon() {
        let dir = tempfile::tempdir().unwrap();
        put(
            dir.path(),
            "index.html",
            r#"<link href='/brand/mark.svg?v=2' rel='shortcut icon'>"#,
        );
        put(dir.path(), "public/brand/mark.svg", SVG);
        assert_eq!(resolve(dir.path()).source, "Website icon");
        put(
            dir.path(),
            "index.html",
            r#"<link rel="manifest" href="/pwa/site.webmanifest">"#,
        );
        put(
            dir.path(),
            "public/pwa/site.webmanifest",
            r#"{"icons":[{"src":"./app.svg"}]}"#,
        );
        put(dir.path(), "public/pwa/app.svg", SVG);
        assert_eq!(resolve(dir.path()).source, "Web app manifest icon");
    }

    #[test]
    fn tauri_configuration_and_monorepo_favicons() {
        let dir = tempfile::tempdir().unwrap();
        put(
            dir.path(),
            "src-tauri/tauri.conf.json",
            r#"{"bundle":{"icon":["icons/brand.svg"]}}"#,
        );
        put(dir.path(), "src-tauri/icons/brand.svg", SVG);
        assert_eq!(resolve(dir.path()).source, "Desktop app icon");
        fs::remove_dir_all(dir.path().join("src-tauri")).unwrap();
        put(dir.path(), "package.json", "{}");
        put(dir.path(), "packages/app/public/favicon.svg", SVG);
        put(dir.path(), "node_modules/a/favicon.svg", "invalid");
        assert!(resolve(dir.path()).src.is_some());
    }

    #[test]
    fn origin_host_is_used_without_confusing_hostnames_with_repo_names() {
        let dir = tempfile::tempdir().unwrap();
        put(
            dir.path(),
            ".git/config",
            "[remote \"origin\"]\nurl = git@gitlab.example.com:team/repo.git",
        );
        assert_eq!(resolve(dir.path()).kind, "gitlab");
        put(
            dir.path(),
            ".git/config",
            "[remote \"origin\"]\nurl = https://github.com/team/repo.git",
        );
        assert_eq!(resolve(dir.path()).kind, "github");
        put(
            dir.path(),
            ".git/config",
            "[remote \"origin\"]\nurl = https://example.com/gitlab/repo.git",
        );
        assert_eq!(resolve(dir.path()).kind, "git");
    }

    #[test]
    fn skips_oversized_invalid_and_external_assets() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), "favicon.svg", "not an image");
        put(dir.path(), "icon.svg", &"x".repeat(MAX_FILE as usize + 1));
        put(
            dir.path(),
            "manifest.json",
            r#"{"icons":[{"src":"https://example.com/logo.svg"}]}"#,
        );
        assert!(resolve(dir.path()).src.is_none());
        assert!(read(dir.path(), &dir.path().join("../outside.svg")).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_and_reuses_worktree_assets() {
        let main = tempfile::tempdir().unwrap();
        let work = tempfile::tempdir().unwrap();
        put(main.path(), "logo.svg", SVG);
        std::os::unix::fs::symlink(
            main.path().join("logo.svg"),
            work.path().join("favicon.svg"),
        )
        .unwrap();
        assert!(resolve(work.path()).src.is_none());
        put(main.path(), ".git/worktrees/test/commondir", "../..");
        put(
            work.path(),
            ".git",
            &format!("gitdir: {}/.git/worktrees/test", main.path().display()),
        );
        assert!(resolve(work.path()).src.is_some());
    }

    #[test]
    fn missing_or_relative_paths_use_folder() {
        assert_eq!(discover("relative/project").kind, "folder");
        assert_eq!(discover("/nonexistent/usage-test-project").kind, "folder");
    }

    #[test]
    fn general_working_directory_does_not_borrow_child_repository_icons() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), "unrelated/public/favicon.svg", SVG);
        assert_eq!(resolve(dir.path()).kind, "folder");
    }

    #[test]
    #[ignore = "Requires explicit local project paths in AGENT_USAGE_ICON_CHECK_PROJECTS"]
    fn local_project_icon_diagnostic() {
        let paths = std::env::var("AGENT_USAGE_ICON_CHECK_PROJECTS").unwrap();
        for path in paths.lines() {
            let icon = discover(path);
            println!(
                "{}: {}",
                Path::new(path).file_name().unwrap().to_string_lossy(),
                icon.source
            );
            assert!(
                icon.src.is_some(),
                "Expected an existing local project icon"
            );
        }
    }
}
