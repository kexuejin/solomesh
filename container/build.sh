#!/bin/bash
# Build the SoloMesh agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="solomesh-agent"
TAG="${1:-latest}"
PRIMARY_NODE_BASE_IMAGE="${NODE_BASE_IMAGE:-node:22-slim}"
FALLBACK_NODE_BASE_IMAGE="${NODE_BASE_IMAGE_FALLBACK:-mirror.gcr.io/library/node:22-slim}"
BUILD_RETRY_COUNT="${BUILD_RETRY_COUNT:-2}"

echo "Building SoloMesh agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"
echo "Primary base image: ${PRIMARY_NODE_BASE_IMAGE}"
echo "Fallback base image: ${FALLBACK_NODE_BASE_IMAGE}"

build_with_base_image() {
  local base_image="$1"
  local attempt
  for ((attempt=1; attempt<=BUILD_RETRY_COUNT; attempt++)); do
    echo "Attempt ${attempt}/${BUILD_RETRY_COUNT} with base image: ${base_image}"
    if docker build \
      --build-arg CACHEBUST="$(date +%s)" \
      --build-arg NODE_BASE_IMAGE="${base_image}" \
      -t "${IMAGE_NAME}:${TAG}" .; then
      return 0
    fi
    if [ "${attempt}" -lt "${BUILD_RETRY_COUNT}" ]; then
      echo "Build failed, retrying in 5s..."
      sleep 5
    fi
  done
  return 1
}

if ! build_with_base_image "${PRIMARY_NODE_BASE_IMAGE}"; then
  if [ "${PRIMARY_NODE_BASE_IMAGE}" != "${FALLBACK_NODE_BASE_IMAGE}" ]; then
    echo "Primary base image failed, retrying with fallback..."
    build_with_base_image "${FALLBACK_NODE_BASE_IMAGE}"
  else
    echo "Build failed after retries."
    exit 1
  fi
fi

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | docker run -i ${IMAGE_NAME}:${TAG}"
