# The contributor container: Bun 1.4.4 (the repo pin) plus the three tools every workflow assumes.
#
# Why a thin layer on `oven/bun:1.4.4` instead of `mcr.microsoft.com/devcontainers/base:bookworm` plus a
# curl'd Bun installer: the image tag *is* the pin, so the devcontainer and `.bun-version` cannot
# disagree, and there is no second install script (URL, checksum, PATH edits) to keep in sync.
# `oven/bun` is Debian-based, so apt already has git, gh and bash.
FROM oven/bun:1.4.4

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gh \
      jq \
      less \
 && rm -rf /var/lib/apt/lists/*

# Codespaces and VS Code mount the workspace here; `postCreateCommand` installs from the lockfile.
WORKDIR /workspaces
