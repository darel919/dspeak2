cmake_minimum_required(VERSION 3.14)
project(lib_dspeak_media LANGUAGES CXX)

if(APPLE)
  enable_language(OBJCXX)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Native media dependency bundle path.
# Must contain:
#   include/   – libmediasoupclient and libwebrtc headers
#   lib/       – libwebrtc.a + libmediasoupclient.a
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

message(STATUS "NATIVE_MEDIA_ARTIFACT_DIR  : ${NATIVE_MEDIA_ARTIFACT_DIR}")
message(STATUS "NATIVE_MEDIA_BUILD_DIR     : ${NATIVE_MEDIA_BUILD_DIR}")

if(NOT EXISTS "${NATIVE_MEDIA_ARTIFACT_DIR}/include")
  message(FATAL_ERROR "Native media artifact is missing include/")
endif()

if(NOT EXISTS "${NATIVE_MEDIA_ARTIFACT_DIR}/lib")
  message(FATAL_ERROR "Native media artifact is missing lib/")
endif()

if(WIN32)
  set(DSPEAK_MEDIA_REQUIRED_LIBRARIES
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/dspeak_media.lib"
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/mediasoupclient.lib"
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/sdptransform.lib"
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/webrtc.lib"
  )
else()
  set(DSPEAK_MEDIA_REQUIRED_LIBRARIES
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/libdspeak_media.a"
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/libmediasoupclient.a"
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/libsdptransform.a"
    "${NATIVE_MEDIA_ARTIFACT_DIR}/lib/libwebrtc.a"
  )
endif()
foreach(required_library IN LISTS DSPEAK_MEDIA_REQUIRED_LIBRARIES)
  if(NOT EXISTS "${required_library}")
    message(FATAL_ERROR "Native media artifact is missing ${required_library}")
  endif()
endforeach()

if(WIN32)
  include(CheckIncludeFileCXX)
  check_include_file_cxx("winrt/Windows.Graphics.Capture.h" DSPEAK_MEDIA_HAS_WINRT_CAPTURE_HEADERS)
  check_include_file_cxx("d3d11.h" DSPEAK_MEDIA_HAS_D3D11_HEADERS)
  check_include_file_cxx("audioclient.h" DSPEAK_MEDIA_HAS_WASAPI_HEADERS)
  if(DSPEAK_MEDIA_HAS_WINRT_CAPTURE_HEADERS AND DSPEAK_MEDIA_HAS_D3D11_HEADERS)
    set(DSPEAK_MEDIA_WINDOWS_WGC_DEPS 1)
  else()
    set(DSPEAK_MEDIA_WINDOWS_WGC_DEPS 0)
  endif()
  if(DSPEAK_MEDIA_HAS_WASAPI_HEADERS)
    set(DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS 1)
  else()
    set(DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS 0)
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
if(APPLE)
  list(APPEND LIB_DSPEAK_MEDIA_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos/PlatformCapture.mm
  )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  list(APPEND LIB_DSPEAK_MEDIA_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/linux/PlatformCapture.cpp
  )
elseif(WIN32)
  list(APPEND LIB_DSPEAK_MEDIA_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/windows/PlatformCapture.cpp
  )
endif()
add_library(lib_dspeak_media STATIC ${LIB_DSPEAK_MEDIA_SOURCES})
set_target_properties(lib_dspeak_media PROPERTIES OUTPUT_NAME dspeak_media)
target_compile_definitions(lib_dspeak_media PRIVATE
  DSPEAK_MEDIA_LINUX_PIPEWIRE_DEPS=${DSPEAK_MEDIA_LINUX_PIPEWIRE_DEPS}
  DSPEAK_MEDIA_LINUX_X11_DEPS=${DSPEAK_MEDIA_LINUX_X11_DEPS}
  DSPEAK_MEDIA_WINDOWS_WGC_DEPS=${DSPEAK_MEDIA_WINDOWS_WGC_DEPS}
  DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS=${DSPEAK_MEDIA_WINDOWS_WASAPI_DEPS}
)


# ── Include paths ─────────────────────────────────────────
target_include_directories(lib_dspeak_media
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include     # public lib_dspeak_media.h
    ${LIBSDPTRANSFORM_INCLUDE_DIR}          # exact json.hpp used by mediasoupclient
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include    # libmediasoupclient + libwebrtc headers
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include/third_party/abseil-cpp
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include/third_party/libyuv/include
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include  # bundled json.hpp from libsdptransform
    $<$<PLATFORM_ID:Darwin>:${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos>
    $<$<PLATFORM_ID:Linux>:${CMAKE_CURRENT_SOURCE_DIR}/../platform/linux>
    $<$<PLATFORM_ID:Windows>:${CMAKE_CURRENT_SOURCE_DIR}/../platform/windows>
)

# ── Link native libraries ─────────────────────────────────
link_directories(${NATIVE_MEDIA_ARTIFACT_DIR}/lib)
target_link_libraries(lib_dspeak_media
  PUBLIC
    webrtc
    mediasoupclient
    sdptransform
)

# macOS-specific: define WEBRTC_MAC so libwebrtc headers resolve properly.
if(APPLE)
  target_compile_definitions(lib_dspeak_media PRIVATE
    WEBRTC_MAC=1
    WEBRTC_POSIX=1
    __MAC_OS_X_VERSION_MIN_REQUIRED=101500
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