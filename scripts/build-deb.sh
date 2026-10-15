#!/usr/bin/env bash
# Gera um pacote .deb do HuberClaude (requer dist/ já buildado: `bun run build`).
# O Node.js vem embutido no pacote (nao depende de Node no sistema).
# Uso: scripts/build-deb.sh [saida_dir]   (padrão: ./release)
# Variaveis: NODE_VERSION (padrao 22.23.2), NODE_CACHE (padrao ~/.cache/huberclaude-build)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release}"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ARCH="$(dpkg --print-architecture)"
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

# Node.js oficial embutido (so o binario): baixa uma vez, confere o SHA-256 e guarda em cache
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

# /usr/bin/huberclaude: launcher que usa o Node embutido
install -m 755 "$ROOT/packaging/huberclaude-launcher" "$STAGE/$PKG/usr/bin/huberclaude"

# atalho de menu + ícone
mkdir -p "$STAGE/$PKG/usr/share/applications" "$STAGE/$PKG/usr/share/icons/hicolor/512x512/apps"
cp "$ROOT/packaging/huberclaude.desktop" "$STAGE/$PKG/usr/share/applications/"
cp "$ROOT/packaging/huberclaude.png" "$STAGE/$PKG/usr/share/icons/hicolor/512x512/apps/"
cp "$ROOT/packaging/post-install.sh" "$STAGE/$PKG/DEBIAN/postinst"
cp "$ROOT/packaging/post-remove.sh" "$STAGE/$PKG/DEBIAN/postrm"
chmod 755 "$STAGE/$PKG/DEBIAN/postinst" "$STAGE/$PKG/DEBIAN/postrm"

cat > "$STAGE/$PKG/DEBIAN/control" <<CTL
Package: huberclaude
Version: $VERSION
Section: devel
Priority: optional
Architecture: $ARCH
Maintainer: Huber <emaildohuber@gmail.com>
Installed-Size: $(du -sk "$STAGE/$PKG/usr" | cut -f1)
Description: HuberClaude - CLI de agente de código que roda em modelos OpenRouter
 Coding-agent CLI baseado no OpenClaude. Comando: huberclaude
CTL

chmod -R go-w "$STAGE/$PKG"
mkdir -p "$OUT"
fakeroot dpkg-deb -Zxz --build "$STAGE/$PKG" "$OUT/$PKG.deb"
echo "Gerado: $OUT/$PKG.deb"
