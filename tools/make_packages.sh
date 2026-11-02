#!/usr/bin/env bash
set -euo pipefail

BASE=/media/user/d48e5428-e66b-4a12-902d-02f018700477/vs/gencode
SRC="$BASE/GenCode-linux-x64"
DIST="$BASE/dist"
VER=1.143.1
ARCH=amd64

rm -rf "$DIST"
mkdir -p "$DIST"

echo "[1/2] portable tar.gz"
tar -czf "$DIST/gencode-${VER}-linux-x64.tar.gz" \
  --exclude=GenCode-linux-x64/data \
  -C "$BASE" GenCode-linux-x64

echo "[2/2] deb"
STAGE="$DIST/debroot"
rm -rf "$STAGE"
mkdir -p "$STAGE/opt" "$STAGE/usr/bin" "$STAGE/usr/share/applications" \
         "$STAGE/usr/share/icons/hicolor/512x512/apps" "$STAGE/DEBIAN"
cp -a "$SRC" "$STAGE/opt/gencode"
rm -rf "$STAGE/opt/gencode/data"
ln -sf /opt/gencode/gencode "$STAGE/usr/bin/gencode"
cp "$BASE/src/stable/resources/linux/code.png" "$STAGE/usr/share/icons/hicolor/512x512/apps/gencode.png"

cat > "$STAGE/usr/share/applications/gencode.desktop" <<'EOF'
[Desktop Entry]
Name=GenCode
Comment=Code editing. Redefined.
GenericName=Text Editor
Exec=/opt/gencode/gencode %F
Icon=gencode
Type=Application
StartupNotify=false
StartupWMClass=GenCode
Categories=TextEditor;Development;IDE;
MimeType=text/plain;inode/directory;
Actions=new-empty-window;
Keywords=gencode;

[Desktop Action new-empty-window]
Name=New Empty Window
Exec=/opt/gencode/gencode --new-window %F
Icon=gencode
EOF

cat > "$STAGE/DEBIAN/control" <<EOF
Package: gencode
Version: ${VER}
Section: devel
Priority: optional
Architecture: ${ARCH}
Maintainer: GenCode <noreply@localhost>
Installed-Size: $(du -sk "$STAGE/opt/gencode" | cut -f1)
Depends: libgtk-3-0, libnss3, libasound2, libx11-xcb1, libxcomposite1, libxdamage1, libxrandr2, libgbm1, libxkbcommon0, libsecret-1-0
Description: GenCode - editor de codigo
 Binario de GenCode con el subsistema de chat y proveedor de modelos
 OpenAI-compatible incluido como extension integrada.
EOF

find "$STAGE" -type d -exec chmod 755 {} +
chmod 4755 "$STAGE/opt/gencode/chrome-sandbox" 2>/dev/null || true
dpkg-deb --build --root-owner-group -Zzstd "$STAGE" "$DIST/gencode_${VER}_${ARCH}.deb"
rm -rf "$STAGE"

echo
ls -lh "$DIST"
