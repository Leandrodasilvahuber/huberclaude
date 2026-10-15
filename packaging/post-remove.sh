#!/bin/sh
for home in /home/*; do
  rm -f "$home/Área de Trabalho/huberclaude.desktop" "$home/Desktop/huberclaude.desktop" \
        "$home/Escritorio/huberclaude.desktop" "$home/Bureau/huberclaude.desktop"
  d="$(sed -n 's/^XDG_DESKTOP_DIR="\(.*\)"/\1/p' "$home/.config/user-dirs.dirs" 2>/dev/null | sed "s|\$HOME|$home|")"
  [ -n "$d" ] && rm -f "$d/huberclaude.desktop"
done
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
exit 0
