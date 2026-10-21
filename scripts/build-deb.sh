#!/usr/bin/env bash
# Gera um pacote .deb do HuberClaude (requer dist/ já buildado: `bun run build`).
# Uso: scripts/build-deb.sh [saida_dir]   (padrão: ./release)
#
# Por padrão o .deb é autocontido: embute o Node.js oficial, então instala com um só
# apt (ou pela Central de Aplicativos) em qualquer distro, sem nenhum outro comando.
# Para um pacote menor que usa o Node do sistema:
#   WITH_NODE=0 scripts/build-deb.sh
# Nesse caso declara só Recommends: nodejs (>= 22), porque o nodejs do apt de muitas
# distros é antigo e quem usa nvm/tarball não tem o pacote nodejs (um Depends travaria
# a instalação); quem confere a versão é o launcher.
#
# Variaveis: WITH_NODE (padrao 1), NODE_VERSION (padrao 22.23.2),
#            NODE_CACHE (padrao ~/.cache/huberclaude-build)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release}"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ARCH="$(dpkg --print-architecture)"
WITH_NODE="${WITH_NODE:-1}"
NODE_VERSION="${NODE_VERSION:-22.23.2}"
case "$ARCH" in
  amd64) NODE_ARCH=x64 ;;
  arm64) NODE_ARCH=arm64 ;;
  *) echo "arquitetura nao suportada: $ARCH" >&2; exit 1 ;;
esac
PKG="huberclaude_${VERSION}_${ARCH}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
LIB="$STAGE/$PKG/usr/lib/huberclaude"

[ -f "$ROOT/dist/cli.mjs" ] || { echo "dist/cli.mjs não existe; rode 'bun run build'" >&2; exit 1; }

mkdir -p "$LIB/dist" "$LIB/vendor" "$STAGE/$PKG/usr/bin" "$STAGE/$PKG/DEBIAN"
cp -r "$ROOT/bin" "$LIB/bin"
cp "$ROOT/dist/cli.mjs" "$ROOT/dist/sdk.mjs" "$LIB/dist/"
cp -r "$ROOT/vendor/node-domexception-shim" "$LIB/vendor/"
cp "$ROOT/package.json" "$ROOT/README.md" "$ROOT/LICENSE" "$LIB/"
rm -f "$LIB"/bin/*.test.mjs

# dependências de runtime (orama, ripgrep, ...)
( cd "$LIB" && npm install --omit=dev --no-audit --no-fund --loglevel=error )

# Node.js oficial embutido (opcional): baixa uma vez, confere o SHA-256 e guarda em cache
# Só sem WITH_NODE=0; nesse caso o pacote usa o Node do sistema.
if [ "$WITH_NODE" = "1" ]; then
  NODE_CACHE="${NODE_CACHE:-$HOME/.cache/huberclaude-build}"
  NODE_TAR="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  mkdir -p "$NODE_CACHE"
  if [ ! -f "$NODE_CACHE/$NODE_TAR" ]; then
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/$NODE_TAR" -o "$NODE_CACHE/$NODE_TAR"
  fi
  EXPECTED="$(curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" | awk -v f="$NODE_TAR" '$2==f {print $1}')"
  ACTUAL="$(sha256sum "$NODE_CACHE/$NODE_TAR" | cut -d' ' -f1)"
  [ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || { echo "SHA-256 do Node nao confere ($NODE_TAR)" >&2; rm -f "$NODE_CACHE/$NODE_TAR"; exit 1; }
  mkdir -p "$LIB/node/bin"
  tar -xJf "$NODE_CACHE/$NODE_TAR" -C "$LIB/node" --strip-components=1 "node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node" "node-v${NODE_VERSION}-linux-${NODE_ARCH}/LICENSE"
fi

# /usr/bin/huber: launcher (Node embutido ou do sistema); /usr/bin/huberclaude aponta para ele
install -m 755 "$ROOT/packaging/huberclaude-launcher" "$STAGE/$PKG/usr/bin/huber"
ln -s huber "$STAGE/$PKG/usr/bin/huberclaude"

# atalho de menu + ícone
mkdir -p "$STAGE/$PKG/usr/share/applications" "$STAGE/$PKG/usr/share/icons/hicolor/512x512/apps"
cp "$ROOT/packaging/huberclaude.desktop" "$STAGE/$PKG/usr/share/applications/"
cp "$ROOT/packaging/huberclaude.png" "$STAGE/$PKG/usr/share/icons/hicolor/512x512/apps/"

# AppStream (autor, site, licença e ícone na Central de Aplicativos) + copyright do Debian
mkdir -p "$STAGE/$PKG/usr/share/metainfo" "$STAGE/$PKG/usr/share/doc/huberclaude"
cp "$ROOT/packaging/huberclaude.metainfo.xml" "$STAGE/$PKG/usr/share/metainfo/"
{
  printf 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n'
  printf 'Upstream-Name: huberclaude\n'
  printf 'Upstream-Contact: Leandro Huber <emaildohuber@gmail.com>\n'
  printf 'Source: https://github.com/Leandrodasilvahuber/huberclaude\n\n'
  printf 'Files: *\n'
  printf 'Copyright: Anthropic PBC (original Claude Code source)\n'
  printf '           OpenClaude contributors (modifications)\n'
  printf '           Leandro Huber <emaildohuber@gmail.com> (HuberClaude modifications)\n'
  printf 'License: see-notice\n'
  sed 's/^$/./; s/^/ /' "$ROOT/LICENSE"
} > "$STAGE/$PKG/usr/share/doc/huberclaude/copyright"
cp "$ROOT/packaging/post-install.sh" "$STAGE/$PKG/DEBIAN/postinst"
cp "$ROOT/packaging/post-remove.sh" "$STAGE/$PKG/DEBIAN/postrm"
chmod 755 "$STAGE/$PKG/DEBIAN/postinst" "$STAGE/$PKG/DEBIAN/postrm"

CONTROL_FIELDS=""
if [ "$WITH_NODE" != "1" ]; then
  CONTROL_FIELDS="Recommends: nodejs (>= 22)"
fi

# Use printf to avoid a blank line in the control file when WITH_NODE=1
{
  printf 'Package: huberclaude\n'
  printf 'Version: %s\n' "$VERSION"
  printf 'Section: devel\n'
  printf 'Priority: optional\n'
  printf 'Architecture: %s\n' "$ARCH"
  [ -n "$CONTROL_FIELDS" ] && printf '%s\n' "$CONTROL_FIELDS"
  printf 'Maintainer: Leandro Huber <emaildohuber@gmail.com>\n'
  printf 'Installed-Size: %s\n' "$(du -sk "$STAGE/$PKG/usr" | cut -f1)"
  printf 'Homepage: https://www.leandrohuber.freeddns.org/\n'
  printf 'Description: HuberClaude - open-source coding agent CLI for Linux, built for OpenRouter\n'
  printf ' HuberClaude is a coding agent that runs in your terminal and is dedicated to\n'
  printf ' OpenRouter: a single key gives access to thousands of models, with prices in\n'
  printf ' plain sight. It streams responses and supports sub-agents, web search, MCP,\n'
  printf ' skills and hooks. /model ships with recommended models by tier (FREE to HIGH)\n'
  printf ' and /usage shows your OpenRouter balance as a fuel gauge.\n'
  printf ' .\n'
  printf ' No keys or URLs are bundled: run /login after installing to paste your own.\n'
  [ "$WITH_NODE" = "1" ] || printf ' Requires Node.js 22 or newer on the system.\n'
  printf ' Commands: huber or huberclaude.\n'
} > "$STAGE/$PKG/DEBIAN/control"

chmod -R go-w "$STAGE/$PKG"
mkdir -p "$OUT"
fakeroot dpkg-deb -Zxz --build "$STAGE/$PKG" "$OUT/$PKG.deb"
echo "Gerado: $OUT/$PKG.deb"
