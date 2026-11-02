export CARGO_NET_GIT_FETCH_WITH_CLI="true"
export GENCODE_CLI_APP_NAME="gencode"
export GENCODE_CLI_BINARY_NAME="codium-server-insiders"
export GENCODE_CLI_DOWNLOAD_URL="https://github.com/GenCode/gencode-insiders/releases"
export GENCODE_CLI_QUALITY="insider"
export GENCODE_CLI_UPDATE_URL="https://raw.githubusercontent.com/GenCode/versions/refs/heads/master"

cargo build --release --target aarch64-apple-darwin --bin=code

cp target/aarch64-apple-darwin/release/code "../../GenCode-darwin-arm64/GenCode - Insiders.app/Contents/Resources/app/bin/codium-tunnel-insiders"

"../../GenCode-darwin-arm64/GenCode - Insiders.app/Contents/Resources/app/bin/codium-insiders" serve-web
