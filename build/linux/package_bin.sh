#!/usr/bin/env bash
# shellcheck disable=SC1091

set -ex

if [[ "${CI_BUILD}" == "no" ]]; then
  exit 1
fi

npm -v
node -v

# include common functions
. ./utils.sh

tar -xzf ./gencode.tar.gz

chown -R root:root gencode

cd gencode || { echo "'gencode' dir not found"; exit 1; }

export GENCODE_PLATFORM='linux'
export GENCODE_SKIP_NODE_VERSION_CHECK=1
export GENCODE_SYSROOT_PREFIX='-glibc-2.28-gcc-10.5.0'

if [[ "${GENCODE_ARCH}" == "arm64" ]]; then
  export GENCODE_SKIP_SYSROOT=1
  # export USE_GNUPP2A=1
elif [[ "${GENCODE_ARCH}" == "ppc64le" ]]; then
  export GENCODE_SYSROOT_REPOSITORY='GenCode/gencode-linux-build-agent'
  export GENCODE_SYSROOT_VERSION='20260706'
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  export GENCODE_ELECTRON_REPOSITORY='lex-ibm/electron-ppc64le-build-scripts'
  export IGNORE_ELECTRON_VERSION="yes"
elif [[ "${GENCODE_ARCH}" == "riscv64" ]]; then
  export GENCODE_ELECTRON_REPOSITORY='riscv-forks/electron-riscv-releases'
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  export GENCODE_SKIP_SETUPENV=1
elif [[ "${GENCODE_ARCH}" == "loong64" ]]; then
  export GENCODE_ELECTRON_REPOSITORY='darkyzhou/electron-loong64'
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  export GENCODE_SKIP_SETUPENV=1
fi

if [[ -f "../build/linux/${GENCODE_ARCH}/electron.sh" ]]; then
  # add newline at the end of the file
  echo "" >> build/checksums/electron.txt

  if [[ -f "../build/linux/${GENCODE_ARCH}/electron.sha256sums" ]]; then
    cat "../build/linux/${GENCODE_ARCH}/electron.sha256sums" >> build/checksums/electron.txt
  fi

  # shellcheck disable=SC1090
  source "../build/linux/${GENCODE_ARCH}/electron.sh"

  TARGET=$( grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' .npmrc )

  # Only fails at different major versions
  if [[ "${ELECTRON_VERSION%%.*}" != "${TARGET%%.*}" ]] && [[ "${IGNORE_ELECTRON_VERSION}" != "yes" ]]; then
    # Fail the pipeline if electron target doesn't match what is used.
    echo "Electron ${GENCODE_ARCH} binary version doesn't match target electron version!"
    echo "Releases available at: https://github.com/${GENCODE_ELECTRON_REPOSITORY}/releases"
    exit 1
  fi

  if [[ "${ELECTRON_VERSION}" != "${TARGET}" ]]; then
    # Force version
    replace "s|target=\"${TARGET}\"|target=\"${ELECTRON_VERSION}\"|" .npmrc

    cat .npmrc

    export GENCODE_ELECTRON_VERSION="${ELECTRON_VERSION}"
  fi
fi

if [[ -d "../patches/linux/client/" ]]; then
  for file in "../patches/linux/client/"*.patch; do
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

  if [ ! -d "$HOME/.gyp" ]; then
    mkdir -p "$HOME/.gyp"
  fi

  echo "${INCLUDES}" > "$HOME/.gyp/include.gypi"
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
    source ./build/azure-pipelines/linux/setup-env.sh
  fi
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

# delete native files built in the `compile` step
find .build/extensions -type f -name '*.node' -print -delete

# generate Group Policy definitions
npm run copy-policy-dto --prefix build
node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc linux

npm run gulp "gencode-linux-${GENCODE_ARCH}-min-packing"

if [[ -f "../build/linux/${GENCODE_ARCH}/ripgrep.sh" ]]; then
  bash "../build/linux/${GENCODE_ARCH}/ripgrep.sh" "../GenCode-linux-${GENCODE_ARCH}/resources/app/node_modules"
fi

find "../GenCode-linux-${GENCODE_ARCH}" -print0 | xargs -0 touch -c

. ../build_cli.sh

if [[ -n "${GITHUB_OUTPUT}" ]]; then
  echo "GENCODE_SYSROOT_REPOSITORY=${GENCODE_SYSROOT_REPOSITORY:-}" >> "${GITHUB_OUTPUT}"
  echo "GENCODE_SYSROOT_VERSION=${GENCODE_SYSROOT_VERSION:-}" >> "${GITHUB_OUTPUT}"
  echo "GENCODE_SYSROOT_PREFIX=${GENCODE_SYSROOT_PREFIX:-}" >> "${GITHUB_OUTPUT}"
fi

cd ..
