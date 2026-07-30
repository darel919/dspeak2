cmake_minimum_required(VERSION 3.14)
project(dsm LANGUAGES CXX)

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

# ── Library target ─────────────────────────────────────────
file(GLOB_RECURSE DSM_SOURCES src/*.cpp)
if(APPLE)
  list(APPEND DSM_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos/PlatformCapture.mm
  )
endif()
add_library(dsm STATIC ${DSM_SOURCES})

# ── Include paths ─────────────────────────────────────────
target_include_directories(dsm
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include     # our dsm.h
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include    # libmediasoupclient + libwebrtc headers
    ${NATIVE_MEDIA_ARTIFACT_DIR}/include/third_party/abseil-cpp
    $<$<PLATFORM_ID:Darwin>:${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos>
)

# Also add the libsdptransform include path from the build tree, which provides <json.hpp>.
# This is produced by the libmediasoupclient CMake FetchContent step.
find_path(LIBSDPTRANSFORM_INCLUDE_DIR json.hpp
  PATHS ${NATIVE_MEDIA_BUILD_DIR}
  PATH_SUFFIXES _deps/libsdptransform-src/include
  NO_DEFAULT_PATH
)
if(LIBSDPTRANSFORM_INCLUDE_DIR)
  target_include_directories(dsm SYSTEM PRIVATE ${LIBSDPTRANSFORM_INCLUDE_DIR})
else()
  # Fall back: scan common build-tree locations.
  file(GLOB _SDP_INC_HINTS
    "${NATIVE_MEDIA_BUILD_DIR}/_deps/libsdptransform-src/include"
    "${CMAKE_BINARY_DIR}/_deps/libsdptransform-src/include"
  )
  if(_SDP_INC_HINTS)
    list(GET _SDP_INC_HINTS 0 LIBSDPTRANSFORM_INCLUDE_DIR)
    target_include_directories(dsm SYSTEM PRIVATE ${LIBSDPTRANSFORM_INCLUDE_DIR})
  endif()
endif()

# ── Link native libraries ─────────────────────────────────
link_directories(${NATIVE_MEDIA_ARTIFACT_DIR}/lib)
target_link_libraries(dsm
  PUBLIC
    webrtc
    mediasoupclient
    sdptransform
)

# macOS-specific: define WEBRTC_MAC so libwebrtc headers resolve properly.
if(APPLE)
  target_compile_definitions(dsm PRIVATE
    WEBRTC_MAC=1
    WEBRTC_POSIX=1
    __MAC_OS_X_VERSION_MIN_REQUIRED=101500
  )

  target_link_libraries(dsm PRIVATE
    "-framework CoreVideo"
    "-framework CoreMedia"
    "-framework CoreFoundation"
    "-framework CoreGraphics"
    "-framework IOSurface"
    "-framework OpenGL"
    "-framework Metal"
    "-framework AVFoundation"
    "-framework Security"
    "-framework Cocoa"
    "-framework AppKit"
    "-framework AudioToolbox"
    "-framework ScreenCaptureKit"
  )
endif()