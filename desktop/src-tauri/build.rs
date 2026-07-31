fn main() {
    tauri_build::build();
    println!("cargo:rustc-check-cfg=cfg(native_rtc)");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=NATIVE_MEDIA_ARTIFACT_DIR");
    println!("cargo:rerun-if-env-changed=NATIVE_MEDIA_BUILD_DIR");

    let artifact_dir = std::env::var_os("NATIVE_MEDIA_ARTIFACT_DIR").unwrap_or_else(|| {
        panic!(
            "NATIVE_MEDIA_ARTIFACT_DIR is required for desktop builds; browser WebRTC is web-only"
        )
    });
    let artifact_dir = std::path::PathBuf::from(artifact_dir);
    let include_dir = artifact_dir.join("include");
    let lib_dir = artifact_dir.join("lib");
    let build_dir = std::env::var_os("NATIVE_MEDIA_BUILD_DIR").map(std::path::PathBuf::from);
    let json_header = include_dir.join("json.hpp");
    let json_from_build = build_dir
        .as_ref()
        .map(|path| path.join("_deps/libsdptransform-src/include/json.hpp"));
    let required_libraries = if cfg!(target_os = "windows") {
        vec![
            vec![
                lib_dir.join("dspeak_media.lib"),
                lib_dir.join("libdspeak_media.lib"),
            ],
            vec![
                lib_dir.join("mediasoupclient.lib"),
                lib_dir.join("libmediasoupclient.lib"),
            ],
            vec![
                lib_dir.join("sdptransform.lib"),
                lib_dir.join("libsdptransform.lib"),
            ],
            vec![lib_dir.join("webrtc.lib"), lib_dir.join("libwebrtc.lib")],
        ]
    } else {
        vec![
            vec![lib_dir.join("libdspeak_media.a")],
            vec![lib_dir.join("libmediasoupclient.a")],
            vec![lib_dir.join("libsdptransform.a")],
            vec![lib_dir.join("libwebrtc.a")],
        ]
    };
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
            "native media artifact is incomplete; desktop builds require libwebrtc/libmediasoupclient: {}",
            missing.join(", ")
        );
    }

    if cfg!(target_os = "linux") {
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
    if cfg!(target_os = "windows") {
        println!(
            "cargo:warning=Windows Graphics Capture and WASAPI process-loopback are capability-gated and remain unsupported until their frame/PCM bridges are implemented"
        );
    }

    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib=static=dspeak_media");
    println!("cargo:rustc-link-lib=static=mediasoupclient");
    println!("cargo:rustc-link-lib=static=sdptransform");
    println!("cargo:rustc-link-lib=static=webrtc");

    if cfg!(target_os = "macos") {
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
    } else if cfg!(target_os = "linux") {
        println!("cargo:rustc-link-lib=dl");
        println!("cargo:rustc-link-lib=pthread");
    } else if cfg!(target_os = "windows") {
        for library in [
            "d3d11",
            "dxgi",
            "windowscodecs",
            "mf",
            "mfplat",
            "mfuuid",
            "propsys",
            "ole32",
            "oleaut32",
            "uuid",
        ] {
            println!("cargo:rustc-link-lib={library}");
        }
    }

    println!("cargo:rustc-cfg=native_rtc");
}
