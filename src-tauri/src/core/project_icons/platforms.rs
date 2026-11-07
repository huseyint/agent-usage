use super::*;
use roxmltree::{Document, Node};
#[cfg(test)]
mod tests;

const ANDROID: &str = "http://schemas.android.com/apk/res/android";

fn text(root: &Path, path: &Path) -> Option<String> {
    String::from_utf8(read(root, path)?).ok()
}

fn xml(contents: &str) -> Option<Document<'_>> {
    Document::parse_with_options(
        contents,
        roxmltree::ParsingOptions {
            nodes_limit: 16_384,
            ..Default::default()
        },
    )
    .ok()
}

fn reference(base: &Path, value: &str) -> Option<PathBuf> {
    let value = value.trim().replace('\\', "/");
    if value.contains("$(") || value.contains("${") {
        return None;
    }
    if Path::new(&value).is_absolute() {
        return Some(PathBuf::from(value));
    }
    local_ref(base, &value)
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn svg(value: String, source: &str) -> Option<ProjectIcon> {
    (value.len() as u64 <= MAX_FILE).then(|| image_data("image/svg+xml", value.as_bytes(), source))
}

fn composite(
    background: &str,
    foreground: &str,
    source: &str,
    adaptive: bool,
) -> Option<ProjectIcon> {
    let (view, clip) = if adaptive {
        ("18 18 72 72", "<defs><clipPath id='mask'><rect x='18' y='18' width='72' height='72' rx='16'/></clipPath></defs><g clip-path='url(#mask)'>")
    } else {
        ("0 0 108 108", "<g>")
    };
    svg(format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='{view}'>{clip}{background}{foreground}</g></svg>"), source)
}

fn layer(icon: &ProjectIcon) -> Option<String> {
    Some(format!(
        "<image href='{}' width='108' height='108'/>",
        xml_escape(icon.src.as_ref()?)
    ))
}

fn solid(color: &str) -> String {
    format!(
        "<rect width='108' height='108' fill='{}'/>",
        xml_escape(color)
    )
}

fn hex_color(value: &str, android: bool) -> Option<String> {
    if ["transparent", "black", "white"].contains(&value) {
        return Some(value.into());
    }
    let digits = value.strip_prefix('#')?;
    if ![3, 4, 6, 8].contains(&digits.len()) || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(if android && digits.len() == 8 {
        format!("#{}{}", &digits[2..], &digits[..2])
    } else if android && digits.len() == 4 {
        format!("#{}{}", &digits[1..], &digits[..1])
    } else {
        value.into()
    })
}

fn expo(root: &Path, base: &Path) -> Option<ProjectIcon> {
    for name in ["app.config.json", "app.json"] {
        let Some(config) = json(root, &base.join(name)) else {
            continue;
        };
        let config = config.get("expo").unwrap_or(&config);
        let load = |value: &Value| {
            value
                .as_str()
                .and_then(|value| reference(base, value))
                .and_then(|path| image(root, &path, "Expo app icon"))
        };
        let ios = &config["ios"]["icon"];
        let mut icon = load(&ios["light"])
            .or_else(|| load(ios))
            .or_else(|| load(&config["icon"]))
            .or_else(|| load(&config["android"]["icon"]));
        if let Some(icon) = &mut icon {
            icon.dark_src = load(&ios["dark"]).and_then(|icon| icon.src);
        }
        if icon.is_some() {
            return icon;
        }
        let adaptive = &config["android"]["adaptiveIcon"];
        if let Some(foreground) = load(&adaptive["foregroundImage"]).and_then(|icon| layer(&icon)) {
            let background = load(&adaptive["backgroundImage"])
                .and_then(|icon| layer(&icon))
                .or_else(|| {
                    adaptive["backgroundColor"]
                        .as_str()
                        .and_then(|v| hex_color(v, false))
                        .map(|v| solid(&v))
                })
                .unwrap_or_else(|| solid("white"));
            return composite(&background, &foreground, "Expo adaptive app icon", true);
        }
    }
    None
}

fn godot(root: &Path, path: &Path) -> Option<ProjectIcon> {
    let config = text(root, path)?;
    let mut application = false;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            application = line == "[application]";
        }
        if application {
            if let Some((key, value)) = line.split_once('=') {
                if key.trim() == "config/icon" {
                    let value: String = serde_json::from_str(value.trim()).ok()?;
                    let value = value.strip_prefix("res://")?;
                    return image(
                        root,
                        &reference(path.parent()?, value)?,
                        "Godot project icon",
                    );
                }
            }
        }
    }
    None
}

fn electron(root: &Path) -> Option<ProjectIcon> {
    let package = json(root, &root.join("package.json"));
    let standalone = json(root, &root.join("electron-builder.json"));
    let configs = [
        standalone.as_ref(),
        package.as_ref().and_then(|p| p.get("build")),
    ];
    for config in configs.into_iter().flatten() {
        let resources = config
            .pointer("/directories/buildResources")
            .and_then(Value::as_str)
            .unwrap_or("build");
        let Some(resources) = reference(root, resources) else {
            continue;
        };
        let configured = ["/mac/icon", "/win/icon", "/linux/icon", "/icon"]
            .into_iter()
            .filter_map(|key| config.pointer(key).and_then(Value::as_str));
        let mut candidates = Vec::new();
        for value in configured.chain(["icon", "icons"]) {
            for base in [&resources, root] {
                let Some(path) = reference(base, value) else {
                    continue;
                };
                candidates.push(path.clone());
                if path.extension().is_none() {
                    for ext in ["svg", "png", "ico", "icns"] {
                        candidates.push(path.with_extension(ext));
                    }
                    for size in [
                        "128x128.png",
                        "128.png",
                        "256x256.png",
                        "256.png",
                        "512x512.png",
                        "512.png",
                    ] {
                        candidates.push(path.join(size));
                    }
                }
            }
        }
        if let Some(icon) = first_image(root, &candidates, "Electron app icon") {
            return Some(icon);
        }
    }
    None
}

fn apple(root: &Path, path: &Path) -> Option<ProjectIcon> {
    let catalog = json(root, path)?;
    let mut entries: Vec<_> = catalog["images"].as_array()?.iter().collect();
    entries.sort_by_key(|entry| {
        let size = entry["size"]
            .as_str()
            .and_then(|s| s.split('x').next()?.parse::<u32>().ok())
            .unwrap_or(1024);
        (entry["idiom"].as_str() == Some("watch"), size.abs_diff(128))
    });
    let load = |dark: bool| {
        entries.iter().find_map(|entry| {
            let appearances = entry["appearances"].as_array();
            let is_dark =
                appearances.is_some_and(|values| values.iter().any(|v| v["value"] == "dark"));
            let tinted =
                appearances.is_some_and(|values| values.iter().any(|v| v["value"] == "tinted"));
            if dark != is_dark || tinted {
                return None;
            }
            image(
                root,
                &reference(path.parent()?, entry["filename"].as_str()?)?,
                "Xcode app icon",
            )
        })
    };
    let dark = load(true);
    let mut icon = load(false).or_else(|| dark.clone())?;
    icon.dark_src = dark.and_then(|icon| icon.src);
    Some(icon)
}

fn qualified_image(root: &Path, path: &Path, source: &str) -> Option<ProjectIcon> {
    if let Some(icon) = image(root, path, source) {
        return Some(icon);
    }
    let stem = path.file_stem()?.to_str()?;
    let ext = path.extension()?.to_str()?;
    let prefix = format!("{stem}.");
    let mut variants: Vec<_> = fs::read_dir(path.parent()?)
        .ok()?
        .flatten()
        .take(256)
        .map(|entry| entry.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some(ext))
        .filter(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.starts_with(&prefix))
        })
        .collect();
    variants.sort_by_key(|path| {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        (
            name.contains("contrast-") || name.contains("altform-"),
            !name.contains("scale-200"),
            path.clone(),
        )
    });
    variants.iter().find_map(|path| image(root, path, source))
}

fn windows(root: &Path, path: &Path) -> Option<ProjectIcon> {
    let config = text(root, path)?;
    let document = xml(&config)?;
    let base = path.parent()?;
    let source = "Windows app icon";
    for node in document.descendants().filter(Node::is_element) {
        if node.tag_name().name() == "VisualElements" {
            for key in ["Square150x150Logo", "Square44x44Logo", "Logo"] {
                if let Some(icon) = node
                    .attribute(key)
                    .and_then(|value| reference(base, value))
                    .and_then(|path| qualified_image(root, &path, source))
                {
                    return Some(icon);
                }
            }
        }
        if ["ApplicationIcon", "Win32Icon", "Logo"].contains(&node.tag_name().name()) {
            if let Some(icon) = node
                .text()
                .map(|v| v.replace("$(MSBuildProjectDirectory)", &base.to_string_lossy()))
                .and_then(|value| reference(base, &value))
                .and_then(|path| qualified_image(root, &path, source))
            {
                return Some(icon);
            }
        }
        if node.tag_name().name() == "MauiIcon" {
            if let Some(icon) = node
                .attribute("Include")
                .and_then(|v| reference(base, v))
                .and_then(|path| image(root, &path, ".NET MAUI app icon"))
            {
                if let Some(foreground) = node
                    .attribute("ForegroundFile")
                    .and_then(|v| reference(base, v))
                    .and_then(|path| image(root, &path, ".NET MAUI app icon"))
                {
                    return composite(
                        &layer(&icon)?,
                        &layer(&foreground)?,
                        ".NET MAUI app icon",
                        false,
                    );
                }
                return Some(icon);
            }
        }
    }
    None
}

fn android_attr<'a>(node: Node<'a, '_>, key: &str) -> Option<&'a str> {
    node.attribute((ANDROID, key))
        .or_else(|| node.attribute(key))
}

fn android_color(root: &Path, res: &Path, value: &str, depth: usize) -> Option<String> {
    if depth > 8 {
        return None;
    }
    if let Some(color) = hex_color(value, true) {
        return Some(color);
    }
    if let Some(value) = value.strip_prefix("@android:color/") {
        return hex_color(value, true);
    }
    let name = value.strip_prefix("@color/")?;
    let mut files: Vec<_> = fs::read_dir(res.join("values"))
        .ok()?
        .flatten()
        .take(64)
        .map(|e| e.path())
        .collect();
    files.sort();
    for path in files {
        let Some(contents) = text(root, &path) else {
            continue;
        };
        let Some(doc) = xml(&contents) else {
            continue;
        };
        for node in doc.descendants().filter(|n| n.has_tag_name("color")) {
            if node.attribute("name") == Some(name) {
                return android_color(root, res, node.text()?.trim(), depth + 1);
            }
        }
    }
    None
}

fn number(node: Node<'_, '_>, key: &str, default: f64) -> Option<f64> {
    let value: f64 = match android_attr(node, key) {
        Some(v) => v.parse().ok()?,
        None => default,
    };
    (value.is_finite() && value.abs() < 1_000_000.0).then_some(value)
}

fn vector_children(root: &Path, res: &Path, node: Node<'_, '_>, depth: usize) -> Option<String> {
    if depth > 16 {
        return None;
    }
    let mut result = String::new();
    for child in node.children().filter(Node::is_element) {
        match child.tag_name().name() {
            "path" => {
                // Trimmed paths, gradients and clip paths need a full Android
                // renderer. Reject these instead of showing an incomplete mark.
                if child.children().any(|n| n.is_element())
                    || android_attr(child, "trimPathStart").is_some()
                    || android_attr(child, "trimPathEnd").is_some()
                {
                    return None;
                }
                let color = |key, default| {
                    android_color(root, res, android_attr(child, key).unwrap_or(default), 0)
                };
                let fill = color("fillColor", "transparent")?;
                let stroke = color("strokeColor", "transparent")?;
                result.push_str(&format!("<path d='{}' fill='{}' stroke='{}' fill-opacity='{}' stroke-opacity='{}' stroke-width='{}' fill-rule='{}' stroke-linecap='{}' stroke-linejoin='{}'/>",
                    xml_escape(android_attr(child, "pathData")?), fill, stroke,
                    number(child, "fillAlpha", 1.0)?, number(child, "strokeAlpha", 1.0)?, number(child, "strokeWidth", 0.0)?,
                    if android_attr(child, "fillType") == Some("evenOdd") { "evenodd" } else { "nonzero" },
                    match android_attr(child, "strokeLineCap") { Some("round") => "round", Some("square") => "square", _ => "butt" },
                    match android_attr(child, "strokeLineJoin") { Some("round") => "round", Some("bevel") => "bevel", _ => "miter" }));
            }
            "group" => {
                let x = number(child, "pivotX", 0.0)?;
                let y = number(child, "pivotY", 0.0)?;
                result.push_str(&format!("<g transform='translate({} {}) rotate({}) scale({} {}) translate({} {})'>{}</g>",
                    x + number(child, "translateX", 0.0)?, y + number(child, "translateY", 0.0)?,
                    number(child, "rotation", 0.0)?, number(child, "scaleX", 1.0)?, number(child, "scaleY", 1.0)?,
                    -x, -y, vector_children(root, res, child, depth + 1)?));
            }
            _ => return None,
        }
    }
    (!result.is_empty()).then_some(result)
}

fn android_drawable(
    root: &Path,
    res: &Path,
    node: Node<'_, '_>,
    depth: usize,
) -> Option<ProjectIcon> {
    if depth > 8 {
        return None;
    }
    match node.tag_name().name() {
        "vector" => {
            let width = number(node, "viewportWidth", 0.0)?;
            let height = number(node, "viewportHeight", 0.0)?;
            if width <= 0.0 || height <= 0.0 {
                return None;
            }
            svg(format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {width} {height}' opacity='{}'>{}</svg>",
                number(node, "alpha", 1.0)?, vector_children(root, res, node, 0)?), "Android vector app icon")
        }
        "adaptive-icon" => {
            let get_layer = |name| {
                let node = node.children().find(|n| n.has_tag_name(name))?;
                if let Some(value) = android_attr(node, "drawable") {
                    if let Some(color) = android_color(root, res, value, 0) {
                        return Some(solid(&color));
                    }
                    return android_resource(root, res, value, depth + 1)
                        .and_then(|icon| layer(&icon));
                }
                android_drawable(
                    root,
                    res,
                    node.children().find(Node::is_element)?,
                    depth + 1,
                )
                .and_then(|icon| layer(&icon))
            };
            composite(
                &get_layer("background")?,
                &get_layer("foreground")?,
                "Android adaptive app icon",
                true,
            )
        }
        "bitmap" => android_resource(root, res, android_attr(node, "src")?, depth + 1),
        _ => None,
    }
}

fn android_resource(root: &Path, res: &Path, value: &str, depth: usize) -> Option<ProjectIcon> {
    if depth > 8 {
        return None;
    }
    let (kind, name) = value.strip_prefix('@')?.split_once('/')?;
    if !["drawable", "mipmap"].contains(&kind)
        || name.is_empty()
        || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        return None;
    }
    let mut dirs: Vec<_> = fs::read_dir(res)
        .ok()?
        .flatten()
        .take(128)
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s == kind || s.starts_with(&format!("{kind}-")))
        })
        .collect();
    dirs.sort_by_key(|path| {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        let rank = ["anydpi", "xxxhdpi", "xxhdpi", "xhdpi", "hdpi", "mdpi"]
            .iter()
            .position(|v| name.contains(v))
            .unwrap_or(6);
        (name.contains("night"), rank, path.clone())
    });
    for dir in dirs {
        for ext in ["png", "webp", "jpg", "xml"] {
            let path = dir.join(format!("{name}.{ext}"));
            if ext != "xml" {
                if let Some(icon) = image(root, &path, "Android launcher icon") {
                    return Some(icon);
                }
            } else if let Some(contents) = text(root, &path) {
                if let Some(document) = xml(&contents) {
                    if let Some(icon) = android_drawable(root, res, document.root_element(), depth)
                    {
                        return Some(icon);
                    }
                }
            }
        }
    }
    None
}

fn android(root: &Path, path: &Path) -> Option<ProjectIcon> {
    let config = text(root, path)?;
    let document = xml(&config)?;
    let application = document
        .descendants()
        .find(|n| n.has_tag_name("application"))?;
    for key in ["icon", "roundIcon"] {
        if let Some(icon) = android_attr(application, key)
            .and_then(|value| android_resource(root, &path.parent()?.join("res"), value, 0))
        {
            return Some(icon);
        }
    }
    None
}

fn desktop(root: &Path, path: &Path, files: &[PathBuf]) -> Option<ProjectIcon> {
    let contents = text(root, path)?;
    let mut desktop = false;
    for line in contents.lines().map(str::trim) {
        if line.starts_with('[') {
            desktop = line == "[Desktop Entry]";
        }
        if !desktop {
            continue;
        }
        let Some(value) = line.strip_prefix("Icon=").map(str::trim) else {
            continue;
        };
        if let Some(icon) = reference(path.parent()?, value)
            .and_then(|p| image(root, &p, "Linux desktop app icon"))
            .or_else(|| {
                reference(root, value).and_then(|p| image(root, &p, "Linux desktop app icon"))
            })
        {
            return Some(icon);
        }
        // Resolve named theme icons only from this project's checked-in assets.
        return files
            .iter()
            .filter(|p| p.file_stem().and_then(|s| s.to_str()) == Some(value))
            .find_map(|p| image(root, p, "Linux desktop app icon"));
    }
    None
}

fn metadata_files(root: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(root)
        .min_depth(1)
        .max_depth(8)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
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
                        | "Pods"
                        | "Carthage"
                        | "DerivedData"
                        | "bin"
                        | "obj"
                )
        })
        .take(3500)
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .collect()
}

fn project_root(root: &Path) -> bool {
    [
        ".git",
        "package.json",
        "project.godot",
        "app.json",
        "app.config.json",
        "Cargo.toml",
        "pyproject.toml",
        "meson.build",
        "CMakeLists.txt",
        "android",
        "ios",
        "AndroidManifest.xml",
    ]
    .iter()
    .any(|name| root.join(name).exists())
        || fs::read_dir(root).ok().is_some_and(|entries| {
            entries.flatten().take(128).any(|entry| {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                [
                    ".xcodeproj",
                    ".xcworkspace",
                    ".xcassets",
                    ".csproj",
                    ".fsproj",
                    ".vbproj",
                    ".sln",
                    ".appxmanifest",
                    ".desktop",
                    ".desktop.in",
                ]
                .iter()
                .any(|suffix| name.ends_with(suffix))
            })
        })
}

pub(super) fn discover(root: &Path) -> Option<ProjectIcon> {
    if let Some(icon) = expo(root, root)
        .or_else(|| godot(root, &root.join("project.godot")))
        .or_else(|| electron(root))
    {
        return Some(icon);
    }
    if !project_root(root) {
        return None;
    }
    let mut files = metadata_files(root);
    // Prefer the application's catalog and release source set over sample apps
    // and debug manifests. Metadata parsing never invokes a build tool or script.
    let mut catalog_names = vec!["AppIcon".to_owned()];
    static CATALOG: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"ASSETCATALOG_COMPILER_APPICON_NAME\s*=\s*"?([^";\s]+)"#).unwrap()
    });
    for path in files
        .iter()
        .filter(|p| p.file_name().is_some_and(|name| name == "project.pbxproj"))
    {
        if let Some(contents) = text(root, path) {
            for name in CATALOG.captures_iter(&contents) {
                catalog_names.insert(0, name[1].to_owned());
            }
        }
    }
    files.sort_by_key(|path| {
        let parts: Vec<_> = path
            .strip_prefix(root)
            .unwrap_or(path)
            .iter()
            .map(|s| s.to_string_lossy())
            .collect();
        let catalog = path
            .parent()
            .and_then(|p| p.file_stem())
            .and_then(|s| s.to_str());
        let catalog_rank = catalog_names
            .iter()
            .position(|name| Some(name.as_str()) == catalog)
            .unwrap_or(catalog_names.len());
        (
            parts.iter().any(|p| {
                ["example", "examples", "sample", "samples", "debug"].contains(&p.as_ref())
            }),
            catalog_rank,
            parts.len(),
            path.clone(),
        )
    });
    for path in &files {
        let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        let icon = if name == "contents.json"
            && path
                .parent()?
                .extension()
                .is_some_and(|e| e == "appiconset")
        {
            apple(root, path)
        } else if name == "androidmanifest.xml" {
            android(root, path)
        } else if name.ends_with(".appxmanifest")
            || [".csproj", ".fsproj", ".vbproj"]
                .iter()
                .any(|e| name.ends_with(e))
        {
            windows(root, path)
        } else if name == "project.godot" {
            godot(root, path)
        } else if name.ends_with(".desktop") || name.ends_with(".desktop.in") {
            desktop(root, path, &files)
        } else if name == "app.json" || name == "app.config.json" {
            expo(root, path.parent()?)
        } else {
            None
        };
        if icon.is_some() {
            return icon;
        }
    }
    None
}
