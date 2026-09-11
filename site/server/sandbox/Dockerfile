# MTA Market - Sandbox Docker Image
# Isolated environment for validating uploaded artifacts

FROM ubuntu:22.04

# Install basic tools
RUN apt-get update && apt-get install -y \
    unzip \
    file \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create sandbox user (non-root)
RUN useradd -m -s /bin/bash -u 1000 sandbox

# Create sandbox directories
RUN mkdir -p /sandbox && \
    chown sandbox:sandbox /sandbox

# Copy validation script
COPY validate.sh /sandbox/validate.sh
RUN chmod +x /sandbox/validate.sh && \
    chown sandbox:sandbox /sandbox/validate.sh

# Switch to non-root user
USER sandbox
WORKDIR /sandbox

# Set environment
ENV SANDBOX_MODE=true
ENV MTA_VERSION=unknown

# Default command (overridden by runner)
CMD ["/sandbox/validate.sh"]
