#!/bin/sh
# Copia o atalho para a área de trabalho de cada usuário (melhor esforço) e
# o marca como confiável para GNOME/Cinnamon/MATE (gio) e XFCE (checksum).
# (nao tem nada aqui sobre Node embutido — o launcher resolve isso em runtime)
SRC=/usr/share/applications/huberclaude.desktop
for home in /home/*; do
  [ -d "$home" ] || continue
  user="$(basename "$home")"
  desk=""
  cfg="$home/.config/user-dirs.dirs"
  if [ -f "$cfg" ]; then
    desk="$(sed -n 's/^XDG_DESKTOP_DIR="\(.*\)"/\1/p' "$cfg" | sed "s|\$HOME|$home|")"
  fi
  for d in "$desk" "$home/Área de Trabalho" "$home/Desktop" "$home/Escritorio" "$home/Bureau"; do
    [ -n "$d" ] && [ -d "$d" ] || continue
    f="$d/huberclaude.desktop"
    cp "$SRC" "$f"
    chown "$user" "$f" 2>/dev/null || true
    chmod 755 "$f"
    if command -v gio >/dev/null 2>&1; then
      sum="$(sha256sum "$f" | cut -d' ' -f1)"
      runuser -u "$user" -- gio set "$f" metadata::trusted true >/dev/null 2>&1 || true
      runuser -u "$user" -- gio set "$f" metadata::xfce-exe-checksum "$sum" >/dev/null 2>&1 || true
    fi
    break
  done
done
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
exit 0
