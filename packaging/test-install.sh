#!/bin/sh
# Teste de instalacao do pacote. Roda DENTRO de um conteiner descartavel (nao rode no seu sistema).
# Uso: test-install.sh deb|rpm        (pacotes em /release; NOHOME=1 testa sem nenhum /home/*)
set -eu
MODE="$1"
fail() { echo "FALHOU: $*" >&2; exit 1; }
ok() { echo "  ok: $*"; }

echo "== ambiente: $(. /etc/os-release && echo "$PRETTY_NAME") | glibc $(ldd --version 2>&1 | head -1 | awk '{print $NF}')"
command -v node >/dev/null 2>&1 && fail "o conteiner ja tem Node; o teste precisa rodar sem Node no sistema"
ok "sem Node no sistema"

# imagens minimas (ex.: Fedora) nao trazem su/useradd
command -v su >/dev/null 2>&1 || dnf -y -q install util-linux shadow-utils >/dev/null 2>&1
useradd -m tester
mkdir -p /home/tester/Desktop
[ "${NOHOME:-}" = 1 ] && { userdel -r tester 2>/dev/null || true; rm -rf /home/*; ok "sem /home/*"; }

install_pkg() {
  if [ "$MODE" = deb ]; then apt-get install -y -qq "$@" /release/*.deb >/dev/null; else dnf -y -q install /release/*.rpm >/dev/null; fi
}
remove_pkg() {
  if [ "$MODE" = deb ]; then apt-get remove -y -qq huberclaude >/dev/null; else dnf -y -q remove huberclaude >/dev/null; fi
}

echo "== conteudo do pacote (so deve haver /usr/bin, /usr/lib/huberclaude, applications e icons)"
if [ "$MODE" = deb ]; then
  dpkg-deb -c /release/*.deb | awk '{print $6}' | sed 's|^\./||' | grep -vE '^(usr/(bin/huberclaude|lib/huberclaude(/|$)|share/(applications/huberclaude.desktop|icons/hicolor/512x512/apps/huberclaude.png))|usr/?$|usr/(bin|lib|share|share/applications|share/icons|share/icons/hicolor|share/icons/hicolor/512x512|share/icons/hicolor/512x512/apps)/?$|\.?/?$)' && fail "arquivo fora do esperado" || ok "caminhos esperados"
else
  rpm -qlp /release/*.rpm | grep -vE '^/usr/(bin/huberclaude|lib/huberclaude|share/applications/huberclaude.desktop|share/icons/hicolor/512x512/apps/huberclaude.png)' && fail "arquivo fora do esperado" || ok "caminhos esperados"
fi

echo "== instalar"
install_pkg
[ -x /usr/bin/huberclaude ] || fail "/usr/bin/huberclaude ausente"
[ -x /usr/lib/huberclaude/node/bin/node ] || fail "node embutido ausente"
[ -f /usr/share/applications/huberclaude.desktop ] || fail ".desktop ausente"
ok "arquivos instalados"
if [ "${NOHOME:-}" != 1 ]; then
  [ -f /home/tester/Desktop/huberclaude.desktop ] || fail "atalho nao foi copiado para a area de trabalho"
  ok "atalho na area de trabalho"
fi
command -v desktop-file-validate >/dev/null 2>&1 && { desktop-file-validate /usr/share/applications/huberclaude.desktop && ok ".desktop valido" || fail ".desktop invalido"; }

echo "== rodar como usuario comum"
[ "${NOHOME:-}" = 1 ] && useradd -m tester
VER="$(su tester -c 'huberclaude --version' 2>&1)" || fail "huberclaude --version: $VER"
echo "$VER" | grep -q '0\.31\.0' || fail "versao inesperada: $VER"
ok "huberclaude --version -> $VER"
su tester -c 'HUBERCLAUDE_OPENROUTER_API_KEY=sk-or-teste huberclaude --help' >/dev/null 2>&1 || fail "huberclaude --help"
ok "huberclaude --help"

echo "== reinstalar por cima"
if [ "$MODE" = deb ]; then apt-get install -y -qq --reinstall /release/*.deb >/dev/null; else dnf -y -q reinstall /release/*.rpm >/dev/null; fi
su tester -c 'huberclaude --version' >/dev/null || fail "nao roda depois de reinstalar"
ok "reinstalacao"

echo "== remover"
remove_pkg
for f in /usr/bin/huberclaude /usr/lib/huberclaude /usr/share/applications/huberclaude.desktop /home/tester/Desktop/huberclaude.desktop; do
  [ -e "$f" ] && fail "sobrou $f"
done
ok "nada sobrou"
echo "PASSOU"
