fn main() {
    let mut commit = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    if commit.is_empty() {
        commit = "unknown".to_string();
    }

    println!("cargo:rustc-env=GIT_COMMIT={}", commit);
    tauri_build::build()
}
