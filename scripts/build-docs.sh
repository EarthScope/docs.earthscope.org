#!/usr/bin/env bash
# Centralized build script for EarthScope docs.
# This script can be loaded and executed directly from the docs.earthscope.org repository:
#   curl -sSfL https://raw.githubusercontent.com/EarthScope/docs.earthscope.org/main/scripts/build-docs.sh | bash
#
# It allows updating the mystmd version and build steps in one central place.

set -e

# Default mystmd version if not specified in the environment
DEFAULT_MYSTMD_VERSION="~1.10.1"
MYSTMD_VERSION="${MYSTMD_VERSION:-$DEFAULT_MYSTMD_VERSION}"

echo "=== EarthScope Docs Central Builder ==="
echo "Node version: $(node --version 2>/dev/null || echo 'Not found')"
echo "NPM version: $(npm --version 2>/dev/null || echo 'Not found')"
echo "Installing mystmd@$MYSTMD_VERSION globally..."

# Install the requested version of mystmd
npm install -g "mystmd@$MYSTMD_VERSION"

echo "=== MyST MD Version ==="
myst --version

echo "=== Building documentation ==="
myst build --html

# Check if BASE_URL is set (indicates a sub-project build)
if [ -n "$BASE_URL" ] && [ "$BASE_URL" != "/" ]; then
  echo "=== Structuring publish directory for sub-project (BASE_URL=$BASE_URL) ==="
  
  # Ensure the target directory for our assets exists
  mkdir -p "publish$BASE_URL"
  
  # Move files to the correct subfolder
  mv _build/html/* "publish$BASE_URL/"
  
  # Create the netlify redirect mapping
  printf '/  %s/  301\n' "$BASE_URL" > publish/_redirects
  echo "Created redirects file in publish/_redirects"
else
  echo "=== Structuring build for root project ==="
  # If we're at the root, check if there's a fix-sitemap script to run
  if [ -f "scripts/fix-sitemap.mjs" ]; then
    echo "Running post-build sitemap fixing script..."
    node scripts/fix-sitemap.mjs
  else
    echo "No scripts/fix-sitemap.mjs found (skipping sitemap post-processing)."
  fi
fi

echo "=== Build Completed Successfully ==="
