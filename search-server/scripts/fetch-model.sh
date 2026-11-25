#!/usr/bin/env bash
# 下载 intfloat/multilingual-e5-small 的 ONNX 模型与 tokenizer（固定 revision）。
#
# 用法：
#   search-server/scripts/fetch-model.sh
#   MODEL_DIR=/opt/models/e5 scripts/fetch-model.sh
#
# 模型：MIT 许可证，384 维 E5 small；文档前缀 passage:，查询前缀 query:。
# 大文件（约 470 MiB）不进 git，落在 search-server/.cache/models/（已 gitignore）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${MODEL_DIR:-$ROOT/.cache/models/multilingual-e5-small}"
REVISION="614241f622f53c4eeff9890bdc4f31cfecc418b3"
BASE="https://huggingface.co/intfloat/multilingual-e5-small/resolve/${REVISION}"

MODEL_SHA="ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665"
TOKENIZER_SHA="0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"

mkdir -p "$DEST"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

fetch_verified() {
  local url="$1" out="$2" expected="$3"
  if [[ -f "$out" ]] && [[ "$(sha256_of "$out")" == "$expected" ]]; then
    echo "已存在且校验通过：$out"
    return
  fi
  echo "下载 $url"
  curl -fL --retry 3 --retry-delay 2 -o "$out.part" "$url"
  local actual
  actual="$(sha256_of "$out.part")"
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$out.part"
    echo "sha256 校验失败：$out 期望 $expected 实际 $actual" >&2
    exit 1
  fi
  mv "$out.part" "$out"
}

fetch_verified "$BASE/onnx/model.onnx" "$DEST/model.onnx" "$MODEL_SHA"
fetch_verified "$BASE/onnx/tokenizer.json" "$DEST/tokenizer.json" "$TOKENIZER_SHA"

echo "E5 模型已就绪：$DEST"
ls -lh "$DEST"
