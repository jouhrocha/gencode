#!/usr/bin/env bash
# shellcheck disable=SC1091

exists() { type -t "$1" &> /dev/null; }

export APP_NAME="GenCode"
export CI_BUILD="no"
export OS_NAME="linux"
export SHOULD_BUILD="yes"
export SKIP_ASSETS="yes"
export GENCODE_LATEST="no"
export GENCODE_QUALITY="stable"

while getopts ":ilp" opt; do
  case "$opt" in
    i)
      export GENCODE_QUALITY="insider"
      ;;
    l)
      export GENCODE_LATEST="yes"
      ;;
    p)
      export SKIP_ASSETS="no"
      ;;
    *)
      ;;
  esac
done

UNAME_ARCH=$( uname -m )

if [[ "${UNAME_ARCH}" == "x86_64" ]]; then
  export GENCODE_ARCH="x64"
else
  export npm_config_arch=armv7l
  export npm_config_force_process_config="true"
  export GENCODE_ARCH="armhf"
fi

echo "OS_NAME=\"${OS_NAME}\""
echo "SKIP_ASSETS=\"${SKIP_ASSETS}\""
echo "GENCODE_ARCH=\"${GENCODE_ARCH}\""
echo "GENCODE_LATEST=\"${GENCODE_LATEST}\""
echo "GENCODE_QUALITY=\"${GENCODE_QUALITY}\""

rm -rf gencode* GenCode*

. get_repo.sh
. build.sh

if [[ "${SKIP_ASSETS}" == "no" ]]; then
  . prepare_assets.sh
fi
