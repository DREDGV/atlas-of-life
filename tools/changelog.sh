#!/bin/bash
# Usage: changelog.sh <version>
set -e

VERSION="$1"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

FILE="CHANGELOG.md"
if [ ! -f "$FILE" ]; then
  echo "CHANGELOG.md not found in current directory."
  exit 1
fi

DATE=$(date +"%Y-%m-%d")
tmp=$(mktemp)
awk -v ver="$VERSION" -v date="$DATE" 'BEGIN{ replaced=0 }{
  if (!replaced && /^## \[Unreleased\]/) {
    print $0;
    print "";
    print "## [" ver "] - " date;
    replaced=1;
  } else {
    print $0;
  }
}' "$FILE" > "$tmp"
mv "$tmp" "$FILE"

echo "CHANGELOG updated for version $VERSION"