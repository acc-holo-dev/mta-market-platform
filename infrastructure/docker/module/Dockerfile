# Build image for the MTA Market native module (module/).
# Build from the REPOSITORY ROOT:
#   docker build -f infrastructure/docker/module/Dockerfile -t mta-module .
# Run the full module test suite (build stage):
#   docker run --rm --target build mta-module \
#     sh -c "cd /src/module && ctest --preset linux-gcc --output-on-failure"
# The packaged artifact is available in the final image at /out/
# (base.so plus the CPack ZIP under /out/package/).

FROM debian:bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ gcc make cmake ninja-build python3 libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY module/ ./module/
COPY CMakePresets.json ./CMakePresets.json
COPY CMakeLists.txt ./CMakeLists.txt

# The module is a self-contained component: configure, build, test, package
# inside it (module/CMakePresets.json drives every step).
RUN cd module \
    && cmake --preset linux-gcc \
    && cmake --build --preset linux-gcc \
    && ctest --preset linux-gcc --output-on-failure \
    && cpack --config CPackConfig.cmake

FROM debian:bookworm-slim AS out
COPY --from=build /src/module/build/linux-gcc/module /out
COPY --from=build /src/module/build/linux-gcc/package /out/package
