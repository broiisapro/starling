#!/bin/sh
# Starling installer — POSIX sh, no bashisms, no sudo.
#
# Detects the platform, downloads `starling-<version>-<os>-<arch>.tar.gz` from GitHub Releases,
# verifies its SHA-256 against the release's `SHA256SUMS`, and installs it into `~/.starling`:
#
#   ~/.starling/bin/starling              the CLI
#   ~/.starling/share/starling/web/       the dashboard build
#   ~/.starling/VERSION                   which version is installed
#
# Contract shared with Epic 151 (packaging):
#   asset   starling-<version>-<os>-<arch>.tar.gz    os in darwin|linux, arch in arm64|x64
#   layout  starling-<version>-<os>-<arch>/{bin/starling,share/starling/web/}
#   sums    SHA256SUMS lines: "<64 hex>  <asset name>"
#   URLs    <base>/latest/download/<asset>  and  <base>/download/v<version>/<asset>
#
# `latest` is resolved from the asset names inside `latest/download/SHA256SUMS`, so the installer
# downloads the manifest first and derives both the version and the exact file name from it.

set -eu

RELEASES_URL=${STARLING_RELEASE_BASE_URL:-https://github.com/broiisapro/starling/releases}
REQUESTED_VERSION=${STARLING_VERSION:-latest}
DIR_FLAG=''
QUIET=0
MODIFY_PATH=0
SUPPORTED='darwin-arm64 darwin-x64 linux-x64'
SOURCE_URL='https://github.com/broiisapro/starling#build-from-source'
MARKER='# added by starling installer'
TMP=''

usage() {
  printf '%s\n' \
    'Usage: install.sh [options]' \
    '' \
    "Installs Starling into \$HOME/.starling, or the directory you choose." \
    '' \
    'Options:' \
    '  --version <v>   install a pinned version instead of the latest release' \
    '  --dir <path>    install into <path> (default: $STARLING_INSTALL_DIR or ~/.starling)' \
    '  --modify-path   append the PATH line to your shell rc file (once, with a marker)' \
    '  --quiet         print errors only' \
    '  --help          show this help' \
    '' \
    'Environment:' \
    '  STARLING_VERSION          pinned version, or "latest" (default)' \
    '  STARLING_INSTALL_DIR      install directory (default: ~/.starling)' \
    '  STARLING_RELEASE_BASE_URL release host (default: GitHub Releases)' \
    '  STARLING_NO_MODIFY_PATH   set to 1 to refuse --modify-path' \
    '  STARLING_INSECURE_SKIP_VERIFY=1  install without a SHA-256 check (loud warning)' \
    '' \
    'Uninstall: run uninstall.sh from the same release (or delete ~/.starling).'
}

say() {
  if [ "$QUIET" -eq 0 ]; then printf '%s\n' "$*"; fi
}

die() {
  printf 'starling: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

while [ $# -gt 0 ]; do
  case "$1" in
    --help | -h)
      usage
      exit 0
      ;;
    --version)
      [ $# -ge 2 ] || die "--version needs a value, e.g. --version 1.2.3"
      REQUESTED_VERSION=$2
      shift 2
      ;;
    --version=*)
      REQUESTED_VERSION=${1#--version=}
      shift
      ;;
    --dir)
      [ $# -ge 2 ] || die "--dir needs a path, e.g. --dir \"\$HOME/.starling\""
      DIR_FLAG=$2
      shift 2
      ;;
    --dir=*)
      DIR_FLAG=${1#--dir=}
      shift
      ;;
    --modify-path) MODIFY_PATH=1; shift ;;
    --quiet | -q) QUIET=1; shift ;;
    *)
      printf 'starling: unknown option %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "${HOME:-}" ] && [ -z "$DIR_FLAG" ] && [ -z "${STARLING_INSTALL_DIR:-}" ]; then
  die 'HOME is not set; pass --dir <path> or set STARLING_INSTALL_DIR'
fi
INSTALL_DIR=${DIR_FLAG:-${STARLING_INSTALL_DIR:-${HOME:-}/.starling}}
case "$INSTALL_DIR" in
  '') die 'install directory is empty; pass a real path with --dir' ;;
  /) die 'refusing to install into /' ;;
esac

case "$REQUESTED_VERSION" in
  latest) ;;
  *)
    REQUESTED_VERSION=${REQUESTED_VERSION#v}
    case "$REQUESTED_VERSION" in
      '' | *[!0-9A-Za-z._-]*) die "invalid version '$REQUESTED_VERSION' (expected something like 1.2.3)" ;;
    esac
    ;;
esac

# ── platform ─────────────────────────────────────────────────────────────────────
RAW_OS=${STARLING_UNAME_S:-}
if [ -z "$RAW_OS" ]; then RAW_OS=$(uname -s 2>/dev/null || true); fi
case "$RAW_OS" in
  Darwin | darwin) OS=darwin ;;
  Linux | linux) OS=linux ;;
  *)
    die "unsupported operating system '${RAW_OS:-unknown}'; Starling ships for: $SUPPORTED (build from source: $SOURCE_URL)"
    ;;
esac

RAW_ARCH=${STARLING_UNAME_M:-}
if [ -z "$RAW_ARCH" ]; then RAW_ARCH=$(uname -m 2>/dev/null || true); fi
case "$RAW_ARCH" in
  arm64 | aarch64) ARCH=arm64 ;;
  x86_64 | amd64 | x64) ARCH=x64 ;;
  *)
    die "unsupported architecture '${RAW_ARCH:-unknown}'; Starling ships for: $SUPPORTED (build from source: $SOURCE_URL)"
    ;;
esac

PLATFORM="$OS-$ARCH"
case " $SUPPORTED " in
  *" $PLATFORM "*) ;;
  *)
    die "unsupported platform '$PLATFORM'; Starling ships for: $SUPPORTED (build from source: $SOURCE_URL)"
    ;;
esac

# ── tools ────────────────────────────────────────────────────────────────────────
if command -v curl >/dev/null 2>&1; then
  DOWNLOADER=curl
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER=wget
else
  die "need curl or wget to download Starling; install one (e.g. 'apt install curl') and run this again"
fi

SUM_TOOL=''
if command -v sha256sum >/dev/null 2>&1; then
  SUM_TOOL=sha256sum
elif command -v shasum >/dev/null 2>&1; then
  SUM_TOOL=shasum
fi
if [ -z "$SUM_TOOL" ] && [ "${STARLING_INSECURE_SKIP_VERIFY:-0}" != 1 ]; then
  die 'no SHA-256 tool found (need sha256sum or shasum); refusing to install an unverified binary — install coreutils, or set STARLING_INSECURE_SKIP_VERIFY=1 to override'
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/starling-install.XXXXXX") ||
  die 'could not create a temporary directory (mktemp)'

read_installed_version() {
  installed=''
  if [ -f "$INSTALL_DIR/VERSION" ]; then
    IFS= read -r installed <"$INSTALL_DIR/VERSION" || true
  fi
  printf '%s' "$installed"
}

is_installed() { # is_installed <version>
  [ -n "$1" ] &&
    [ "$(read_installed_version)" = "$1" ] &&
    [ -x "$INSTALL_DIR/bin/starling" ] &&
    [ -d "$INSTALL_DIR/share/starling/web" ]
}

already_installed_notice() { # already_installed_notice <version>
  say "Starling $1 is already installed at $INSTALL_DIR — nothing to do."
  say 'Try: starling --version   ·   starling doctor'
}

# A pinned version can be answered without touching the network at all.
if [ "$REQUESTED_VERSION" != latest ] && is_installed "$REQUESTED_VERSION"; then
  already_installed_notice "$REQUESTED_VERSION"
  exit 0
fi

# ── download the manifest ───────────────────────────────────────────────────────
fetch() { # fetch <url> <destination>
  if [ "$DOWNLOADER" = curl ]; then
    curl -fsSL "$1" -o "$2"
  else
    wget -qO- "$1" >"$2"
  fi
}

if [ "$REQUESTED_VERSION" = latest ]; then
  DOWNLOAD_PATH=latest/download
  SUMS_URL="$RELEASES_URL/latest/download/SHA256SUMS"
else
  DOWNLOAD_PATH="download/v$REQUESTED_VERSION"
  SUMS_URL="$RELEASES_URL/download/v$REQUESTED_VERSION/SHA256SUMS"
fi

say "Fetching the release manifest from $SUMS_URL"
if ! fetch "$SUMS_URL" "$TMP/SHA256SUMS"; then
  die "could not download SHA256SUMS from $SUMS_URL (check the network, and STARLING_RELEASE_BASE_URL if you set it)"
fi

# Find our asset in the manifest. The asset name carries the version, so scanning it also
# resolves `latest` without an extra API call. A pinned version builds the name directly; if its
# line is missing, verification below refuses to install.
RESOLVED_VERSION=''
ASSET=''
if [ "$REQUESTED_VERSION" = latest ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    rest=${line#*  }
    case "$rest" in
      starling-*-"$OS"-"$ARCH".tar.gz)
        candidate=${rest#starling-}
        candidate=${candidate%-"$OS"-"$ARCH".tar.gz}
        if [ -n "$candidate" ]; then
          RESOLVED_VERSION=$candidate
          ASSET=$rest
        fi
        ;;
    esac
  done <"$TMP/SHA256SUMS"

  if [ -z "$ASSET" ]; then
    die "no Starling release for $PLATFORM in SHA256SUMS; supported: $SUPPORTED (build from source: $SOURCE_URL)"
  fi
else
  RESOLVED_VERSION=$REQUESTED_VERSION
  ASSET="starling-$REQUESTED_VERSION-$OS-$ARCH.tar.gz"
fi

if is_installed "$RESOLVED_VERSION"; then
  already_installed_notice "$RESOLVED_VERSION"
  exit 0
fi

# ── download the archive ────────────────────────────────────────────────────────
TARBALL="$TMP/$ASSET"
ASSET_URL="$RELEASES_URL/$DOWNLOAD_PATH/$ASSET"
say "Downloading $ASSET"
if ! fetch "$ASSET_URL" "$TARBALL"; then
  die "could not download $ASSET_URL (the release may not be published yet)"
fi

# ── verify ──────────────────────────────────────────────────────────────────────
if [ -n "$SUM_TOOL" ]; then
  expected=''
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *"  $ASSET")
        expected=${line%%  *}
        break
        ;;
    esac
  done <"$TMP/SHA256SUMS"
  if [ -z "$expected" ]; then
    die "SHA256SUMS has no entry for $ASSET; refusing to install an unverified binary"
  fi

  if [ "$SUM_TOOL" = sha256sum ]; then
    actual=$(sha256sum "$TARBALL")
  else
    actual=$(shasum -a 256 "$TARBALL")
  fi
  actual=${actual%% *}

  if [ "$actual" != "$expected" ]; then
    die "checksum mismatch for $ASSET — refusing to install (nothing was written to $INSTALL_DIR)"
  fi
  say "Verified SHA-256 $actual"
else
  printf 'starling: WARNING — SHA-256 verification is DISABLED (STARLING_INSECURE_SKIP_VERIFY=1).\n' >&2
  printf 'starling: WARNING — nothing checked the download; continue only on a network you trust.\n' >&2
fi

# ── extract and stage ───────────────────────────────────────────────────────────
EXTRACT="$TMP/extract"
mkdir -p "$EXTRACT"
PKG="$EXTRACT/starling-$RESOLVED_VERSION-$OS-$ARCH"
if ! tar -xzf "$TARBALL" -C "$EXTRACT"; then
  die "could not extract $ASSET — the download may be truncated; nothing was installed"
fi
if [ ! -f "$PKG/bin/starling" ]; then
  die "the release archive has no bin/starling — nothing was installed"
fi
if [ ! -d "$PKG/share/starling/web" ]; then
  die "the release archive has no share/starling/web — nothing was installed"
fi
if ! "$PKG/bin/starling" --version >/dev/null 2>&1; then
  die "the downloaded binary does not run on this machine — nothing was installed"
fi

# ── install (stage, then swap) ──────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/share/starling"
cp "$PKG/bin/starling" "$INSTALL_DIR/bin/starling.new"
chmod 755 "$INSTALL_DIR/bin/starling.new"
rm -rf "$INSTALL_DIR/share/starling/web.new"
cp -R "$PKG/share/starling/web" "$INSTALL_DIR/share/starling/web.new"

mv -f "$INSTALL_DIR/bin/starling.new" "$INSTALL_DIR/bin/starling"
rm -rf "$INSTALL_DIR/share/starling/web"
mv "$INSTALL_DIR/share/starling/web.new" "$INSTALL_DIR/share/starling/web"
printf '%s\n' "$RESOLVED_VERSION" >"$INSTALL_DIR/VERSION"

installed_version=$("$INSTALL_DIR/bin/starling" --version 2>/dev/null || true)

# ── PATH hint ───────────────────────────────────────────────────────────────────
BIN_DIR="$INSTALL_DIR/bin"
RC_FILE=''
RC_DIR=''
PATH_LINE=''
SHELL_NAME=''
case "${SHELL:-}" in
  */zsh | zsh) SHELL_NAME=zsh ;;
  */bash | bash) SHELL_NAME=bash ;;
  */fish | fish) SHELL_NAME=fish ;;
esac

if [ -n "${HOME:-}" ]; then
  case "$SHELL_NAME" in
    zsh)
      RC_FILE="$HOME/.zshrc"
      RC_DIR="$HOME"
      PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\"  $MARKER"
      ;;
    bash)
      if [ "$OS" = darwin ]; then
        RC_FILE="$HOME/.bash_profile"
      else
        RC_FILE="$HOME/.bashrc"
      fi
      RC_DIR="$HOME"
      PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\"  $MARKER"
      ;;
    fish)
      RC_FILE="$HOME/.config/fish/config.fish"
      RC_DIR="$HOME/.config/fish"
      PATH_LINE="fish_add_path $BIN_DIR  $MARKER"
      ;;
  esac
fi

case ":${PATH:-}:" in
  *":$BIN_DIR:"*) ON_PATH=1 ;;
  *) ON_PATH=0 ;;
esac

if [ "$ON_PATH" -eq 0 ]; then
  if [ -n "$PATH_LINE" ]; then
    if [ "$MODIFY_PATH" -eq 1 ] && [ "${STARLING_NO_MODIFY_PATH:-0}" != 1 ]; then
      if grep -qF "$MARKER" "$RC_FILE" 2>/dev/null; then
        say "$RC_FILE already adds Starling to PATH"
      else
        mkdir -p "$RC_DIR"
        printf '%s\n' "$PATH_LINE" >>"$RC_FILE"
        say "Added to $RC_FILE: $PATH_LINE"
      fi
    else
      say ''
      say "Add Starling to your PATH by putting this line in $RC_FILE:"
      say "  $PATH_LINE"
      say 'Or re-run this installer with --modify-path.'
    fi
  else
    say ''
    say 'Add Starling to your PATH:'
    say "  export PATH=\"$BIN_DIR:\$PATH\""
  fi
fi

say ''
say "🐦 Starling $RESOLVED_VERSION is installed at $INSTALL_DIR (${installed_version:-binary not reporting a version})"
say ''
say 'Next steps:'
say '  starling try       start a tiny demo run'
say '  starling doctor    check git, opencode and models'
