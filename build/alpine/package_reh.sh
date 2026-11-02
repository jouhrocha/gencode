#!/usr/bin/env bash
# shellcheck disable=SC1091

set -ex

if [[ "${CI_BUILD}" == "no" ]]; then
  exit 1
fi

# include common functions
. ./utils.sh

mkdir -p assets

tar -xzf ./gencode.tar.gz

cd gencode || { echo "'gencode' dir not found"; exit 1; }

export GENCODE_PLATFORM='alpine'
export GENCODE_SKIP_NODE_VERSION_CHECK=1

GENCODE_HOST_MOUNT="$( pwd )"
GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME="gencode/gencode-linux-build-agent:alpine-${GENCODE_ARCH}"

export GENCODE_HOST_MOUNT GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME

if [[ -d "../patches/alpine/reh/" ]]; then
  for file in "../patches/alpine/reh/"*.patch; do
    if [[ -f "${file}" ]]; then
      apply_patch "${file}"
    fi
  done
fi

for i in {1..5}; do # try 5 times
  npm ci && break
  if [[ $i == 5 ]]; then
    echo "Npm install failed too many times" >&2
    exit 1
  fi
  echo "Npm install failed $i, trying again..."
done

node build/azure-pipelines/distro/mixin-npm.ts

if [[ "${GENCODE_ARCH}" == "x64" ]]; then
  PA_NAME="linux-alpine"
else
  PA_NAME="alpine-arm64"
fi

if [[ "${SHOULD_BUILD_REH}" != "no" ]]; then
  echo "Building REH"
  npm run gulp "gencode-reh-${PA_NAME}-min"

  pushd "../gencode-reh-${PA_NAME}"

  echo "Archiving REH"
  tar czf "../assets/${APP_NAME_LC}-reh-${GENCODE_PLATFORM}-${GENCODE_ARCH}-${RELEASE_VERSION}.tar.gz" .

  popd
fi

if [[ "${SHOULD_BUILD_REH_WEB}" != "no" ]]; then
  echo "Building REH-web"
  npm run gulp "gencode-reh-web-${PA_NAME}-min"

  pushd "../gencode-reh-web-${PA_NAME}"

  echo "Archiving REH-web"
  tar czf "../assets/${APP_NAME_LC}-reh-web-${GENCODE_PLATFORM}-${GENCODE_ARCH}-${RELEASE_VERSION}.tar.gz" .

  popd
fi

cd ..

npm install -g checksum

sum_file() {
  if [[ -f "${1}" ]]; then
    echo "Calculating checksum for ${1}"
    checksum -a sha256 "${1}" > "${1}".sha256
    checksum "${1}" > "${1}".sha1
  fi
}

cd assets

for FILE in *; do
  if [[ -f "${FILE}" ]]; then
    sum_file "${FILE}"
  fi
done

cd ..
