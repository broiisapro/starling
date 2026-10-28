#!/bin/sh
# Starling uninstaller — POSIX sh, no sudo.
#
# Removes exactly what install.sh wrote:
#   $INSTALL_DIR/bin/starling
#   $INSTALL_DIR/share/starling/   (the web build)
#   $INSTALL_DIR/VERSION
#   the "added by starling installer" PATH line in ~/.zshrc, ~/.bashrc, ~/.bash_profile or
#   ~/.config/fish/config.fish
#
# Everything else in $INSTALL_DIR (notably `perch/`, the flock cache) is user data and stays put
# unless you pass --purge. Running it twice is safe.

set -eu

DIR_FLAG=''
PURGE=0
QUIET=0
MARKER='# added by starling installer'

usage() {
  printf '%s\n' \
    'Usage: uninstall.sh [options]' \
    '' \
    'Removes the Starling CLI, the dashboard build and the installer PATH line.' \
    'Keeps perch data and anything else in the install directory unless --purge is given.' \
    '' \
    'Options:' \
    '  --dir <path>   install directory to clean (default: $STARLING_INSTALL_DIR or ~/.starling)' \
    '  --purge        also delete the whole install directory, including perch data' \
    '  --quiet        print errors only' \
    '  --help         show this help' \
    '' \
    'Environment:' \
    '  STARLING_INSTALL_DIR  install directory (default: ~/.starling)'
}

say() {
  if [ "$QUIET" -eq 0 ]; then printf '%s\n' "$*"; fi
}

die() {
  printf 'starling: %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --help | -h)
      usage
      exit 0
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
    --purge) PURGE=1; shift ;;
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
  /) die 'refusing to uninstall from /' ;;
esac

REMOVED=0

strip_marker() { # strip_marker <rc file>
  file=$1
  [ -f "$file" ] || return 0
  if ! grep -qF "$MARKER" "$file" 2>/dev/null; then
    return 0
  fi
  tmp="$file.starling-uninstall.$$"
  if grep -vF "$MARKER" "$file" >"$tmp" 2>/dev/null; then
    :
  else
    status=$?
    if [ "$status" -gt 1 ]; then
      rm -f "$tmp"
      return 0
    fi
  fi
  mv "$tmp" "$file"
  say "Removed the Starling PATH line from $file"
}

if [ -n "${HOME:-}" ]; then
  strip_marker "$HOME/.zshrc"
  strip_marker "$HOME/.bashrc"
  strip_marker "$HOME/.bash_profile"
  strip_marker "$HOME/.config/fish/config.fish"
fi

remove_file() { # remove_file <path>
  if [ -f "$1" ]; then
    rm -f "$1"
    say "Removed $1"
    REMOVED=1
  fi
}

remove_file "$INSTALL_DIR/bin/starling"
remove_file "$INSTALL_DIR/VERSION"
if [ -d "$INSTALL_DIR/share/starling" ]; then
  rm -rf "$INSTALL_DIR/share/starling"
  say "Removed $INSTALL_DIR/share/starling"
  REMOVED=1
fi

# Tidy the empty scaffolding install.sh created, but never a directory that still holds anything.
if [ -d "$INSTALL_DIR" ]; then
  rmdir "$INSTALL_DIR/bin" 2>/dev/null || true
  rmdir "$INSTALL_DIR/share" 2>/dev/null || true
fi

if [ "$PURGE" -eq 1 ] && [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  say "Removed $INSTALL_DIR (including perch data and any other files)"
  REMOVED=1
fi

if [ "$REMOVED" -eq 0 ]; then
  say "Starling is not installed at $INSTALL_DIR — nothing to remove."
fi
