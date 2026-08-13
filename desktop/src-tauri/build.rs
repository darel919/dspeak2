fn env_flag(name: &str) -> Option<bool> {
    match std::env::var(name).ok()?.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn artifact_mediasoup_mode(artifact_dir: &std::path::Path) -> Option<bool> {
    let marker = artifact_dir.join("native-media-features");
    let contents = std::fs::read_to_string(marker).ok()?;
    let value = contents
        .lines()
        .find_map(|line| line.strip_prefix("mediasoup="))?;
    match value.trim() {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

fn main() {
    let is_media_worker = std::env::var("NATIVE_MEDIA_WORKER_BUILD")
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    if !is_media_worker {
        tauri_build::build();
    }
    println!("cargo:rustc-check-cfg=cfg(native_rtc)");
    println!("cargo:rustc-check-cfg=cfg(native_mediasoup)");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=NATIVE_MEDIA_ARTIFACT_DIR");
    println!("cargo:rerun-if-env-changed=NATIVE_MEDIA_BUILD_DIR");
    println!("cargo:rerun-if-env-changed=NATIVE_MEDIA_WITH_MEDIASOUP");
    println!("cargo:rerun-if-env-changed=NATIVE_MEDIA_WORKER_BUILD");

    let artifact_dir = std::env::var_os("NATIVE_MEDIA_ARTIFACT_DIR").unwrap_or_else(|| {
        panic!(
            "NATIVE_MEDIA_ARTIFACT_DIR is required for desktop builds; browser WebRTC is web-only"
        )
    });
    let artifact_dir = std::path::PathBuf::from(artifact_dir);
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let include_dir = artifact_dir.join("include");
    let lib_dir = artifact_dir.join("lib");
    let build_dir = std::env::var_os("NATIVE_MEDIA_BUILD_DIR").map(std::path::PathBuf::from);
    let json_header = include_dir.join("json.hpp");
    let json_from_build = build_dir
        .as_ref()
        .map(|path| path.join("_deps/libsdptransform-src/include/json.hpp"));
    let core_libraries = if target_os == "windows" {
        vec![
            vec![
                lib_dir.join("dspeak_media.lib"),
                lib_dir.join("libdspeak_media.lib"),
            ],
            vec![lib_dir.join("webrtc.lib"), lib_dir.join("libwebrtc.lib")],
        ]
    } else {
        vec![
            vec![lib_dir.join("libdspeak_media.a")],
            vec![lib_dir.join("libwebrtc.a")],
        ]
    };
    let mediasoup_libraries = if target_os == "windows" {
        vec![
            vec![
                lib_dir.join("mediasoupclient.lib"),
                lib_dir.join("libmediasoupclient.lib"),
            ],
            vec![
                lib_dir.join("sdptransform.lib"),
                lib_dir.join("libsdptransform.lib"),
            ],
        ]
    } else {
        vec![
            vec![lib_dir.join("libmediasoupclient.a")],
            vec![lib_dir.join("libsdptransform.a")],
        ]
    };
    let mediasoup_available = mediasoup_libraries
        .iter()
        .all(|candidates| candidates.iter().any(|path| path.is_file()));
    let requested_mediasoup = env_flag("NATIVE_MEDIA_WITH_MEDIASOUP");
    let marked_mediasoup = artifact_mediasoup_mode(&artifact_dir);
    if let (Some(requested), Some(marked)) = (requested_mediasoup, marked_mediasoup) {
        if requested != marked {
            panic!(
                "native media artifact feature marker requires NATIVE_MEDIA_WITH_MEDIASOUP={}",
                if marked { 1 } else { 0 }
            );
        }
    }
    let with_mediasoup = requested_mediasoup
        .or(marked_mediasoup)
        .unwrap_or(mediasoup_available);
    if matches!(target_os.as_str(), "macos" | "windows") && !with_mediasoup {
        panic!(
            "native macOS and Windows builds require the mediasoupclient and sdptransform transport libraries"
        );
    }
    let mut required_libraries = core_libraries;
    if with_mediasoup {
        required_libraries.extend(mediasoup_libraries.iter().cloned());
    }
    for candidates in &required_libraries {
        for path in candidates {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    let missing = required_libraries
        .iter()
        .filter(|candidates| !candidates.iter().any(|path| path.is_file()))
        .map(|candidates| {
            candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(" or ")
        })
        .chain((!include_dir.is_dir()).then(|| include_dir.display().to_string()))
        .chain((!json_header.is_file() && !json_from_build.as_ref().is_some_and(|path| path.is_file()))
            .then(|| "include/json.hpp or NATIVE_MEDIA_BUILD_DIR/_deps/libsdptransform-src/include/json.hpp".to_string()))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        panic!(
            "native media artifact is incomplete for the selected native transport features: {}",
            missing.join(", ")
        );
    }

    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=DSPEAK_TARGET_TRIPLE={target}");
    }

    if is_media_worker && with_mediasoup {
        println!("cargo:rustc-cfg=native_mediasoup");
    }

    if target_os == "linux" {
        let pipewire = std::process::Command::new("pkg-config")
            .args(["--exists", "libpipewire-0.3", "libspa-0.2"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !pipewire {
            println!(
                "cargo:warning=Linux PipeWire/SPA development dependencies are unavailable; native capture remains unsupported"
            );
        }
    }
    if is_media_worker {
        println!("cargo:rustc-cfg=native_rtc");
        println!("cargo:rustc-link-search=native={}", lib_dir.display());
        println!("cargo:rustc-link-lib=static=dspeak_media");
        if with_mediasoup {
            println!("cargo:rustc-link-lib=static=mediasoupclient");
            println!("cargo:rustc-link-lib=static=sdptransform");
        }
        println!("cargo:rustc-link-lib=static=webrtc");
    }

    if target_os == "macos" {
        println!("cargo:rustc-link-lib=dylib=c++");
        for framework in [
            "CoreFoundation",
            "CoreAudio",
            "AudioToolbox",
            "CoreVideo",
            "CoreMedia",
            "VideoToolbox",
            "CoreGraphics",
            "IOSurface",
            "IOKit",
            "Foundation",
            "AppKit",
            "AVFoundation",
            "ScreenCaptureKit",
            "Security",
            "Cocoa",
            "OpenGL",
            "Metal",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    } else if target_os == "linux" {
        println!("cargo:rustc-link-lib=dl");
        println!("cargo:rustc-link-lib=pthread");
    } else if target_os == "windows" {
        for library in [
            "advapi32",
            "bcrypt",
            "crypt32",
            "combase",
            "d3d11",
            "d3dcompiler",
            "dxgi",
            "iphlpapi",
            "windowscodecs",
            "mf",
            "mfplat",
            "mfreadwrite",
            "mfuuid",
            "mmdevapi",
            "avrt",
            "propsys",
            "secur32",
            "setupapi",
            "shell32",
            "shlwapi",
            "ole32",
            "oleaut32",
            "uuid",
            "user32",
            "gdi32",
            "dwmapi",
            "shcore",
            "userenv",
            "version",
            "winmm",
            "ws2_32",
            "runtimeobject",
            "strmiids",
            "windowsapp",
        ] {
            println!("cargo:rustc-link-lib={library}");
        }
    }
}
