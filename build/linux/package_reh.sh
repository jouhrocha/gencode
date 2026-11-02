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

GLIBC_VERSION="2.28"
GLIBCXX_VERSION="3.4.26"
NODE_VERSION=$( grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' remote/.npmrc )

echo "NODE_VERSION=${NODE_VERSION}"

export GENCODE_NODEJS_URLROOT='/download/release'
export GENCODE_NODEJS_URLSUFFIX=''

if [[ "${GENCODE_ARCH}" == "x64" ]]; then
  GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME="gencode/gencode-linux-build-agent:focal-devtoolset-x64"

  export GENCODE_SKIP_SETUPENV=1
elif [[ "${GENCODE_ARCH}" == "arm64" ]]; then
  EXPECTED_GLIBC_VERSION="2.30"

  GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME="gencode/gencode-linux-build-agent:focal-devtoolset-arm64"

  export GENCODE_SKIP_SYSROOT=1
  export USE_GNUPP2A=1
elif [[ "${GENCODE_ARCH}" == "armhf" ]]; then
  GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME="gencode/gencode-linux-build-agent:focal-devtoolset-armhf"
  NODE_VERSION="24.20.0"

  export GENCODE_NODEJS_REPOSITORY='4meters/node-for-armv7'
  export GENCODE_NODEJS_TAG="v${NODE_VERSION}-armv7l"
  export GENCODE_NODEJS_NAME="node-v${NODE_VERSION}-linux-armv7l.tar.gz"
elif [[ "${GENCODE_ARCH}" == "ppc64le" ]]; then
  GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME="gencode/gencode-linux-build-agent:focal-devtoolset-ppc64le"
  export GENCODE_SYSROOT_REPOSITORY='GenCode/gencode-linux-build-agent'
  export GENCODE_SYSROOT_VERSION='20260706'
elif [[ "${GENCODE_ARCH}" == "riscv64" ]]; then
  GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME="gencode/gencode-linux-build-agent:jammy-devtoolset-riscv64"
  NODE_VERSION="24.18.0"

  export GENCODE_SKIP_SETUPENV=1
  export GENCODE_NODEJS_REPOSITORY='riscv-forks/node-riscv'
  export GENCODE_NODEJS_TAG="v${NODE_VERSION}-riscv64.1"
  export GENCODE_NODEJS_NAME="node-v${NODE_VERSION}-linux-${GENCODE_ARCH}-local1.tar.gz"
elif [[ "${GENCODE_ARCH}" == "loong64" ]]; then
  GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME="gencode/gencode-linux-build-agent:beige-devtoolset-loong64"

  export GENCODE_SKIP_SETUPENV=1
  export GENCODE_NODEJS_SITE='https://unofficial-builds.nodejs.org'
elif [[ "${GENCODE_ARCH}" == "s390x" ]]; then
  GLIBC_VERSION="2.28"

  GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME="gencode/gencode-linux-build-agent:focal-devtoolset-s390x"
  GENCODE_SYSROOT_PREFIX="-glibc-${GLIBC_VERSION}"

  export GENCODE_SYSROOT_REPOSITORY='GenCode/gencode-linux-build-agent'
  export GENCODE_SYSROOT_VERSION='20241108'
fi

export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export GENCODE_PLATFORM='linux'
export GENCODE_SKIP_NODE_VERSION_CHECK=1

if [[ -z "${GENCODE_SYSROOT_PREFIX}" ]]; then
  export GENCODE_SYSROOT_PREFIX="-glibc-${GLIBC_VERSION}-gcc-10.5.0"
else
  export GENCODE_SYSROOT_PREFIX
fi

EXPECTED_GLIBC_VERSION="${EXPECTED_GLIBC_VERSION:=GLIBC_VERSION}"
GENCODE_HOST_MOUNT="$( pwd )"

export GENCODE_HOST_MOUNT
export GENCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME

sed -i "/target/s/\"22.*\"/\"${NODE_VERSION}\"/" remote/.npmrc

if [[ -d "../patches/linux/reh/" ]]; then
  for file in "../patches/linux/reh/"*.patch; do
    if [[ -f "${file}" ]]; then
      apply_patch "${file}"
    fi
  done
fi

if [[ -d "../patches/linux/reh/${GENCODE_ARCH}/" ]]; then
  for file in "../patches/linux/reh/${GENCODE_ARCH}/"*.patch; do
    if [[ -f "${file}" ]]; then
      apply_patch "${file}"
    fi
  done
fi

if [[ -n "${USE_GNUPP2A}" ]]; then
  INCLUDES=$(cat <<EOF
{
  "target_defaults": {
    "conditions": [
      ["OS=='linux'", {
        'cflags_cc!': [ '-std=gnu++20' ],
        'cflags_cc': [ '-std=gnu++2a' ],
      }]
    ]
  }
}
EOF
)

  if [ ! -d "${HOME}/.gyp" ]; then
    mkdir -p "${HOME}/.gyp"
  fi

  echo "${INCLUDES}" > "${HOME}/.gyp/include.gypi"
fi

for i in {1..5}; do # try 5 times
  npm ci --prefix build && break
  if [[ $i == 5 ]]; then
    echo "Npm install failed too many times" >&2
    exit 1
  fi
  echo "Npm install failed $i, trying again..."
done

if [[ -z "${GENCODE_SKIP_SETUPENV}" ]]; then
  if [[ -n "${GENCODE_SKIP_SYSROOT}" ]]; then
    source ./build/azure-pipelines/linux/setup-env.sh --skip-sysroot
  else
    cat ./build/checksums/gencode-sysroot.txt

    source ./build/azure-pipelines/linux/setup-env.sh
  fi

  export GENCODE_SYSROOT_DIR="${GENCODE_REMOTE_SYSROOT_DIR}"
else
  mkdir -p .build/x86_64-linux-gnu/x86_64-linux-gnu/bin

  ln -s $( which objdump ) .build/x86_64-linux-gnu/x86_64-linux-gnu/bin/objdump

  export GENCODE_SYSROOT_DIR=".build"
fi

node build/npm/preinstall.ts

echo "+ /usr/lib/node_modules/npm/node_modules/node-gyp/addon.gypi"
cat /usr/lib/node_modules/npm/node_modules/node-gyp/addon.gypi || true

echo "+ ${HOME}/.gyp/include.gypi"
cat "${HOME}/.gyp/include.gypi" || true

for i in {1..5}; do # try 5 times
  npm ci && break
  if [[ $i == 5 ]]; then
    echo "Npm install failed too many times" >&2
    exit 1
  fi
  echo "Npm install failed $i, trying again..."

  # remove dependencies that fail during cleanup
  rm -rf node_modules/@gencode node_modules/node-pty
done

# if [[ "${GENCODE_ARCH}" == "x64" ]]; then
#   pushd "remote"

#   for LIB in @parcel/watcher @gencode/spdlog kerberos node-pty
#   do
#     pushd "node_modules/${LIB}"

#     CXXFLAGS="-D_GLIBCXX_USE_CXX11_ABI=0" npx node-gyp rebuild

#     popd
#   done

#   popd

#   VERIFY_CXX11=1
# fi

node build/azure-pipelines/distro/mixin-npm.ts

export GENCODE_NODE_GLIBC="-glibc-${GLIBC_VERSION}"

if [[ "${SHOULD_BUILD_REH}" != "no" ]]; then
  echo "Building REH"
  npm run gulp "gencode-reh-${GENCODE_PLATFORM}-${GENCODE_ARCH}-min"

  EXPECTED_GLIBC_VERSION="${EXPECTED_GLIBC_VERSION}" EXPECTED_GLIBCXX_VERSION="${GLIBCXX_VERSION}" SEARCH_PATH="../gencode-reh-${GENCODE_PLATFORM}-${GENCODE_ARCH}" ./build/azure-pipelines/linux/verify-glibc-requirements.sh

  # if [[ -n "${VERIFY_CXX11}" ]]; then
  #   SEARCH_PATH="../gencode-reh-${GENCODE_PLATFORM}-${GENCODE_ARCH}" ../build/linux/verify_cxx11_requirements.sh
  # fi

  pushd "../gencode-reh-${GENCODE_PLATFORM}-${GENCODE_ARCH}"

  if [[ -f "../build/linux/${GENCODE_ARCH}/ripgrep.sh" ]]; then
    bash "../build/linux/${GENCODE_ARCH}/ripgrep.sh" "node_modules"
  fi

  echo "Archiving REH"
  tar czf "../assets/${APP_NAME_LC}-reh-${GENCODE_PLATFORM}-${GENCODE_ARCH}-${RELEASE_VERSION}.tar.gz" .

  popd
fi

if [[ "${SHOULD_BUILD_REH_WEB}" != "no" ]]; then
  echo "Building REH-web"
  npm run gulp "gencode-reh-web-${GENCODE_PLATFORM}-${GENCODE_ARCH}-min"

  EXPECTED_GLIBC_VERSION="${EXPECTED_GLIBC_VERSION}" EXPECTED_GLIBCXX_VERSION="${GLIBCXX_VERSION}" SEARCH_PATH="../gencode-reh-web-${GENCODE_PLATFORM}-${GENCODE_ARCH}" ./build/azure-pipelines/linux/verify-glibc-requirements.sh

  # if [[ -n "${VERIFY_CXX11}" ]]; then
  #   SEARCH_PATH="../gencode-reh-${GENCODE_PLATFORM}-${GENCODE_ARCH}" ../build/linux/verify_cxx11_requirements.sh
  # fi

  pushd "../gencode-reh-web-${GENCODE_PLATFORM}-${GENCODE_ARCH}"

  if [[ -f "../build/linux/${GENCODE_ARCH}/ripgrep.sh" ]]; then
    bash "../build/linux/${GENCODE_ARCH}/ripgrep.sh" "node_modules"
  fi

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
