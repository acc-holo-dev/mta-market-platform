# Standalone build for the DRM client subsystem (PLAN H-002..H-005).
# The full MTA module is built via CMake; this Makefile compiles the DRM
# subsystem plus its unit tests without the MTA SDK, so it runs anywhere
# with g++ and OpenSSL (Linux x64 verified; H-006 matrix in
# documents/module/DRM-CLIENT.md).
#
# Paths are resolved against the module root so this file works from any
# invocation directory (tests live in the centralized root tests/ tree,
# PLAN-010 Rule 002).

CXX ?= g++
# This Makefile lives at module/src/drm/; the platform root is three levels up.
PLATFORM_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../../..)
CXXFLAGS := -std=c++17 -Wall -Wextra -I $(PLATFORM_ROOT)/module/src
LDLIBS := -lssl -lcrypto

DRM_SOURCES := $(PLATFORM_ROOT)/module/src/drm/json.cpp $(PLATFORM_ROOT)/module/src/drm/aead.cpp \
               $(PLATFORM_ROOT)/module/src/drm/ed25519.cpp \
               $(PLATFORM_ROOT)/module/src/drm/base64.cpp $(PLATFORM_ROOT)/module/src/drm/key_store.cpp \
               $(PLATFORM_ROOT)/module/src/drm/http_client.cpp $(PLATFORM_ROOT)/module/src/drm/license_client.cpp
DRM_TEST := $(PLATFORM_ROOT)/tests/module/drm/main.cpp
DRM_TEST_BIN := /tmp/drm_test

.PHONY: test clean

test: $(DRM_TEST_BIN)
	$(DRM_TEST_BIN)

$(DRM_TEST_BIN): $(DRM_SOURCES) $(DRM_TEST)
	$(CXX) $(CXXFLAGS) $(DRM_SOURCES) $(DRM_TEST) $(LDLIBS) -o $@

clean:
	rm -f $(DRM_TEST_BIN)
