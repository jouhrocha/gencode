#!/usr/bin/env bash

if [[ "${SHOULD_BUILD_CLI}" == "no" ]]; then
  echo "Skipping CLI build"
  return 0
fi

set -ex

cd cli

export CARGO_NET_GIT_FETCH_WITH_CLI="true"
export GENCODE_CLI_APP_NAME="$( echo "${APP_NAME}" | awk '{print tolower($0)}' )"
export GENCODE_CLI_BINARY_NAME="$( node -p "require(\"../product.json\").serverApplicationName" )"
export GENCODE_CLI_UPDATE_ENDPOINT="https://raw.githubusercontent.com/VSCodium/versions/refs/heads/master"

if [[ "${GENCODE_QUALITY}" == "insider" ]]; then
  export GENCODE_CLI_DOWNLOAD_ENDPOINT="https://github.com/VSCodium/vscodium-insiders/releases"
else
  export GENCODE_CLI_DOWNLOAD_ENDPOINT="https://github.com/VSCodium/vscodium/releases"
fi

TUNNEL_APPLICATION_NAME="$( node -p "require(\"../product.json\").tunnelApplicationName" )"
NAME_SHORT="$( node -p "require(\"../product.json\").nameShort" )"

npm pack @gencode/openssl-prebuilt@0.0.11
mkdir openssl
tar -xvzf gencode-openssl-prebuilt-0.0.11.tgz --strip-components=1 --directory=openssl

if [[ "${OS_NAME}" == "osx" ]]; then
  if [[ "${GENCODE_ARCH}" == "arm64" ]]; then
    GENCODE_CLI_TARGET="aarch64-apple-darwin"
  else
    GENCODE_CLI_TARGET="x86_64-apple-darwin"
  fi

  export OPENSSL_LIB_DIR="$( pwd )/openssl/out/${GENCODE_ARCH}-osx/lib"
  export OPENSSL_INCLUDE_DIR="$( pwd )/openssl/out/${GENCODE_ARCH}-osx/include"

  rustup target add "${GENCODE_CLI_TARGET}"

  cargo build --release --target "${GENCODE_CLI_TARGET}" --bin=code

  cp "target/${GENCODE_CLI_TARGET}/release/code" "../../GenCode-darwin-${GENCODE_ARCH}/${NAME_SHORT}.app/Contents/Resources/app/bin/${TUNNEL_APPLICATION_NAME}"
elif [[ "${OS_NAME}" == "windows" ]]; then
  if [[ "${GENCODE_ARCH}" == "arm64" ]]; then
    GENCODE_CLI_TARGET="aarch64-pc-windows-msvc"
    export GENCODE_CLI_RUST="-C target-feature=+crt-static -Clink-args=/guard:cf -Clink-args=/CETCOMPAT:NO"
  else
    GENCODE_CLI_TARGET="x86_64-pc-windows-msvc"
    export GENCODE_CLI_RUSTFLAGS="-Ctarget-feature=+crt-static -Clink-args=/guard:cf -Clink-args=/CETCOMPAT"
  fi

  export GENCODE_CLI_CFLAGS="/guard:cf /Qspectre"
  export OPENSSL_LIB_DIR="$( pwd )/openssl/out/${GENCODE_ARCH}-windows-static/lib"
  export OPENSSL_INCLUDE_DIR="$( pwd )/openssl/out/${GENCODE_ARCH}-windows-static/include"

  rustup target add "${GENCODE_CLI_TARGET}"

  cargo build --release --target "${GENCODE_CLI_TARGET}" --bin=code

  cp "target/${GENCODE_CLI_TARGET}/release/code.exe" "../../GenCode-win32-${GENCODE_ARCH}/bin/${TUNNEL_APPLICATION_NAME}.exe"
else
  export OPENSSL_LIB_DIR="$( pwd )/openssl/out/${GENCODE_ARCH}-linux/lib"
  export OPENSSL_INCLUDE_DIR="$( pwd )/openssl/out/${GENCODE_ARCH}-linux/include"
  export GENCODE_SYSROOT_DIR="../.build/sysroots"

  if [[ "${GENCODE_ARCH}" == "arm64" ]]; then
    GENCODE_CLI_TARGET="aarch64-unknown-linux-gnu"

    if [[ "${CI_BUILD}" != "no" ]]; then
      export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
      export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
      export CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++
      export PKG_CONFIG_ALLOW_CROSS=1
    fi
  elif [[ "${GENCODE_ARCH}" == "ppc64le" ]]; then
    GENCODE_CLI_TARGET="powerpc64le-unknown-linux-gnu"

    # Use system libs instead of @gencode/openssl-prebuilt
    mkdir -p openssl/out/ppc64le-linux/
    ln -sf /usr/lib/powerpc64le-linux-gnu openssl/out/ppc64le-linux/lib
    ln -sf /usr/include openssl/out/ppc64le-linux/include

    if [[ "${CI_BUILD}" != "no" ]] && [[ "$(uname -m)" != "ppc64le" ]]; then
      export CARGO_TARGET_POWERPC64LE_UNKNOWN_LINUX_GNU_LINKER=powerpc64le-linux-gnu-gcc-10
      export CC_powerpc64le_unknown_linux_gnu=powerpc64le-linux-gnu-gcc-10
      export CXX_powerpc64le_unknown_linux_gnu=powerpc64le-linux-gnu-g++-10
      export PKG_CONFIG_ALLOW_CROSS=1
    fi

  elif [[ "${GENCODE_ARCH}" == "x64" ]]; then
    GENCODE_CLI_TARGET="x86_64-unknown-linux-gnu"
  fi

  if [[ -n "${GENCODE_CLI_TARGET}" ]]; then
    rustup target add "${GENCODE_CLI_TARGET}"

    cargo build --release --target "${GENCODE_CLI_TARGET}" --bin=code

    cp "target/${GENCODE_CLI_TARGET}/release/code" "../../GenCode-linux-${GENCODE_ARCH}/bin/${TUNNEL_APPLICATION_NAME}"
  fi
fi

cd ..
