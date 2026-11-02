#!/usr/bin/env bash

set -ex

CALLER_DIR=$( pwd )

cd "$( dirname "${BASH_SOURCE[0]}" )"

SCRIPT_DIR=$( pwd )

cd "../../../GenCode-win32-${GENCODE_ARCH}/resources/app"

jsonTmp=$( jq "del(.updateUrl)" product.json )
echo "${jsonTmp}" > product.json && unset jsonTmp

cd "${SCRIPT_DIR}"

./build.sh "updates-disabled"

cd "${CALLER_DIR}"
