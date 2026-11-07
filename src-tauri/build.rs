fn main() {
    println!(
        "cargo:rustc-env=AGENT_USAGE_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build();
}
