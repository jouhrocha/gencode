#!/usr/bin/env bash

set -ex

# Add Windows SDK to path
SDK='/C/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64'
export PATH="${SDK}:${PATH}"

APPX_NAME="${BINARY_NAME//-/_}"

powershell "makeappx pack /d ..\\GenCode-win32-${GENCODE_ARCH}\\appx\\manifest /p ..\\GenCode-win32-${GENCODE_ARCH}\\appx\\${APPX_NAME}_${GENCODE_ARCH}.appx /nv"

# Remove the raw manifest folder
rm -rf "../GenCode-win32-${GENCODE_ARCH}/appx/manifest"
