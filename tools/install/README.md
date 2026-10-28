# Starling installer

One line, no sudo, no build tools:

```sh
curl -fsSL https://raw.githubusercontent.com/broiisapro/starling/main/tools/install/install.sh | sh
```

That detects your platform, downloads the matching release, verifies its SHA-256 against the
release's `SHA256SUMS`, and installs into `~/.starling`:

```
~/.starling/bin/starling        the CLI
~/.starling/share/starling/web  the dashboard build
~/.starling/VERSION             the installed version
```

It prints the PATH line for your shell and the next commands to try. A pretty URL
(`https://starling.dev/install.sh` or similar) is Epic 172's job; this is the canonical source.

## What it does, step by step

1. **Detects the platform.** `uname -s` → `darwin` / `linux`, `uname -m` → `arm64` / `x64`
   (`aarch64` → `arm64`, `x86_64` / `amd64` → `x64`). Refuses anything Epic 151 does not build
   (`darwin-arm64`, `darwin-x64`, `linux-x64`) and points at the build-from-source section.
2. **Downloads `SHA256SUMS` first.** `latest` is resolved from the asset names in the manifest, so
   no release API call is needed.
3. **Downloads the archive** with `curl -fsSL` or `wget -qO-` — whichever exists.
4. **Verifies** the archive's SHA-256 with `sha256sum` or `shasum -a 256`. A missing line or a
   mismatch stops the install before anything is written.
5. **Installs atomically.** The new binary is written as `bin/starling.new` then moved over the old
   one; `share/starling/web` is prepared as `web.new` and swapped. Re-running the same version is a
   no-op; a different version upgrades in place.
6. **Runs the installed binary** (`starling --version`) and prints the next steps.

Everything happens in a `mktemp -d` directory that a `trap` removes on exit — including on failure.

## Options

| Flag | Effect |
|---|---|
| `--version <v>` | install a pinned version instead of the latest release |
| `--dir <path>` | install somewhere other than `~/.starling` |
| `--modify-path` | append the PATH line to your shell rc file, once, behind the marker `# added by starling installer` |
| `--quiet` | errors only |
| `--help` | usage |

Unknown flags exit `2` with usage on stderr.

## Environment overrides

| Variable | Default | Use |
|---|---|---|
| `STARLING_VERSION` | `latest` | pin a version without a flag |
| `STARLING_INSTALL_DIR` | `$HOME/.starling` | install root |
| `STARLING_RELEASE_BASE_URL` | `https://github.com/broiisapro/starling/releases` | mirror or test host |
| `STARLING_UNAME_S` / `STARLING_UNAME_M` | `uname` output | fake the platform (tests, cross-installs) |
| `STARLING_NO_MODIFY_PATH` | unset | `1` refuses `--modify-path` |
| `STARLING_INSECURE_SKIP_VERIFY` | unset | `1` installs without a checksum and prints a loud warning |

`STARLING_RELEASE_BASE_URL` is joined as `<base>/latest/download/<asset>` or
`<base>/download/v<version>/<asset>`, which is exactly what a GitHub release serves.

## The asset contract (shared with Epic 151)

```
starling-<version>-<os>-<arch>.tar.gz          os in darwin|linux, arch in arm64|x64
starling-<version>-<os>-<arch>/
  bin/starling
  share/starling/web/
SHA256SUMS                                      <64 hex>  <asset name>
```

The installer is POSIX `sh` (`set -eu`, no bashisms). It is tested under `sh` and, when installed,
`dash`.

## Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/broiisapro/starling/main/tools/install/uninstall.sh | sh
```

It removes `bin/starling`, `share/starling`, `VERSION` and the installer's PATH line from
`~/.zshrc`, `~/.bashrc`, `~/.bash_profile` and `~/.config/fish/config.fish`. It keeps `perch/` and
anything else you put in `~/.starling` unless you pass `--purge`, which deletes the whole directory.
Running it twice is harmless. Same `--dir` / `STARLING_INSTALL_DIR` and `--quiet` options.

## Testing locally

```sh
bun test tools/install
bunx tsc --noEmit -p tools/install
sh -n tools/install/install.sh && sh -n tools/install/uninstall.sh
```

The tests start `startFakeRelease()` — a loopback `Bun.serve` that serves generated tarballs and a
real (or deliberately corrupted) `SHA256SUMS` — and run the actual scripts with a throwaway `HOME`
and install directory. Nothing leaves `127.0.0.1`; the harness refuses a non-loopback
`STARLING_RELEASE_BASE_URL`.

To try it by hand against that fake host:

```sh
bun -e '
  const { startFakeRelease } = await import("./tools/install/fake-release.ts");
  const release = startFakeRelease({ version: "1.0.0" });
  console.log(release.baseUrl);
  await new Promise((resolve) => setTimeout(resolve, 120000));
'
# in another terminal, using the URL it printed:
STARLING_RELEASE_BASE_URL=http://127.0.0.1:<port> STARLING_INSTALL_DIR=/tmp/st-home/.starling \
  sh tools/install/install.sh
```

`tools/install/fake-release.ts` exposes `requests` (the exact URLs fetched) and `sumsText`, which
is how the tests prove which release URL a run used.
