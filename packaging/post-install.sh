#!/bin/sh
# Pós-instalação: nunca pergunta nada nem espera ninguém (todo comando externo tem
# timeout e falha em silêncio), para o apt e a Central de Aplicativos irem até o fim.
#  1. copia o atalho para a área de trabalho de cada usuário (melhor esforço) e o marca
#     como confiável para GNOME/Cinnamon/MATE (gio) e XFCE (checksum);
#  2. mostra o logo e como rodar no terminal e, para quem instalou pela interface,
#     uma notificação com o ícone em cada sessão gráfica aberta.
# deb chama com "configure"; nas outras ações (abort-upgrade etc.) só sai.
case "${1:-configure}" in
  configure|[0-9]*) ;;
  *) exit 0 ;;
esac

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
      timeout 5 runuser -u "$user" -- gio set "$f" metadata::trusted true </dev/null >/dev/null 2>&1 || true
      timeout 5 runuser -u "$user" -- gio set "$f" metadata::xfce-exe-checksum "$sum" </dev/null >/dev/null 2>&1 || true
    fi
    break
  done
done
command -v update-desktop-database >/dev/null 2>&1 && timeout 30 update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && timeout 30 gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true

# Logo (o H rajado, em blocos de meia altura) e como rodar
G="$(printf '\033[38;2;150;175;76m')"; B="$(printf '\033[1m')"; R="$(printf '\033[0m')"
cat <<MSG

${G}    ▀▀▀▀▀▀▀▀    ▀▀▀▀▀▀▀▀
    ▀▀▀▀▀▀▀▀    ▀▀▀▀▀▀▀▀
    ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
    ▀▀▀▀▀▀▀▀    ▀▀▀▀▀▀▀▀
    ▀▀▀▀▀▀▀▀    ▀▀▀▀▀▀▀▀${R}

    ${B}HuberClaude installed!${R}

    Run it from anywhere in the system with either command:
        ${G}${B}huber${R}
        ${G}${B}huberclaude${R}

    No keys or URLs come with the package: run /login inside HuberClaude
    and paste your OpenRouter key to get started.

MSG

# Notificação com o ícone para cada usuário com sessão gráfica aberta (melhor esforço)
if command -v notify-send >/dev/null 2>&1; then
  for bus in /run/user/*/bus; do
    [ -S "$bus" ] || continue
    uid="$(basename "$(dirname "$bus")")"
    user="$(id -nu "$uid" 2>/dev/null)" || continue
    timeout 5 runuser -u "$user" -- env DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" \
      notify-send -a HuberClaude -i huberclaude "HuberClaude installed" \
      "Open a terminal and run huber or huberclaude." </dev/null >/dev/null 2>&1 || true
  done
fi
exit 0
