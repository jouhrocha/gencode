#!/usr/bin/env bash

cd gencode || { echo "'gencode' dir not found"; exit 1; }

if [[ -z "${GENCODE_SYSROOT_REPOSITORY}" ]]; then
  unset GENCODE_SYSROOT_REPOSITORY
fi

if [[ -z "${GENCODE_SYSROOT_VERSION}" ]]; then
  unset GENCODE_SYSROOT_VERSION
fi

if [[ -z "${GENCODE_SYSROOT_PREFIX}" ]]; then
  unset GENCODE_SYSROOT_PREFIX
fi

if [[ "${SHOULD_BUILD_DEB}" != "no" ]]; then
  npm run gulp "gencode-linux-${GENCODE_ARCH}-prepare-deb"
  npm run gulp "gencode-linux-${GENCODE_ARCH}-build-deb"
fi

if [[ "${SHOULD_BUILD_RPM}" != "no" ]]; then
  npm run gulp "gencode-linux-${GENCODE_ARCH}-prepare-rpm"
  npm run gulp "gencode-linux-${GENCODE_ARCH}-build-rpm"
fi

cd ..

if [[ "${CI_BUILD}" == "no" ]]; then
  . ./stores/snapcraft/build.sh

  if [[ "${SKIP_ASSETS}" == "no" ]]; then
    mv stores/snapcraft/build/*.snap assets/
  fi
fi

if [[ "${SHOULD_BUILD_TAR}" != "no" ]]; then
  echo "Building and moving TAR"
  cd "GenCode-linux-${GENCODE_ARCH}"
  tar czf "../assets/${APP_NAME}-linux-${GENCODE_ARCH}-${RELEASE_VERSION}.tar.gz" .
  cd ..
fi

if [[ "${SHOULD_BUILD_DEB}" != "no" ]]; then
  echo "Moving DEB"
  mv gencode/.build/linux/deb/*/deb/*.deb assets/
fi

if [[ "${SHOULD_BUILD_RPM}" != "no" ]]; then
  echo "Moving RPM"
  mv gencode/.build/linux/rpm/*/*.rpm assets/
fi
