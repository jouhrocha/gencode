#!/usr/bin/env bash

cd gencode || { echo "'gencode' dir not found"; exit 1; }

npm run gulp "gencode-win32-${GENCODE_ARCH}-inno-updater"

# . ../build/windows/appx/build.sh

if [[ "${SHOULD_BUILD_ZIP}" != "no" ]]; then
  7z.exe a -tzip "../assets/${APP_NAME}-win32-${GENCODE_ARCH}-${RELEASE_VERSION}.zip" -x!CodeSignSummary*.md -x!tools "../GenCode-win32-${GENCODE_ARCH}/*" -r
fi

if [[ "${SHOULD_BUILD_EXE_SYS}" != "no" ]]; then
  npm run gulp "gencode-win32-${GENCODE_ARCH}-system-setup"
fi

if [[ "${SHOULD_BUILD_EXE_USR}" != "no" ]]; then
  npm run gulp "gencode-win32-${GENCODE_ARCH}-user-setup"
fi

if [[ "${GENCODE_ARCH}" == "ia32" || "${GENCODE_ARCH}" == "x64" ]]; then
  if [[ "${SHOULD_BUILD_MSI}" != "no" ]]; then
    . ../build/windows/msi/build.sh
  fi

  if [[ "${SHOULD_BUILD_MSI_NOUP}" != "no" ]]; then
    . ../build/windows/msi/build-updates-disabled.sh
  fi
fi

cd ..

if [[ "${SHOULD_BUILD_EXE_SYS}" != "no" ]]; then
  echo "Moving System EXE"
  mv "gencode\\.build\\win32-${GENCODE_ARCH}\\system-setup\\GenCodeSetup.exe" "assets\\${APP_NAME}Setup-${GENCODE_ARCH}-${RELEASE_VERSION}.exe"
fi

if [[ "${SHOULD_BUILD_EXE_USR}" != "no" ]]; then
  echo "Moving User EXE"
  mv "gencode\\.build\\win32-${GENCODE_ARCH}\\user-setup\\GenCodeSetup.exe" "assets\\${APP_NAME}UserSetup-${GENCODE_ARCH}-${RELEASE_VERSION}.exe"
fi

if [[ "${GENCODE_ARCH}" == "ia32" || "${GENCODE_ARCH}" == "x64" ]]; then
  if [[ "${SHOULD_BUILD_MSI}" != "no" ]]; then
    echo "Moving MSI"
    mv "build\\windows\\msi\\releasedir\\${APP_NAME}-${GENCODE_ARCH}-${RELEASE_VERSION}.msi" assets/
  fi

  if [[ "${SHOULD_BUILD_MSI_NOUP}" != "no" ]]; then
    echo "Moving MSI with disabled updates"
    mv "build\\windows\\msi\\releasedir\\${APP_NAME}-${GENCODE_ARCH}-updates-disabled-${RELEASE_VERSION}.msi" assets/
  fi
fi
