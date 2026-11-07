use super::*;

const MARK: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><rect width="108" height="108" rx="24" fill="#574bd6"/><path d="M30 54h48M54 30v48" stroke="white" stroke-width="12"/></svg>"##;

fn put(root: &Path, name: &str, value: impl AsRef<[u8]>) {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, value).unwrap();
}

fn resolve(root: &Path) -> ProjectIcon {
    super::super::discover(root.to_str().unwrap())
}

fn preview(icon: &ProjectIcon) {
    if let Ok(dir) = std::env::var("AGENT_USAGE_ICON_PREVIEW_DIR") {
        let dir = Path::new(&dir);
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join(format!("{}.json", icon.source.replace(' ', "-"))),
            serde_json::to_vec(icon).unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn expo_reads_static_config_and_appearance_variants_without_executing_code() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        "app.json",
        r#"{"expo":{"icon":"branding/day.svg","ios":{"icon":{"light":"branding/day.svg","dark":"branding/night.svg"}}}}"#,
    );
    put(dir.path(), "branding/day.svg", MARK);
    put(
        dir.path(),
        "branding/night.svg",
        MARK.replace("#574bd6", "#a69bff"),
    );
    put(
        dir.path(),
        "app.config.js",
        "throw new Error('must never execute')",
    );
    let icon = resolve(dir.path());
    assert_eq!(icon.source, "Expo app icon");
    assert_ne!(icon.src, icon.dark_src);
    preview(&icon);
}

#[test]
fn expo_adaptive_layers_are_embedded_and_remote_paths_are_skipped() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        "app.json",
        r##"{"expo":{"icon":"https://example.com/icon.png","android":{"adaptiveIcon":{"foregroundImage":"mark.svg","backgroundColor":"#ffcc00"}}}}"##,
    );
    put(dir.path(), "mark.svg", MARK);
    let icon = resolve(dir.path());
    assert_eq!(icon.source, "Expo adaptive app icon");
    let svg = STANDARD
        .decode(icon.src.as_ref().unwrap().split_once(',').unwrap().1)
        .unwrap();
    let document = Document::parse(std::str::from_utf8(&svg).unwrap()).unwrap();
    assert!(document
        .descendants()
        .any(|n| n.attribute("fill") == Some("#ffcc00")));
    preview(&icon);
}

#[test]
fn apple_uses_the_declared_asset_set_and_dark_variants() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        "ios/App.xcodeproj/project.pbxproj",
        "ASSETCATALOG_COMPILER_APPICON_NAME = Branding;",
    );
    put(
        dir.path(),
        "ios/Assets.xcassets/AppIcon.appiconset/Contents.json",
        r#"{"images":[{"filename":"default.svg"}]}"#,
    );
    put(
        dir.path(),
        "ios/Assets.xcassets/AppIcon.appiconset/default.svg",
        MARK,
    );
    put(
        dir.path(),
        "ios/Assets.xcassets/Branding.appiconset/Contents.json",
        r#"{"images":[{"filename":"chosen.svg","idiom":"universal"},{"filename":"dark.svg","appearances":[{"appearance":"luminosity","value":"dark"}]}]}"#,
    );
    put(
        dir.path(),
        "ios/Assets.xcassets/Branding.appiconset/chosen.svg",
        MARK.replace("#574bd6", "#cc3300"),
    );
    put(
        dir.path(),
        "ios/Assets.xcassets/Branding.appiconset/dark.svg",
        MARK.replace("#574bd6", "#883300"),
    );
    let icon = resolve(dir.path());
    assert_eq!(icon.source, "Xcode app icon");
    assert!(String::from_utf8(
        STANDARD
            .decode(icon.src.as_ref().unwrap().split_once(',').unwrap().1)
            .unwrap()
    )
    .unwrap()
    .contains("#cc3300"));
    assert_ne!(icon.src, icon.dark_src);
    preview(&icon);
}

#[test]
fn android_follows_manifest_resource_names_and_prefers_high_density_images() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        "android/app/src/main/AndroidManifest.xml",
        format!(
            r#"<manifest xmlns:android="{ANDROID}"><application android:icon="@mipmap/company_mark"/></manifest>"#
        ),
    );
    let png = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==").unwrap();
    put(
        dir.path(),
        "android/app/src/main/res/mipmap-xxxhdpi/company_mark.png",
        png,
    );
    let icon = resolve(dir.path());
    assert_eq!(icon.source, "Android launcher icon");
    preview(&icon);
}

fn android_fixture(root: &Path) {
    put(
        root,
        "android/app/src/main/AndroidManifest.xml",
        format!(
            r#"<manifest xmlns:a="{ANDROID}"><application a:icon="@mipmap/custom_launcher"/></manifest>"#
        ),
    );
    put(
        root,
        "android/app/src/main/res/mipmap-anydpi-v26/custom_launcher.xml",
        format!(
            r#"<adaptive-icon xmlns:a="{ANDROID}"><background a:drawable="@color/brand"/><foreground a:drawable="@drawable/foreground"/></adaptive-icon>"#
        ),
    );
    put(
        root,
        "android/app/src/main/res/values/colors.xml",
        "<resources><color name='brand'>#FF574BD6</color></resources>",
    );
    put(
        root,
        "android/app/src/main/res/drawable/foreground.xml",
        format!(
            r##"<vector xmlns:a="{ANDROID}" a:viewportWidth="108" a:viewportHeight="108"><group a:translateX="0"><path a:fillColor="#FFFFFFFF" a:pathData="M30,46 H46 V30 H62 V46 H78 V62 H62 V78 H46 V62 H30 Z"/></group></vector>"##
        ),
    );
}

#[test]
fn android_composes_adaptive_vector_and_color_resources() {
    let dir = tempfile::tempdir().unwrap();
    android_fixture(dir.path());
    let icon = resolve(dir.path());
    assert_eq!(icon.source, "Android adaptive app icon");
    let svg = STANDARD
        .decode(icon.src.as_ref().unwrap().split_once(',').unwrap().1)
        .unwrap();
    let document = Document::parse(std::str::from_utf8(&svg).unwrap()).unwrap();
    assert!(document
        .descendants()
        .any(|n| n.attribute("fill") == Some("#574BD6FF")));
    assert!(document.descendants().any(|n| n.has_tag_name("image")));
    preview(&icon);
}

#[test]
fn android_resource_cycles_and_malformed_xml_fall_back() {
    let dir = tempfile::tempdir().unwrap();
    android_fixture(dir.path());
    put(
        dir.path(),
        "android/app/src/main/res/drawable/foreground.xml",
        format!(r#"<bitmap xmlns:a="{ANDROID}" a:src="@drawable/foreground"/>"#),
    );
    assert!(resolve(dir.path()).src.is_none());
    put(
        dir.path(),
        "android/app/src/main/AndroidManifest.xml",
        "<malformed>",
    );
    assert!(resolve(dir.path()).src.is_none());
}

#[test]
fn windows_resolves_manifest_qualified_assets_and_xml_namespaces() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        "Package.appxmanifest",
        r#"<Package xmlns:uap="urn:test"><Applications><Application><uap:VisualElements Square150x150Logo="Assets\Company.svg"/></Application></Applications></Package>"#,
    );
    put(dir.path(), "Assets/Company.scale-200.svg", MARK);
    let icon = resolve(dir.path());
    assert_eq!(icon.source, "Windows app icon");
    preview(&icon);
}

#[test]
fn dotnet_reads_application_icon_and_maui_layers() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        "App.csproj",
        r#"<Project><PropertyGroup><ApplicationIcon>$(MSBuildProjectDirectory)/brand.svg</ApplicationIcon></PropertyGroup></Project>"#,
    );
    put(dir.path(), "brand.svg", MARK);
    assert_eq!(resolve(dir.path()).source, "Windows app icon");
    put(
        dir.path(),
        "App.csproj",
        r#"<Project><ItemGroup><MauiIcon Include="brand.svg" ForegroundFile="foreground.svg"/></ItemGroup></Project>"#,
    );
    put(dir.path(), "foreground.svg", MARK);
    let icon = resolve(dir.path());
    assert_eq!(icon.source, ".NET MAUI app icon");
    preview(&icon);
}

#[test]
fn godot_resolves_res_paths_and_ignores_other_sections() {
    let dir = tempfile::tempdir().unwrap();
    put(dir.path(), "project.godot", "[unrelated]\nconfig/icon=\"wrong.svg\"\n[application]\nconfig/icon=\"res://branding/game.svg\"\n");
    put(dir.path(), "branding/game.svg", MARK);
    let icon = resolve(dir.path());
    assert_eq!(icon.source, "Godot project icon");
    preview(&icon);
}

#[test]
fn linux_uses_desktop_entry_theme_name_and_ignores_action_icons() {
    let dir = tempfile::tempdir().unwrap();
    put(dir.path(), "meson.build", "project('example')");
    put(
        dir.path(),
        "data/com.example.App.desktop",
        "[Desktop Entry]\nName=Example\nIcon=com.example.App\n[Desktop Action Open]\nIcon=wrong\n",
    );
    put(
        dir.path(),
        "data/icons/hicolor/scalable/apps/com.example.App.svg",
        MARK,
    );
    let icon = resolve(dir.path());
    assert_eq!(icon.source, "Linux desktop app icon");
    preview(&icon);
}

#[test]
fn declared_assets_cannot_escape_project_scope_or_expand_xml_entities() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    put(outside.path(), "secret.svg", MARK);
    put(
        root.path(),
        "App.csproj",
        format!(
            "<Project><ApplicationIcon>{}/secret.svg</ApplicationIcon></Project>",
            outside.path().display()
        ),
    );
    assert!(resolve(root.path()).src.is_none());
    put(
        root.path(),
        "App.csproj",
        r#"<!DOCTYPE Project [<!ENTITY icon SYSTEM "file:///etc/passwd">]><Project><ApplicationIcon>&icon;</ApplicationIcon></Project>"#,
    );
    assert!(resolve(root.path()).src.is_none());
}

#[test]
fn icns_extracts_embedded_png_and_rejects_invalid_chunk_lengths() {
    let dir = tempfile::tempdir().unwrap();
    let png = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==").unwrap();
    let mut icns = b"icns".to_vec();
    icns.extend_from_slice(&((16 + png.len()) as u32).to_be_bytes());
    icns.extend_from_slice(b"ic07");
    icns.extend_from_slice(&((8 + png.len()) as u32).to_be_bytes());
    icns.extend_from_slice(&png);
    put(dir.path(), "build/icon.icns", &icns);
    assert!(resolve(dir.path())
        .src
        .unwrap()
        .starts_with("data:image/png;base64,"));
    icns[12..16].copy_from_slice(&0u32.to_be_bytes());
    put(dir.path(), "build/icon.icns", icns);
    assert!(resolve(dir.path()).src.is_none());
}

#[test]
fn electron_resolves_custom_build_resources_and_extensionless_icon_paths() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        "package.json",
        r#"{"build":{"directories":{"buildResources":"packaging"},"mac":{"icon":"company"}}}"#,
    );
    put(dir.path(), "packaging/company.svg", MARK);
    let icon = resolve(dir.path());
    assert_eq!(icon.source, "Electron app icon");
    preview(&icon);
    fs::remove_file(dir.path().join("package.json")).unwrap();
    put(
        dir.path(),
        "electron-builder.json",
        r#"{"icon":"packaging/company.svg"}"#,
    );
    assert_eq!(resolve(dir.path()).source, "Electron app icon");
}

#[test]
fn large_composites_and_excessive_xml_nodes_are_bounded() {
    assert!(svg("x".repeat(MAX_FILE as usize + 1), "test").is_none());
    let xml_text = format!("<root>{}</root>", "<node/>".repeat(20_000));
    assert!(xml(&xml_text).is_none());
}
