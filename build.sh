#!/usr/bin/env bash
# shellcheck disable=SC1091

set -ex

. version.sh

if [[ "${SHOULD_BUILD}" == "yes" ]]; then
  echo "MS_COMMIT=\"${MS_COMMIT}\""

  export MAX_OLD_SPACE_SIZE="${MAX_OLD_SPACE_SIZE:-8192}"

  . prepare_gencode.sh

  cd gencode || { echo "'gencode' dir not found"; exit 1; }

  export NODE_OPTIONS="--max-old-space-size=${MAX_OLD_SPACE_SIZE}"
  export GENCODE_PUBLISH_COUNTER=1

  npm run gulp gencode-min-prepack

  if [[ "${OS_NAME}" == "osx" ]]; then
    # remove win32 node modules
    rm -f .build/extensions/ms-gencode.js-debug/src/win32-app-container-tokens.*.node

    # generate Group Policy definitions
    npm run copy-policy-dto --prefix build
    node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc darwin

    npm run gulp "gencode-darwin-${GENCODE_ARCH}-min-packing"

    find "../GenCode-darwin-${GENCODE_ARCH}" -print0 | xargs -0 touch -c

    . ../build_cli.sh

    GENCODE_PLATFORM="darwin"
  elif [[ "${OS_NAME}" == "windows" ]]; then
    # in CI, packaging will be done by a different job
    if [[ "${CI_BUILD}" == "no" ]]; then
      . ../build/windows/rtf/make.sh

      if [[ "${GENCODE_ARCH}" == "x64" ]]; then
        . ../build/windows/install_inno_update.sh
      fi

      # generate Group Policy definitions
      npm run copy-policy-dto --prefix build
      node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc win32

      npm run gulp "gencode-win32-${GENCODE_ARCH}-min-packing"

      if [[ "${GENCODE_ARCH}" != "x64" ]]; then
        SHOULD_BUILD_REH="no"
        SHOULD_BUILD_REH_WEB="no"
      fi

      . ../build_cli.sh
    fi

    GENCODE_PLATFORM="win32"
  else # linux
    # remove win32 node modules
    rm -f .build/extensions/ms-gencode.js-debug/src/win32-app-container-tokens.*.node

    # in CI, packaging will be done by a different job
    if [[ "${CI_BUILD}" == "no" ]]; then
      # generate Group Policy definitions
      npm run copy-policy-dto --prefix build
      node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc linux

      npm run gulp "gencode-linux-${GENCODE_ARCH}-min-packing"

      find "../GenCode-linux-${GENCODE_ARCH}" -print0 | xargs -0 touch -c

      . ../build_cli.sh
    fi

    GENCODE_PLATFORM="linux"
  fi

  if [[ "${SHOULD_BUILD_REH}" != "no" ]]; then
    npm run gulp "gencode-reh-${GENCODE_PLATFORM}-${GENCODE_ARCH}-min-packing"
  fi

  if [[ "${SHOULD_BUILD_REH_WEB}" != "no" ]]; then
    npm run gulp "gencode-reh-web-${GENCODE_PLATFORM}-${GENCODE_ARCH}-min-packing"
  fi

  cd ..
fi
