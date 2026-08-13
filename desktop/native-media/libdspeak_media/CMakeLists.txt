cmake_minimum_required(VERSION 3.15)
cmake_policy(SET CMP0091 NEW)
project(lib_dspeak_media LANGUAGES CXX)

if(APPLE)
  enable_language(OBJCXX)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

# Native media dependency bundle path.
# Must contain libwebrtc headers and libraries. Mediasoup headers and libraries
# are required only when DSPEAK_MEDIA_WITH_MEDIASOUP is enabled.
if(NOT DEFINED ENV{NATIVE_MEDIA_ARTIFACT_DIR})
  set(NATIVE_MEDIA_ARTIFACT_DIR "" CACHE PATH "Path to native-media bundle (include/ + lib/)")
else()
  set(NATIVE_MEDIA_ARTIFACT_DIR $ENV{NATIVE_MEDIA_ARTIFACT_DIR})
endif()

# Optional: path to native-media build tree (for sdptrransform/json.hpp)
if(NOT DEFINED ENV{NATIVE_MEDIA_BUILD_DIR})
  set(NATIVE_MEDIA_BUILD_DIR "" CACHE PATH "Path to native-media build tree (_deps/)")
else()
  set(NATIVE_MEDIA_BUILD_DIR $ENV{NATIVE_MEDIA_BUILD_DIR})
endif()

if(NOT NATIVE_MEDIA_ARTIFACT_DIR)
  message(FATAL_ERROR "NATIVE_MEDIA_ARTIFACT_DIR not set. Point it to the unpacked native-media bundle.")
endif()

option(DSPEAK_MEDIA_WITH_MEDIASOUP
  "Build the self-hosted mediasoup SFU transport"
  ON
)
if(DEFINED ENV{NATIVE_MEDIA_WITH_MEDIASOUP})
  set(DSPEAK_MEDIA_WITH_MEDIASOUP $ENV{NATIVE_MEDIA_WITH_MEDIASOUP} CACHE BOOL
    "Build the self-hosted mediasoup SFU transport" FORCE)
endif()

if((APPLE OR WIN32) AND NOT DSPEAK_MEDIA_WITH_MEDIASOUP)
  message(FATAL_ERROR "Native macOS and Windows builds require the mediasoupclient and sdptransform transport libraries")
endif()

message(STATUS "NATIVE_MEDIA_ARTIFACT_DIR  : ${NATIVE_MEDIA_ARTIFACT_DIR}")
message(STATUS "NATIVE_MEDIA_BUILD_DIR     : ${NATIVE_MEDIA_BUILD_DIR}")

if(NOT EXISTS "${NATIVE_MEDIA_ARTIFACT_DIR}/include")
  message(FATAL_ERROR "Native media artifact is missing include/")
endif()

if(NOT EXISTS "${NATIVE_MEDIA_ARTIFACT_DIR}/lib")
  message(FATAL_ERROR "Native media artifact is missing lib/")
endif()

if(WIN32)
  set(DSPEAK_MEDIA_CORE_LIBRARIES
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/webrtc.lib"
  )
  set(DSPEAK_MEDIA_MEDIASOUP_LIBRARIES
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/mediasoupclient.lib"
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/sdptransform.lib"
  )
else()
  set(DSPEAK_MEDIA_CORE_LIBRARIES
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/libwebrtc.a"
  )
  set(DSPEAK_MEDIA_MEDIASOUP_LIBRARIES
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/libmediasoupclient.a"
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/libsdptransform.a"
  )
endif()
foreach(required_library IN LISTS DSPEAK_MEDIA_CORE_LIBRARIES)
  if(NOT EXISTS "${required_library}")
    message(FATAL_ERROR "Native media artifact is missing ${required_library}")
  endif()
endforeach()
if(DSPEAK_MEDIA_WITH_MEDIASOUP)
  foreach(required_library IN LISTS DSPEAK_MEDIA_MEDIASOUP_LIBRARIES)
    if(NOT EXISTS "${required_library}")
      message(FATAL_ERROR "Native media artifact is missing ${required_library}")
    endif()
  endforeach()
endif()

if(WIN32)
  include(CheckIncludeFileCXX)
  check_include_file_cxx("windows.graphics.capture.h" DSPEAK_MEDIA_HAS_WINRT_CAPTURE_ABI_HEADERS)
  check_include_file_cxx("winrt/Windows.Graphics.Capture.h" DSPEAK_MEDIA_HAS_WINRT_CAPTURE_HEADERS)
  check_include_file_cxx("windows.graphics.capture.interop.h" DSPEAK_MEDIA_HAS_WGC_INTEROP_HEADERS)
  check_include_file_cxx("windows.graphics.directx.direct3d11.interop.h" DSPEAK_MEDIA_HAS_D3D11_INTEROP_HEADERS)
  check_include_file_cxx("d3d11.h" DSPEAK_MEDIA_HAS_D3D11_HEADERS)
  check_include_file_cxx("audioclient.h" DSPEAK_MEDIA_HAS_WASAPI_HEADERS)
  check_include_file_cxx("audioclientactivationparams.h" DSPEAK_MEDIA_HAS_PROCESS_LOOPBACK_HEADERS)
  if(DSPEAK_MEDIA_HAS_WINRT_CAPTURE_ABI_HEADERS AND DSPEAK_MEDIA_HAS_WINRT_CAPTURE_HEADERS AND DSPEAK_MEDIA_HAS_WGC_INTEROP_HEADERS AND DSPEAK_MEDIA_HAS_D3D11_INTEROP_HEADERS AND DSPEAK_MEDIA_HAS_D3D11_HEADERS)
    set(DSPEAK_MEDIA_WINDOWS_WGC_DEPS 1)
  else()
    set(DSPEAK_MEDIA_WINDOWS_WGC_DEPS 0)
  endif()
  if(DSPEAK_MEDIA_HAS_WASAPI_HEADERS AND DSPEAK_MEDIA_HAS_PROCESS_LOOPBACK_HEADERS)
    set(DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS 1)
  else()
    set(DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS 0)
  endif()
  if(NOT DSPEAK_MEDIA_HAS_WASAPI_HEADERS OR NOT DSPEAK_MEDIA_HAS_PROCESS_LOOPBACK_HEADERS)
    message(FATAL_ERROR "Windows SDK is missing WASAPI process-loopback headers required for native audio capture")
  endif()
  if(NOT DSPEAK_MEDIA_WINDOWS_WGC_DEPS)
    message(FATAL_ERROR "Windows SDK is missing Windows Graphics Capture and Direct3D interop headers required for native video capture")
  endif()
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  find_package(PkgConfig QUIET)
  if(PkgConfig_FOUND)
    pkg_check_modules(DSPEAK_PIPEWIRE QUIET libpipewire-0.3)
    pkg_check_modules(DSPEAK_SPA QUIET libspa-0.2)
  endif()
  find_package(X11 QUIET COMPONENTS X11 Xrandr Xcomposite Xdamage Xfixes)
  if(DSPEAK_PIPEWIRE_FOUND AND DSPEAK_SPA_FOUND)
    set(DSPEAK_MEDIA_LINUX_PIPEWIRE_DEPS 1)
  else()
    set(DSPEAK_MEDIA_LINUX_PIPEWIRE_DEPS 0)
  endif()
  if(X11_FOUND AND X11_Xrandr_FOUND AND X11_Xcomposite_FOUND AND X11_Xdamage_FOUND AND X11_Xfixes_FOUND)
    set(DSPEAK_MEDIA_LINUX_X11_DEPS 1)
  else()
    set(DSPEAK_MEDIA_LINUX_X11_DEPS 0)
  endif()
endif()

if(NOT DEFINED DSPEAK_MEDIA_LINUX_PIPEWIRE_DEPS)
  set(DSPEAK_MEDIA_LINUX_PIPEWIRE_DEPS 0)
endif()
if(NOT DEFINED DSPEAK_MEDIA_LINUX_X11_DEPS)
  set(DSPEAK_MEDIA_LINUX_X11_DEPS 0)
endif()
if(NOT DEFINED DSPEAK_MEDIA_WINDOWS_WGC_DEPS)
  set(DSPEAK_MEDIA_WINDOWS_WGC_DEPS 0)
endif()
if(NOT DEFINED DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS)
  set(DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS 0)
endif()

message(STATUS "Linux PipeWire/SPA dependencies: ${DSPEAK_MEDIA_LINUX_PIPEWIRE_DEPS}")
message(STATUS "Linux X11 dependencies: ${DSPEAK_MEDIA_LINUX_X11_DEPS}")
message(STATUS "Windows Graphics Capture dependencies: ${DSPEAK_MEDIA_WINDOWS_WGC_DEPS}")
message(STATUS "Windows WASAPI dependencies: ${DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS}")
message(STATUS "Mediasoup self-hosted SFU transport: ${DSPEAK_MEDIA_WITH_MEDIASOUP}")

find_path(LIBSDPTRANSFORM_INCLUDE_DIR json.hpp
  PATHS
    ${NATIVE_MEDIA_BUILD_DIR}/_deps/libsdptransform-src/include
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include
  NO_DEFAULT_PATH
)
if(NOT LIBSDPTRANSFORM_INCLUDE_DIR)
  message(FATAL_ERROR "Native media artifact is missing the exact json.hpp used by libsdptransform")
endif()

# ── Library target ─────────────────────────────────────────
file(GLOB_RECURSE LIB_DSPEAK_MEDIA_SOURCES CONFIGURE_DEPENDS src/*.cpp src/internal/*.cpp)
if(DSPEAK_MEDIA_WITH_MEDIASOUP)
  list(FILTER LIB_DSPEAK_MEDIA_SOURCES EXCLUDE REGEX "sfu_transport_stub\\.cpp$")
else()
  list(FILTER LIB_DSPEAK_MEDIA_SOURCES EXCLUDE REGEX "sfu_transport\\.cpp$")
endif()
if(APPLE)
  list(APPEND LIB_DSPEAK_MEDIA_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos/PlatformCaptureMacosSupport.mm
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos/PlatformCaptureScreen.mm
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos/PlatformCaptureDevices.mm
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos/PlatformCaptureDevice.mm
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos/VideoSurfaceMacos.mm
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos/VideoToolboxCodecsMacos.mm
  )
elseif(WIN32)
  list(APPEND LIB_DSPEAK_MEDIA_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/windows/PlatformCaptureWindowsSupport.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/windows/PlatformCaptureWindowsGraphics.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/windows/PlatformCaptureWindowsAudio.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/windows/PlatformCaptureWindowsSession.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/windows/PlatformCaptureWindowsOutput.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/windows/VideoSurfaceWindows.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/windows/MediaFoundationCodecsWindows.cpp
  )
endif()
add_library(lib_dspeak_media STATIC ${LIB_DSPEAK_MEDIA_SOURCES})
set_target_properties(lib_dspeak_media PROPERTIES OUTPUT_NAME dspeak_media)
target_compile_definitions(lib_dspeak_media PRIVATE
  DSPEAK_MEDIA_LINUX_PIPEWIRE_DEPS=${DSPEAK_MEDIA_LINUX_PIPEWIRE_DEPS}
  DSPEAK_MEDIA_LINUX_X11_DEPS=${DSPEAK_MEDIA_LINUX_X11_DEPS}
  DSPEAK_MEDIA_WINDOWS_WGC_DEPS=${DSPEAK_MEDIA_WINDOWS_WGC_DEPS}
  DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS=${DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS}
  DSPEAK_MEDIA_WITH_MEDIASOUP=$<BOOL:${DSPEAK_MEDIA_WITH_MEDIASOUP}>
)
if(WIN32)
  target_compile_definitions(lib_dspeak_media PRIVATE
    WEBRTC_WIN=1
    NOMINMAX
    WIN32_LEAN_AND_MEAN
    _WIN32_WINNT=0x0A00
    WINVER=0x0A00
  )
endif()


# ── Include paths ─────────────────────────────────────────
target_include_directories(lib_dspeak_media
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include     # public lib_dspeak_media.h
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform
    $<$<PLATFORM_ID:Darwin>:${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos>
)
target_include_directories(lib_dspeak_media SYSTEM PRIVATE
    ${LIBSDPTRANSFORM_INCLUDE_DIR}          # exact json.hpp used by mediasoupclient
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include    # libmediasoupclient + libwebrtc headers
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include/third_party/abseil-cpp
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include/third_party/libyuv/include
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include  # bundled json.hpp from libsdptransform
)

# ── Link native libraries ─────────────────────────────────
link_directories(${NATIVE_MEDIA_ARTIFACT_DIR}/lib)
target_link_libraries(lib_dspeak_media
  PUBLIC
    webrtc
)
if(DSPEAK_MEDIA_WITH_MEDIASOUP)
  target_link_libraries(lib_dspeak_media
    PUBLIC
      mediasoupclient
      sdptransform
  )
endif()

if(WIN32)
  target_link_libraries(lib_dspeak_media PRIVATE
    advapi32
    bcrypt
    combase
    crypt32
    d3d11
    d3dcompiler
    dxgi
    iphlpapi
    windowscodecs
    mf
    ole32
    oleaut32
    uuid
    mfplat
    mfreadwrite
    mfuuid
    mmdevapi
    avrt
    propsys
    secur32
    setupapi
    shell32
    shlwapi
    user32
    gdi32
    dwmapi
    shcore
    userenv
    version
    winmm
    ws2_32
    runtimeobject
    strmiids
    windowsapp
  )
endif()

# macOS-specific: define WEBRTC_MAC so libwebrtc headers resolve properly.
if(APPLE)
  target_compile_definitions(lib_dspeak_media PRIVATE
    WEBRTC_MAC=1
    WEBRTC_POSIX=1
    __MAC_OS_X_VERSION_MIN_REQUIRED=130000
  )

  target_link_libraries(lib_dspeak_media PRIVATE
    "-framework CoreVideo"
    "-framework CoreMedia"
    "-framework CoreFoundation"
    "-framework CoreGraphics"
    "-framework IOSurface"
    "-framework OpenGL"
    "-framework Metal"
    "-framework AVFoundation"
    "-framework CoreAudio"
    "-framework AudioUnit"
    "-framework Security"
    "-framework Cocoa"
    "-framework AppKit"
    "-framework AudioToolbox"
    "-framework ScreenCaptureKit"
  )
endif()
