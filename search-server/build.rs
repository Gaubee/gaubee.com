//! 链接 alibaba/zvec 官方 0.8.1 C SDK。
//!
//! SDK 通过 `scripts/fetch-zvec-sdk.sh` 下载到 `search-server/.cache/zvec-sdk`
//! （或由 `ZVEC_SDK_DIR` 显式指定）。这里只声明 link search 与 rpath，
//! 运行期 libzvec_c_api 依赖同目录的 libzvec_core / libzvec_ailego。
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::process::Command;

fn main() {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let sdk_dir = std::env::var("ZVEC_SDK_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest_dir.join(".cache/zvec-sdk"));

    let lib_dir = if sdk_dir.join("lib").is_dir() {
        sdk_dir.join("lib")
    } else {
        sdk_dir.clone()
    };

    if !lib_dir.is_dir() {
        panic!(
            "zvec SDK 未找到：{}。先运行 search-server/scripts/fetch-zvec-sdk.sh，或设置 ZVEC_SDK_DIR",
            lib_dir.display()
        );
    }

    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib=dylib=zvec_c_api");

    // 本机/容器运行时都能从 SDK lib 目录加载 zvec 依赖库。
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib_dir.display());
        // ort-sys 的静态 ONNX Runtime 引用了 ___isPlatformVersionAtLeast，
        // 该符号由 clang 的 darwin 运行时提供（Rust 未自动链接）。
        if let Ok(output) = Command::new("clang").arg("-print-runtime-dir").output() {
            if output.status.success() {
                let runtime_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !runtime_dir.is_empty() {
                    println!("cargo:rustc-link-search=native={runtime_dir}");
                }
            }
        }
        println!("cargo:rustc-link-arg=-lclang_rt.osx");
    }
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib_dir.display());

    println!("cargo:rerun-if-env-changed=ZVEC_SDK_DIR");
    println!("cargo:rerun-if-changed={}", lib_dir.display());
}
