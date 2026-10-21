#!/usr/bin/env bash
# Gera um .rpm do HuberClaude a partir do .deb já gerado por build-deb.sh.
# Uso: scripts/build-rpm.sh [saida_dir]   (requer rpmbuild no PATH ou RPMBUILD=/caminho)
# Nao precisa de dpkg: extrai o .deb com ar + tar, entao roda dentro de um conteiner Fedora
# (ex.: docker run --rm -v "$PWD:/src" -w /src fedora:41 sh -c 'dnf -y install rpm-build binutils tar xz nodejs && scripts/build-rpm.sh')
# Variavel: RPM_ARCH (x86_64 padrao, ou aarch64 com um .deb arm64)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release}"
RPMBUILD="${RPMBUILD:-rpmbuild}"
VERSION="$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
RPM_ARCH="${RPM_ARCH:-x86_64}"
case "$RPM_ARCH" in
  x86_64) DEB_ARCH=amd64 ;;
  aarch64) DEB_ARCH=arm64 ;;
  *) echo "arquitetura nao suportada: $RPM_ARCH" >&2; exit 1 ;;
esac
DEB="$OUT/huberclaude_${VERSION}_${DEB_ARCH}.deb"
[ -f "$DEB" ] || { echo "$DEB nao existe; rode scripts/build-deb.sh primeiro" >&2; exit 1; }

TOP="$(mktemp -d)"
trap 'rm -rf "$TOP"' EXIT
mkdir -p "$TOP"/{BUILD,RPMS,SPECS}
BR="$TOP/buildroot"
mkdir -p "$BR"
DATA="$(ar t "$DEB" | grep '^data.tar')"
case "$DATA" in
  *.xz) TARFLAG=-J ;;
  *.gz) TARFLAG=-z ;;
  *) echo "formato de dados do .deb nao suportado: $DATA" >&2; exit 1 ;;
esac
ar p "$DEB" "$DATA" | tar $TARFLAG -x -C "$BR"

cat > "$TOP/SPECS/huberclaude.spec" <<SPEC
Name: huberclaude
Version: $VERSION
Release: 1
Summary: HuberClaude - open-source coding agent CLI for Linux, built for OpenRouter
License: MIT
BuildArch: $RPM_ARCH
AutoReqProv: no
%global __os_install_post %{nil}
%global debug_package %{nil}
%global _build_id_links none

%description
HuberClaude is a coding agent that runs in your terminal and is dedicated to
OpenRouter: a single key gives access to thousands of models. No keys or URLs
are bundled: run /login after installing. Commands: huber or huberclaude.

%post
$(sed 's/^exit 0$//' "$ROOT/packaging/post-install.sh" | tail -n +2)

%postun
if [ "\$1" -eq 0 ]; then
$(sed 's/^exit 0$//' "$ROOT/packaging/post-remove.sh" | tail -n +2)
fi

%files
/usr/bin/huber
/usr/bin/huberclaude
/usr/lib/huberclaude
/usr/share/applications/huberclaude.desktop
/usr/share/icons/hicolor/512x512/apps/huberclaude.png
SPEC

"$RPMBUILD" -bb --define "_topdir $TOP" --buildroot "$BR" "$TOP/SPECS/huberclaude.spec" >/dev/null
mkdir -p "$OUT"
cp "$TOP"/RPMS/*/*.rpm "$OUT/"
ls "$OUT"/*.rpm
