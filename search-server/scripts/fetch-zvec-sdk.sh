#!/usr/bin/env bash
# 下载 alibaba/zvec 0.8.1 官方 C SDK（预编译 libzvec_c_api + 头文件）。
#
# 用法：
#   search-server/scripts/fetch-zvec-sdk.sh            # 按当前平台安装到 .cache/zvec-sdk
#   ZVEC_SDK_DIR=/opt/zvec-sdk scripts/fetch-zvec-sdk.sh
#   scripts/fetch-zvec-sdk.sh --force                 # 重新下载并覆盖
#
# 版本钉死 v0.8.1（Apache-2.0），校验 sha256；产物在 .cache/（已 gitignore）。
set -euo pipefail

VERSION="${ZVEC_VERSION:-0.8.1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${ZVEC_SDK_DIR:-$ROOT/.cache/zvec-sdk}"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64)   ASSET="zvec-sdk-osx-arm64.tar.gz";        SHA="583d0cd6a0eca3336121b5d134edc5cdefaf169ac015da35fb0f167df7a52697" ;;
  Darwin-x86_64)  ASSET="zvec-sdk-osx-amd64.tar.gz";        SHA="a88205e2c1ecef1242d9dc755509ecbc0e30ab23771d3498bd087aa622a09673" ;;
  Linux-aarch64|Linux-arm64) ASSET="zvec-sdk-linux-arm64.tar.gz"; SHA="12444390d1ce352c60b7b798ba6255e862255fb922d7ac23db791ec436b9f3a5" ;;
  Linux-x86_64)   ASSET="zvec-sdk-linux-amd64.tar.gz";      SHA="cd4e4051b9baddb65896e73f2921a21e27fbf71711bd21eaedb58affaa93d1b9" ;;
  *)
    echo "不支持的平台：$os-$arch（可用 Linux/macOS amd64/arm64；musl 构建见 Dockerfile）" >&2
    exit 1
    ;;
esac

if [[ -f "$DEST/lib/libzvec_c_api.so" || -f "$DEST/lib/libzvec_c_api.dylib" ]] && [[ $FORCE -eq 0 ]]; then
  echo "zvec SDK 已存在：$DEST（--force 可重装）"
  exit 0
fi

CACHE="$ROOT/.cache/downloads"
mkdir -p "$CACHE" "$DEST"
TARBALL="$CACHE/$ASSET"

if [[ ! -f "$TARBALL" ]] || [[ $FORCE -eq 1 ]]; then
  url="https://github.com/alibaba/zvec/releases/download/v${VERSION}/${ASSET}"
  echo "下载 $url"
  curl -fL --retry 3 --retry-delay 2 -o "$TARBALL" "$url"
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$TARBALL" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
fi
if [[ "$actual" != "$SHA" ]]; then
  echo "sha256 校验失败：期望 $SHA，实际 $actual" >&2
  exit 1
fi

rm -rf "$DEST/lib" "$DEST/include"
tar -xzf "$TARBALL" -C "$DEST"
echo "zvec SDK v${VERSION} 已安装：$DEST"
ls "$DEST/lib"
